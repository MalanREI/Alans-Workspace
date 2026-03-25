import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

/**
 * Conclude Meeting (FAST)
 *
 * IMPORTANT:
 * - Do NOT run transcription / summarization here.
 * - We only finalize the session and queue AI processing.
 * - AI + PDF generation runs in a Supabase Edge Function triggered by a DB webhook.
 */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      meetingId?: string;
      sessionId?: string;
      referenceLink?: string | null;
    };

    const meetingId = String(body.meetingId ?? "").trim();
    const sessionId = String(body.sessionId ?? "").trim();
    const referenceLink = body.referenceLink ?? null;

    if (!meetingId || !sessionId) {
      return NextResponse.json({ error: "meetingId + sessionId required" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // Check whether at least one recording segment exists for this session.
    const recCountRes = await admin
      .from("meeting_recordings")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    if (recCountRes.error) throw recCountRes.error;

    const recordingCount = recCountRes.count ?? 0;
    const hasRecording = recordingCount > 0;

    console.log(
      `[conclude] meeting=${meetingId} session=${sessionId} recordingCount=${recordingCount} hasRecording=${hasRecording}`
    );

    // Mark the session as ended and set status based on recording availability
    const upd = await admin
      .from("meeting_minutes_sessions")
      .update(
        {
          ended_at: new Date().toISOString(),
          reference_link: referenceLink,
          ai_status: hasRecording ? "ready" : "skipped",
          ai_error: null,
          ai_processed_at: null,
        }
      )
      .eq("id", sessionId)
      .select("id,ended_at,ai_status");

    if (upd.error) throw upd.error;

    // Auto-trigger AI processing if recording exists
    if (hasRecording) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.SITE_URL || "http://localhost:3000";

      // Set status to queued
      await admin
        .from("meeting_minutes_sessions")
        .update({ ai_status: "queued", ai_error: null })
        .eq("id", sessionId);

      // Fire-and-forget: trigger transcription (step 1 of 3: transcribe → summarize → finalize)
      const internalToken = process.env.INTERNAL_JOB_TOKEN || "";
      fetch(`${baseUrl}/api/meetings/ai/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(internalToken ? { "x-internal-token": internalToken } : {}),
        },
        body: JSON.stringify({ meetingId, sessionId }),
      }).catch(async (err: unknown) => {
        console.error("Failed to auto-trigger AI processing:", err);
        await admin
          .from("meeting_minutes_sessions")
          .update({
            ai_status: "error",
            ai_error: "Auto-processing failed to start: " + ((err as Error)?.message || "Unknown"),
          })
          .eq("id", sessionId);
      });
    }

    return NextResponse.json({
      ok: true,
      hasRecording,
      autoProcessing: hasRecording,
      ai_status: hasRecording ? "queued" : "skipped",
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error)?.message ?? "Conclude failed" }, { status: 500 });
  }
}
