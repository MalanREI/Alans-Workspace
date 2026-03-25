import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

/**
 * Main AI route — delegates immediately to /api/meetings/ai/transcribe.
 * Kept as a stable entry point so existing callers (process-recording, etc.)
 * continue to work without updates.
 */
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

    // Mark as queued so the UI shows progress immediately
    await admin
      .from("meeting_minutes_sessions")
      .update({ ai_status: "queued", ai_error: null })
      .eq("id", sessionId);

    // Delegate to transcribe (the first step of the chain)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.SITE_URL || "http://localhost:3000";
    const internalToken = process.env.INTERNAL_JOB_TOKEN || "";

    fetch(`${baseUrl}/api/meetings/ai/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalToken ? { "x-internal-token": internalToken } : {}),
      },
      body: JSON.stringify({ meetingId, sessionId }),
    }).catch(async (err: unknown) => {
      const msg = (err as Error)?.message || "Unknown error";
      console.error(`[ai] failed to trigger transcribe: ${msg}`);
      await admin
        .from("meeting_minutes_sessions")
        .update({ ai_status: "error", ai_error: `Transcribe trigger failed: ${msg}` })
        .eq("id", sessionId!);
    });

    return NextResponse.json({ ok: true, queued: true });
  } catch (e: unknown) {
    const err = e as Error;
    const msg = err?.message ?? "Failed to queue AI processing";
    console.error("[ai] error:", { sessionId, meetingId, message: msg });
    if (sessionId) {
      try {
        await admin
          .from("meeting_minutes_sessions")
          .update({ ai_status: "error", ai_error: msg })
          .eq("id", sessionId);
      } catch (e2) {
        console.error("[ai] failed to save error status:", e2);
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
