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
        .update({ ai_status: "done", ai_processed_at: new Date().toISOString() })
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
        .update({ ai_status: "done", ai_processed_at: new Date().toISOString() })
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

    // Load AI settings — per-meeting overrides global defaults
    const [globalSettingsRes, meetingSettingsRes] = await Promise.all([
      admin.from("meeting_ai_settings").select("setting_key,setting_value").is("meeting_id", null),
      admin.from("meeting_ai_settings").select("setting_key,setting_value").eq("meeting_id", meetingId),
    ]);

    const aiSettings: Record<string, string> = {};
    for (const row of (globalSettingsRes.data ?? []) as { setting_key: string; setting_value: string }[]) {
      aiSettings[row.setting_key] = row.setting_value;
    }
    // Per-meeting settings override global
    for (const row of (meetingSettingsRes.data ?? []) as { setting_key: string; setting_value: string }[]) {
      aiSettings[row.setting_key] = row.setting_value;
    }

    const noteStyle = aiSettings.ai_note_style || "standard";
    const autoPublish = aiSettings.ai_auto_publish !== "false"; // default true if not set

    const noteDetailInstruction =
      noteStyle === "brief"
        ? "Write 3-4 bullet points per agenda item. Be concise — key decisions and action items only."
        : noteStyle === "detailed"
        ? "Write comprehensive notes — capture everything discussed, all details, names, numbers, and context."
        : "Write 5-8 bullet points per agenda item with good detail and context.";

    // Load previous session notes for context
    const prevSessionRes = await admin
      .from("meeting_minutes_sessions")
      .select("id")
      .eq("meeting_id", meetingId)
      .neq("id", sessionId)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let prevNotesSummary = "";
    if (!prevSessionRes.error && prevSessionRes.data?.id) {
      const prevNotesRes = await admin
        .from("meeting_agenda_notes")
        .select("agenda_item_id,notes")
        .eq("session_id", String(prevSessionRes.data.id));
      if (!prevNotesRes.error && prevNotesRes.data?.length) {
        const prevMap: Record<string, string> = {};
        for (const r of prevNotesRes.data) {
          const typedR = r as { agenda_item_id: string; notes?: string };
          prevMap[String(typedR.agenda_item_id)] = String(typedR.notes ?? "").trim();
        }
        const prevLines = agenda
          .filter((a) => prevMap[a.id]?.trim())
          .map(
            (a) =>
              `${a.code ? a.code + " - " : ""}${a.title}: ${(prevMap[a.id] ?? "").slice(0, 300)}`
          );
        if (prevLines.length > 0) prevNotesSummary = prevLines.join("\n");
      }
    }

    // Load active tasks for context
    const activeTasksRes = await admin
      .from("meeting_tasks")
      .select("title,status,priority,owner_name,due_date")
      .eq("meeting_id", meetingId)
      .neq("status", "Completed")
      .limit(25);

    let activeTasksSummary = "";
    if (!activeTasksRes.error && activeTasksRes.data?.length) {
      activeTasksSummary = (
        activeTasksRes.data as Array<{
          title?: string;
          status?: string;
          owner_name?: string;
          due_date?: string;
        }>
      )
        .map(
          (t) =>
            `- ${t.title ?? "Untitled"}${t.owner_name ? " [owner: " + t.owner_name + "]" : ""}${t.due_date ? " [due: " + t.due_date + "]" : ""} — ${t.status ?? "?"}`
        )
        .join("\n");
    }

    // Load milestones for context
    const milestonesRes = await admin
      .from("meeting_milestones")
      .select("title,status,target_date")
      .eq("meeting_id", meetingId)
      .limit(10);

    let milestonesSummary = "";
    if (!milestonesRes.error && milestonesRes.data?.length) {
      milestonesSummary = (
        milestonesRes.data as Array<{ title?: string; status?: string; target_date?: string }>
      )
        .map(
          (m) =>
            `- ${m.title ?? "Untitled"} [${m.status ?? "Pending"}]${m.target_date ? " — target: " + m.target_date : ""}`
        )
        .join("\n");
    }

    const client = new OpenAI({ apiKey: openaiKey });

    // Build context sections for the system prompt
    const agendaList = agenda
      .map(
        (a) =>
          `${a.id} | ${a.code ? a.code + " - " : ""}${a.title}${a.description ? " — " + a.description : ""}`
      )
      .join("\n");

    const contextSections: string[] = [
      "CONTEXT:",
      `- Meeting: "${meetingTitle}"`,
      `- Date: ${meetingDate}`,
      `- Attendees: ${attendeeNames.join(", ") || "Not specified"}`,
    ];

    if (aiSettings.ai_context?.trim()) {
      contextSections.push("", "MEETING CONTEXT PROVIDED BY USER:", aiSettings.ai_context.trim());
    }
    if (aiSettings.ai_speaker_names?.trim()) {
      contextSections.push("", "SPEAKER IDENTIFICATION GUIDE:", aiSettings.ai_speaker_names.trim());
    }
    if (aiSettings.ai_focus_areas?.trim()) {
      contextSections.push("", "PRIORITIZE THESE TOPICS:", aiSettings.ai_focus_areas.trim());
    }
    if (aiSettings.ai_ignore_topics?.trim()) {
      contextSections.push("", "MINIMIZE OR SKIP THESE TOPICS:", aiSettings.ai_ignore_topics.trim());
    }
    if (prevNotesSummary) {
      contextSections.push("", "PREVIOUS MEETING NOTES (use for continuity):", prevNotesSummary);
    }
    if (activeTasksSummary) {
      contextSections.push(
        "",
        "OPEN TASKS (note any updates or completions mentioned in the transcript):",
        activeTasksSummary
      );
    }
    if (milestonesSummary) {
      contextSections.push("", "MILESTONES:", milestonesSummary);
    }

    // Generate agenda notes
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
              ...contextSections,
              "",
              "INSTRUCTIONS:",
              "1. Map each section of the transcript to the most relevant agenda item.",
              `2. ${noteDetailInstruction}`,
              "   For each agenda item notes, include:",
              "   - Key points discussed (not just a one-sentence summary)",
              "   - Specific decisions made and the reasoning behind them",
              "   - Names of people who raised points or were assigned responsibilities",
              "   - Specific numbers, dates, deadlines, or metrics mentioned",
              "   - Updates to any existing open tasks or milestones (reference them by name)",
              "   - Any disagreements, concerns, or open questions raised",
              "   - Next steps or follow-ups discussed",
              "3. Use bullet points (dashes) within each note for readability.",
              "4. Attribute statements to specific people when identifiable (e.g., 'Alan noted...', 'Braden raised a concern about...').",
              "5. If a topic doesn't fit any agenda item, include it under the most related item with '[Off-agenda]'.",
              "6. If an agenda item was not discussed, return an empty string for it.",
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

    // Upsert agenda notes
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

    // Extract action items (non-fatal)
    try {
      const actionCompletion = await retryWithBackoff(
        async () => {
          return await client.chat.completions.create({
            model: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: [
                  "You are analyzing a meeting transcript to extract clear action items.",
                  "",
                  "CONTEXT:",
                  `- Meeting: "${meetingTitle}"`,
                  `- Date: ${meetingDate}`,
                  `- Known team members: ${attendeeNames.join(", ") || "Not specified"}`,
                  "",
                  "RULES:",
                  "1. Only include CLEAR action items — tasks where someone committed to doing something or was explicitly assigned work.",
                  "2. Do NOT include vague mentions, general discussion points, or topics mentioned in passing.",
                  "3. For 'owner': Match to a known team member name if possible. Use whatever name appears in the transcript if uncertain.",
                  "4. For 'dueDate': Only include if a specific date or timeframe was mentioned. Convert to YYYY-MM-DD based on meeting date. Use empty string if not mentioned.",
                  "5. For 'priority': 'Urgent' if described as urgent/critical/blocking. 'High' if emphasized as very important. Otherwise 'Normal'.",
                  "6. For 'title': Write a specific, actionable task title (e.g., 'Submit Q2 budget forecast to finance team' not just 'budget').",
                  "7. For 'context': One sentence explaining why this task matters or what triggered it.",
                  "8. Skip anything already marked as completed in the transcript.",
                ].join("\n"),
              },
              {
                role: "user",
                content: `Return the action items as JSON with an "action_items" array. Each item: { title, owner, dueDate, priority, context }.\n\nTranscript:\n${transcriptText}`,
              },
            ],
          });
        },
        3,
        2000
      );

      const actionContent = actionCompletion.choices?.[0]?.message?.content ?? "{}";
      let actionItems: Array<{
        title: string;
        owner: string;
        dueDate: string;
        priority: string;
        context: string;
      }> = [];
      try {
        const parsed = JSON.parse(actionContent);
        // Accept both `action_items` and `items` keys for robustness
        actionItems = parsed.action_items ?? parsed.items ?? [];
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
            priority: ["Urgent", "High", "Low"].includes(item.priority) ? item.priority : "Normal",
            owner_name: item.owner || null,
            due_date:
              item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : null,
            notes: item.context ? `Context: ${item.context}` : "Extracted from meeting transcript by AI",
            position: idx + 1,
          }));

          const taskInsert = await admin.from("meeting_tasks").insert(taskRows);
          if (!taskInsert.error) tasksCreated = taskRows.length;
        }
      }
    } catch (actionError) {
      console.error("[summarize] action item extraction failed (non-fatal):", actionError);
    }

    // Generate executive summary (non-fatal)
    try {
      const notesSummaryForExec = agenda
        .map(
          (a) =>
            `${a.code ? a.code + " - " : ""}${a.title}:\n${(notesObj[a.id] ?? "").trim() || "(not discussed)"}`
        )
        .filter((s) => !s.endsWith("(not discussed)"))
        .join("\n\n");

      if (notesSummaryForExec.trim()) {
        const execCompletion = await retryWithBackoff(
          async () => {
            return await client.chat.completions.create({
              model: process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini",
              temperature: 0.3,
              messages: [
                {
                  role: "system",
                  content: [
                    "You are writing an executive summary of a meeting for senior stakeholders who need a quick briefing.",
                    "",
                    `Meeting: "${meetingTitle}"`,
                    `Date: ${meetingDate}`,
                    `Attendees: ${attendeeNames.join(", ") || "Not specified"}`,
                    "",
                    "Write exactly 3-5 bullet points (each starting with a dash -) covering:",
                    "- The most important decisions made (with reasoning if notable)",
                    "- Critical action items assigned (include owner names and deadlines)",
                    "- Key outcomes, risks, blockers, or changes flagged",
                    "",
                    "Rules: Be specific — include names, numbers, and dates. Stay under 180 words total.",
                    "Write ONLY the bullet points. No heading, no intro, no preamble.",
                  ].join("\n"),
                },
                {
                  role: "user",
                  content: `Meeting notes by agenda item:\n\n${notesSummaryForExec}`,
                },
              ],
            });
          },
          3,
          2000
        );

        const execSummary = execCompletion.choices?.[0]?.message?.content?.trim() ?? "";
        if (execSummary) {
          await admin
            .from("meeting_minutes_sessions")
            .update({ executive_summary: execSummary })
            .eq("id", sessionId);
          console.log(`[summarize] executive summary saved, chars=${execSummary.length}`);
        }
      }
    } catch (execError) {
      console.error("[summarize] executive summary generation failed (non-fatal):", execError);
    }

    if (autoPublish) {
      // Auto-publish: proceed directly to PDF generation
      await admin
        .from("meeting_minutes_sessions")
        .update({ ai_status: "summarized", ai_processed_at: new Date().toISOString() })
        .eq("id", sessionId);

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
          console.error("[summarize] failed to trigger finalize:", (err as Error)?.message);
        }
      });
    } else {
      // Manual review mode: stop here, let the user publish via /api/meetings/ai/publish
      await admin
        .from("meeting_minutes_sessions")
        .update({ ai_status: "review", ai_processed_at: new Date().toISOString() })
        .eq("id", sessionId);
      console.log(`[summarize] session=${sessionId} set to review (auto_publish=false)`);
    }

    return NextResponse.json({ ok: true, agendaItemsUpdated: upRows.length, tasksCreated, autoPublish });
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
