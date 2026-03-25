import { NextResponse, after } from "next/server";
import OpenAI from "openai";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

// Raise function timeout to 60s on Pro plan (capped at 10s on Hobby)
export const maxDuration = 60;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
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

type AgendaItemRow = {
  id: string;
  code: string | null;
  title: string | null;
  description: string | null;
  position: number | null;
};

export async function POST(req: Request) {
  const admin = supabaseAdmin();
  let sessionId: string | undefined;
  let meetingId: string | undefined;
  let tasksCreated = 0;

  try {
    const body = (await req.json()) as { meetingId?: string; sessionId?: string };
    meetingId = String(body.meetingId ?? "").trim();
    sessionId = String(body.sessionId ?? "").trim();

    if (!meetingId || !sessionId) {
      return NextResponse.json({ error: "meetingId + sessionId required" }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("Missing OPENAI_API_KEY");

    // Mark as summarizing
    await admin
      .from("meeting_minutes_sessions")
      .update({ ai_status: "summarizing", ai_error: null })
      .eq("id", sessionId);

    // Load transcript saved by transcribe step
    const sessionRes = await admin
      .from("meeting_minutes_sessions")
      .select("transcript")
      .eq("id", sessionId)
      .single();

    if (sessionRes.error) throw sessionRes.error;

    const transcriptText = (sessionRes.data?.transcript ?? "").trim();
    if (!transcriptText) {
      await admin
        .from("meeting_minutes_sessions")
        .update({
          ai_status: "done",
          ai_processed_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return NextResponse.json({ ok: true, skipped: "Empty transcript" });
    }

    console.log(
      `[summarize] session=${sessionId} meeting=${meetingId} transcriptChars=${transcriptText.length}`
    );

    // Load agenda items
    const agendaRes = await admin
      .from("meeting_agenda_items")
      .select("id,code,title,description,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });

    if (agendaRes.error) throw agendaRes.error;

    const agendaRows = (agendaRes.data ?? []) as AgendaItemRow[];
    const agenda = agendaRows.map((a) => ({
      id: String(a.id),
      code: a.code ? String(a.code) : null,
      title: String(a.title ?? ""),
      description: a.description ? String(a.description) : null,
    }));

    if (!agenda.length) {
      await admin
        .from("meeting_minutes_sessions")
        .update({
          ai_status: "done",
          ai_processed_at: new Date().toISOString(),
        })
        .eq("id", sessionId);
      return NextResponse.json({ ok: true, skipped: "No agenda items" });
    }

    // Load meeting metadata and attendees for context
    const meetingRes = await admin
      .from("meetings")
      .select("title,start_at,duration_minutes")
      .eq("id", meetingId)
      .single();
    const meetingTitle = meetingRes.data?.title ?? "Meeting";
    const meetingDate = meetingRes.data?.start_at
      ? new Date(meetingRes.data.start_at).toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Unknown date";

    const attendeesRes = await admin
      .from("meeting_attendees")
      .select("email,full_name")
      .eq("meeting_id", meetingId);
    const attendeeNames = (attendeesRes.data ?? [])
      .map((a: { full_name?: string; email?: string }) => a.full_name?.trim() || a.email?.trim() || "")
      .filter(Boolean);

    const client = new OpenAI({ apiKey: openaiKey });

    // Generate agenda notes
    const agendaList = agenda
      .map(
        (a) =>
          `${a.id} | ${a.code ? a.code + " - " : ""}${a.title}${
            a.description ? " — " + a.description : ""
          }`
      )
      .join("\n");

    const notesCompletion = await retryWithBackoff(async () => {
      return await client.chat.completions.create({
        model: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are a professional meeting secretary creating detailed meeting minutes.",
              "",
              "CONTEXT:",
              `- Meeting: "${meetingTitle}"`,
              `- Date: ${meetingDate}`,
              `- Attendees: ${attendeeNames.join(", ") || "Not specified"}`,
              "",
              "INSTRUCTIONS:",
              "1. Map each section of the transcript to the most relevant agenda item.",
              "2. For each agenda item, write DETAILED notes including:",
              "   - Key points discussed (not just a one-sentence summary)",
              "   - Specific decisions made and the reasoning behind them",
              "   - Names of people who raised points or were assigned responsibilities",
              "   - Specific numbers, dates, deadlines, or metrics mentioned",
              "   - Any disagreements, concerns, or open questions raised",
              "   - Next steps or follow-ups discussed",
              "3. Use bullet points (dashes) within each note for readability.",
              "4. Attribute statements to specific people when identifiable from the transcript (e.g., 'Alan suggested...', 'Braden raised a concern about...').",
              "5. If a topic was discussed that doesn't fit any agenda item, include it under the most related item with a note like '[Off-agenda]'.",
              "6. If an agenda item was not discussed at all, return an empty string for it.",
              "",
              "Return ONLY a JSON object mapping agenda_item_id → notes_string.",
              "Each notes_string should be a multi-line string with dashes for bullet points.",
            ].join("\n"),
          },
          {
            role: "user",
            content: `Agenda items (id | label):\n${agendaList}\n\nTranscript:\n${transcriptText}`,
          },
        ],
      });
    });

    const notesContent = notesCompletion.choices?.[0]?.message?.content ?? "{}";
    let notesObj: Record<string, string> = {};
    try {
      notesObj = JSON.parse(notesContent);
    } catch {
      notesObj = {};
    }

    // Upsert agenda notes — one row per agenda item
    const upRows = agenda.map((a) => ({
      session_id: sessionId,
      agenda_item_id: a.id,
      notes: String(notesObj[a.id] ?? "").trim(),
      updated_at: new Date().toISOString(),
    }));

    const up = await admin
      .from("meeting_agenda_notes")
      .upsert(upRows, { onConflict: "session_id,agenda_item_id" });

    if (up.error) throw up.error;

    console.log(`[summarize] session=${sessionId} agendaItemsUpdated=${upRows.length}`);

    // Extract action items (non-fatal if this fails)
    try {
      const actionCompletion = await retryWithBackoff(async () => {
        return await client.chat.completions.create({
          model: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You are analyzing a meeting transcript to extract clear action items (tasks assigned to specific people).",
                "",
                "CONTEXT:",
                `- Meeting: "${meetingTitle}"`,
                `- Date: ${meetingDate}`,
                `- Known team members: ${attendeeNames.join(", ") || "Not specified"}`,
                "",
                "RULES:",
                "1. Only include CLEAR action items — tasks where someone committed to doing something or was assigned work.",
                "2. Do NOT include general discussion points or topics mentioned in passing.",
                "3. For 'owner': Use the person's full name from the known team members list if you can match them. If uncertain, use whatever name is mentioned in the transcript.",
                "4. For 'dueDate': Only include if a specific date or timeframe was mentioned (e.g., 'by Friday', 'next week', 'by March 1st'). Convert relative dates to YYYY-MM-DD format based on the meeting date. If no date was mentioned, use an empty string.",
                "5. For 'priority': Set to 'Urgent' if the item was described as urgent, critical, or blocking. Set to 'High' if it was emphasized as important. Default to 'Normal'.",
                "6. For 'title': Write a clear, actionable task title (e.g., 'Submit insurance quote to broker by Friday' not just 'insurance quote').",
                "7. If someone said they already completed something, do NOT include it as an action item.",
              ].join("\n"),
            },
            {
              role: "user",
              content: `Return the action items as JSON.\n\nTranscript:\n${transcriptText}`,
            },
          ],
        });
      }, 3, 2000);

      const actionContent = actionCompletion.choices?.[0]?.message?.content ?? "{}";
      let actionItems: Array<{ title: string; owner: string; dueDate: string; priority: string }> = [];
      try {
        const parsed = JSON.parse(actionContent);
        actionItems = parsed.items ?? [];
      } catch {
        // skip
      }

      if (actionItems.length > 0) {
        let actionColumn = await admin
          .from("meeting_task_columns")
          .select("id")
          .eq("meeting_id", meetingId)
          .eq("name", "Action Items")
          .single();

        if (!actionColumn.data) {
          const maxPos = await admin
            .from("meeting_task_columns")
            .select("position")
            .eq("meeting_id", meetingId)
            .order("position", { ascending: false })
            .limit(1);

          const nextPos = (maxPos.data?.[0]?.position ?? 0) + 1;
          const newCol = await admin
            .from("meeting_task_columns")
            .insert({ meeting_id: meetingId, name: "Action Items", position: nextPos })
            .select("id")
            .single();
          if (!newCol.error) actionColumn = newCol;
        }

        if (actionColumn.data) {
          const taskRows = actionItems.map((item, idx) => ({
            meeting_id: meetingId,
            column_id: actionColumn.data!.id,
            title: item.title,
            status: "In Progress",
            priority: ["High", "Low"].includes(item.priority) ? item.priority : "Normal",
            owner_name: item.owner,
            due_date:
              item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : null,
            notes: "Extracted from meeting transcript by AI",
            position: idx + 1,
          }));

          const taskInsert = await admin.from("meeting_tasks").insert(taskRows);
          if (!taskInsert.error) tasksCreated = taskRows.length;
        }
      }
    } catch (actionError) {
      console.error("[summarize] action item extraction failed (non-fatal):", actionError);
    }

    // Mark summarized and save final status BEFORE firing finalize
    await admin
      .from("meeting_minutes_sessions")
      .update({
        ai_status: "summarized",
        ai_processed_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    // Fire-and-forget: finalize (PDF generation)
    // after() keeps the Lambda alive after the response so the fetch isn't killed on return.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.SITE_URL || "http://localhost:3000";
    const internalToken = process.env.INTERNAL_JOB_TOKEN || "";

    after(async () => {
      console.log(`[summarize] firing finalize for session=${sessionId}`);
      try {
        const res = await fetch(`${baseUrl}/api/meetings/ai/finalize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(internalToken ? { "x-internal-token": internalToken } : {}),
          },
          body: JSON.stringify({ meetingId, sessionId }),
        });
        console.log(`[summarize] finalize response: ${res.status}`);
      } catch (err: unknown) {
        // Non-fatal — PDF can be regenerated manually
        console.error("[summarize] failed to trigger finalize:", (err as Error)?.message);
      }
    });

    return NextResponse.json({
      ok: true,
      agendaItemsUpdated: upRows.length,
      tasksCreated,
    });
  } catch (e: unknown) {
    const err = e as Error;
    const msg = err?.message ?? "Summarization failed";
    console.error("[summarize] error:", {
      sessionId,
      meetingId,
      message: msg,
      stack: err?.stack?.split("\n").slice(0, 5).join("\n"),
    });
    if (sessionId) {
      try {
        await admin
          .from("meeting_minutes_sessions")
          .update({ ai_status: "error", ai_error: `Summarize: ${msg}` })
          .eq("id", sessionId);
      } catch (e2) {
        console.error("[summarize] failed to save error status:", e2);
      }
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
