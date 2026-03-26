import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

export const maxDuration = 30;

export async function POST(req: Request) {
  const admin = supabaseAdmin();
  try {
    const body = (await req.json()) as {
      sessionId?: string;
      meetingId?: string;
      editedNotes?: Record<string, string>;
    };

    const sessionId = String(body.sessionId ?? "").trim();
    const meetingId = String(body.meetingId ?? "").trim();
    if (!sessionId || !meetingId) {
      return NextResponse.json({ error: "sessionId + meetingId required" }, { status: 400 });
    }

    // Apply edited notes if provided
    if (body.editedNotes && Object.keys(body.editedNotes).length > 0) {
      const upRows = Object.entries(body.editedNotes).map(([agendaItemId, notes]) => ({
        session_id: sessionId,
        agenda_item_id: agendaItemId,
        notes: String(notes ?? "").trim(),
        updated_at: new Date().toISOString(),
      }));
      const up = await admin
        .from("meeting_agenda_notes")
        .upsert(upRows, { onConflict: "session_id,agenda_item_id" });
      if (up.error) throw up.error;
    }

    // Set status to summarized — finalize will pick it up and generate PDF + set "done"
    await admin
      .from("meeting_minutes_sessions")
      .update({ ai_status: "summarized", ai_processed_at: new Date().toISOString() })
      .eq("id", sessionId);

    // Fire finalize (non-blocking)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.SITE_URL || "http://localhost:3000";
    const internalToken = process.env.INTERNAL_JOB_TOKEN || "";

    fetch(`${baseUrl}/api/meetings/ai/finalize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalToken ? { "x-internal-token": internalToken } : {}),
      },
      body: JSON.stringify({ meetingId, sessionId }),
    }).catch((err: unknown) => {
      console.error("[publish] finalize trigger failed:", (err as Error)?.message);
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as Error;
    console.error("[publish] error:", err?.message);
    return NextResponse.json({ error: err?.message || "Publish failed" }, { status: 500 });
  }
}
