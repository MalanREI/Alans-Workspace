import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

// Raise function timeout to 60s on Pro plan (capped at 10s on Hobby)
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

export async function POST(req: Request) {
  const admin = supabaseAdmin();
  let sessionId: string | undefined;
  let meetingId: string | undefined;

  try {
    const body = (await req.json()) as { meetingId?: string; sessionId?: string };
    meetingId = String(body.meetingId ?? "").trim();
    sessionId = String(body.sessionId ?? "").trim();

    if (!meetingId || !sessionId) {
      return NextResponse.json({ error: "meetingId + sessionId required" }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("Missing OPENAI_API_KEY");
    const recordingsBucket = process.env.RECORDINGS_BUCKET || "meeting-recordings";

    // Mark as transcribing
    await admin
      .from("meeting_minutes_sessions")
      .update({ ai_status: "transcribing", ai_error: null })
      .eq("id", sessionId);

    // Load all recording segments for this session, oldest first
    const recRes = await admin
      .from("meeting_recordings")
      .select("storage_path,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (recRes.error) throw recRes.error;

    const recordings = (recRes.data ?? []) as Array<{ storage_path: string; created_at: string }>;

    if (!recordings.length) {
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

    console.log(`[transcribe] session=${sessionId} meeting=${meetingId} segments=${recordings.length}`);

    const client = new OpenAI({ apiKey: openaiKey });
    const transcriptParts: string[] = [];
    let transcribedCount = 0;

    for (let i = 0; i < recordings.length; i++) {
      const storagePath = String(recordings[i]?.storage_path ?? "").trim();
      if (!storagePath) continue;

      const dl = await admin.storage.from(recordingsBucket).download(storagePath);
      if (dl.error) {
        throw new Error(`Storage download failed for segment ${i + 1} (${storagePath}): ${dl.error.message}`);
      }

      const arrBuf = await dl.data.arrayBuffer();
      console.log(
        `[transcribe] segment ${i + 1}/${recordings.length} path=${storagePath} size=${arrBuf.byteLength} bytes`
      );

      const transcription = await retryWithBackoff(async () => {
        return await client.audio.transcriptions.create({
          model: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1",
          file: bufToFile(arrBuf, `segment-${i + 1}.webm`, "audio/webm"),
        });
      });

      const segText = transcription?.text?.trim() ?? "";
      if (segText) {
        transcriptParts.push(segText);
        transcribedCount += 1;
      }
    }

    const transcriptText = transcriptParts.join("\n\n");
    console.log(
      `[transcribe] session=${sessionId} transcribedSegments=${transcribedCount}/${recordings.length} chars=${transcriptText.length}`
    );

    if (!transcriptText.trim()) {
      await admin
        .from("meeting_minutes_sessions")
        .update({
          ai_status: "done",
          ai_processed_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return NextResponse.json({ ok: true, skipped: "Empty transcript" });
    }

    // Save transcript and mark transcribed BEFORE firing next step
    await admin
      .from("meeting_minutes_sessions")
      .update({ transcript: transcriptText, ai_status: "transcribed" })
      .eq("id", sessionId);

    // Fire-and-forget: summarize
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.SITE_URL || "http://localhost:3000";
    const internalToken = process.env.INTERNAL_JOB_TOKEN || "";

    fetch(`${baseUrl}/api/meetings/ai/summarize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalToken ? { "x-internal-token": internalToken } : {}),
      },
      body: JSON.stringify({ meetingId, sessionId }),
    }).catch(async (err: unknown) => {
      const msg = (err as Error)?.message || "Unknown error";
      console.error(`[transcribe] failed to trigger summarize: ${msg}`);
      await admin
        .from("meeting_minutes_sessions")
        .update({ ai_status: "error", ai_error: `Summarize trigger failed: ${msg}` })
        .eq("id", sessionId!);
    });

    return NextResponse.json({
      ok: true,
      segmentsFound: recordings.length,
      segmentsTranscribed: transcribedCount,
      transcriptChars: transcriptText.length,
    });
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
