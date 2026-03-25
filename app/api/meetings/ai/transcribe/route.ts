import { NextResponse, after } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

// One segment per invocation: download + one Whisper call ≈ 10–15s.
// after() fires the next segment and keeps the Lambda alive until
// the outgoing fetch is sent; total Lambda runtime ≈ 25–30s on Pro.
export const maxDuration = 60;

function bufToFile(buf: ArrayBuffer, filename: string, mime: string) {
  return new File([buf], filename, { type: mime });
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  initialDelay = 2000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < maxRetries) {
        const err = error as { status?: number; code?: string };
        const isRetryable =
          err?.status === 429 ||
          err?.status === 503 ||
          err?.status === 500 ||
          err?.code === "ECONNRESET" ||
          err?.code === "ETIMEDOUT";
        if (!isRetryable) throw error;
        await new Promise((r) => setTimeout(r, initialDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

type RecordingRow = { id: string; storage_path: string; created_at: string };

export async function POST(req: Request) {
  const admin = supabaseAdmin();
  let sessionId: string | undefined;
  let meetingId: string | undefined;

  try {
    const body = (await req.json()) as {
      meetingId?: string;
      sessionId?: string;
      segmentIndex?: number;
    };

    meetingId = String(body.meetingId ?? "").trim();
    sessionId = String(body.sessionId ?? "").trim();
    const segmentIndex = typeof body.segmentIndex === "number" ? Math.max(0, body.segmentIndex) : 0;

    if (!meetingId || !sessionId) {
      return NextResponse.json({ error: "meetingId + sessionId required" }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("Missing OPENAI_API_KEY");
    const recordingsBucket = process.env.RECORDINGS_BUCKET || "meeting-recordings";

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.SITE_URL || "http://localhost:3000";
    const internalToken = process.env.INTERNAL_JOB_TOKEN || "";

    // Load all segments ordered oldest-first (same query every hop — cheap, always consistent)
    const recRes = await admin
      .from("meeting_recordings")
      .select("id,storage_path,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (recRes.error) throw recRes.error;

    const recordings = (recRes.data ?? []) as RecordingRow[];
    const totalSegments = recordings.length;

    if (totalSegments === 0) {
      await admin
        .from("meeting_minutes_sessions")
        .update({
          ai_status: "skipped",
          ai_error: "No recording segments found for this session",
          ai_processed_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return NextResponse.json({ ok: true, skipped: "No recording segments found" });
    }

    // ── ALL SEGMENTS PROCESSED: combine and hand off to summarize ──────────
    if (segmentIndex >= totalSegments) {
      const transcriptRes = await admin
        .from("meeting_recordings")
        .select("transcript,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .limit(200);

      const parts = (transcriptRes.data ?? [])
        .map((r: { transcript: string | null }) => (r.transcript ?? "").trim())
        .filter(Boolean);

      const combinedTranscript = parts.join("\n\n");

      console.log(
        `[transcribe] session=${sessionId} all ${totalSegments} segments done, combinedChars=${combinedTranscript.length}`
      );

      if (!combinedTranscript.trim()) {
        await admin
          .from("meeting_minutes_sessions")
          .update({ ai_status: "done", ai_processed_at: new Date().toISOString() })
          .eq("id", sessionId);
        return NextResponse.json({ ok: true, skipped: "Empty transcript after all segments" });
      }

      // Save combined transcript and mark transcribed BEFORE firing summarize
      await admin
        .from("meeting_minutes_sessions")
        .update({ transcript: combinedTranscript, ai_status: "transcribed" })
        .eq("id", sessionId);

      after(async () => {
        console.log(`[transcribe] firing summarize for session=${sessionId}`);
        try {
          const res = await fetch(`${baseUrl}/api/meetings/ai/summarize`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(internalToken ? { "x-internal-token": internalToken } : {}),
            },
            body: JSON.stringify({ meetingId, sessionId }),
          });
          console.log(`[transcribe] summarize response: ${res.status}`);
        } catch (err: unknown) {
          const msg = (err as Error)?.message || "Unknown error";
          console.error(`[transcribe] failed to trigger summarize: ${msg}`);
          await admin
            .from("meeting_minutes_sessions")
            .update({ ai_status: "error", ai_error: `Summarize trigger failed: ${msg}` })
            .eq("id", sessionId!);
        }
      });

      return NextResponse.json({ ok: true, done: true, totalSegments, transcriptChars: combinedTranscript.length });
    }

    // ── PROCESS ONE SEGMENT ────────────────────────────────────────────────
    const recording = recordings[segmentIndex]!;
    const storagePath = String(recording.storage_path ?? "").trim();

    // Only update ai_status on the first segment to avoid unnecessary DB writes
    if (segmentIndex === 0) {
      await admin
        .from("meeting_minutes_sessions")
        .update({ ai_status: "transcribing", ai_error: null })
        .eq("id", sessionId);
    }

    console.log(
      `[transcribe] segment ${segmentIndex + 1}/${totalSegments} session=${sessionId} path=${storagePath}`
    );

    let segmentTranscript = "";

    if (!storagePath) {
      console.warn(`[transcribe] segment ${segmentIndex + 1} has no storage_path — skipping`);
    } else {
      const dl = await admin.storage.from(recordingsBucket).download(storagePath);

      if (dl.error) {
        // Log and continue — don't fail the entire job over one bad segment
        console.error(
          `[transcribe] download failed for segment ${segmentIndex + 1}: ${dl.error.message}`
        );
      } else {
        const arrBuf = await dl.data.arrayBuffer();
        console.log(
          `[transcribe] segment ${segmentIndex + 1}/${totalSegments} downloaded, size=${arrBuf.byteLength} bytes`
        );

        const client = new OpenAI({ apiKey: openaiKey });
        try {
          const transcription = await retryWithBackoff(async () => {
            return await client.audio.transcriptions.create({
              model: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1",
              file: bufToFile(arrBuf, `segment-${segmentIndex + 1}.webm`, "audio/webm"),
            });
          });
          segmentTranscript = transcription?.text?.trim() ?? "";
        } catch (whisperErr) {
          // Log and continue — chain must not break over one failed segment
          console.error(
            `[transcribe] whisper failed for segment ${segmentIndex + 1}:`,
            (whisperErr as Error)?.message
          );
        }
      }
    }

    // Save this segment's transcript to the recording row
    await admin
      .from("meeting_recordings")
      .update({ transcript: segmentTranscript || null })
      .eq("id", recording.id);

    console.log(
      `[transcribe] segment ${segmentIndex + 1}/${totalSegments} complete, chars=${segmentTranscript.length}`
    );

    // Fire next hop (next segment, or finalization if this was the last)
    const nextIndex = segmentIndex + 1;
    after(async () => {
      const label = nextIndex < totalSegments
        ? `segment ${nextIndex + 1}/${totalSegments}`
        : "finalization";
      console.log(`[transcribe] firing ${label} for session=${sessionId}`);
      try {
        const res = await fetch(`${baseUrl}/api/meetings/ai/transcribe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(internalToken ? { "x-internal-token": internalToken } : {}),
          },
          body: JSON.stringify({ meetingId, sessionId, segmentIndex: nextIndex }),
        });
        console.log(`[transcribe] next hop (segmentIndex=${nextIndex}) response: ${res.status}`);
      } catch (err: unknown) {
        const msg = (err as Error)?.message || "Unknown error";
        console.error(`[transcribe] failed to fire next hop (segmentIndex=${nextIndex}): ${msg}`);
        await admin
          .from("meeting_minutes_sessions")
          .update({
            ai_status: "error",
            ai_error: `Transcribe chain broken at segment ${nextIndex + 1}/${totalSegments}: ${msg}`,
          })
          .eq("id", sessionId!);
      }
    });

    return NextResponse.json({ ok: true, segmentIndex, totalSegments, transcriptChars: segmentTranscript.length });

  } catch (e: unknown) {
    const err = e as Error;
    const msg = err?.message ?? "Transcription failed";
    console.error("[transcribe] error:", {
      sessionId,
      meetingId,
      message: msg,
      stack: err?.stack?.split("\n").slice(0, 5).join("\n"),
    });
    if (sessionId) {
      try {
        await admin
          .from("meeting_minutes_sessions")
          .update({ ai_status: "error", ai_error: `Transcribe: ${msg}` })
          .eq("id", sessionId);
      } catch (e2) {
        console.error("[transcribe] failed to save error status:", e2);
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
