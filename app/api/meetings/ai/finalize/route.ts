import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, PDFFont, RGB } from "pdf-lib";
import { supabaseAdmin } from "@/src/lib/supabase/admin";
import { APP_NAME } from "@/src/config/app.config";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function requireInternalToken(req: Request) {
  const expected = process.env.INTERNAL_JOB_TOKEN;
  if (!expected) return;
  const got = req.headers.get("x-internal-token") || "";
  if (got !== expected) {
    throw new Error("Unauthorized");
  }
}

type AgendaPdfRow = {
  label: string;
  notes: string;
  prevNotes: string;
};

function normalizeNotes(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n/g, "\n").trim();
}

type TaskRow = {
  title: string;
  meta: string;
  notes?: string | null;
  latestComment?: string | null;
  columnName: string;
  status?: string;
  priority?: string;
  ownerName?: string;
  ownerColor?: string;
  dueDate?: string | null;
};

type AttendanceRow = {
  full_name: string | null;
  email: string | null;
  is_present: boolean;
  is_guest: boolean;
  color_hex?: string | null;
};

type MilestoneRow = {
  title: string;
  target_date: string | null;
  status: string;
  priority: string;
  owner_name: string;
  description: string | null;
  owner_color?: string | null;
};

type OngoingNoteRow = {
  title: string;
  content: string | null;
  category: string | null;
};

type MilestoneData = {
  title?: string;
  target_date?: string;
  status?: string;
  priority?: string;
  owner_name?: string;
  owner_id?: string;
  description?: string;
};

type OngoingNoteData = {
  title?: string;
  content?: string;
  category?: string;
};

type AttendanceData = {
  email?: string;
  full_name?: string;
  is_present?: boolean;
  is_guest?: boolean;
};

async function buildPdf(opts: {
  meetingTitle: string;
  meetingDateLabel: string;
  meetingTimeLabel: string;
  meetingLocation: string;
  agenda: AgendaPdfRow[];
  tasks: TaskRow[];
  referenceLink?: string | null;
  attendanceData: AttendanceRow[];
  milestones: MilestoneRow[];
  ongoingNotes: OngoingNoteRow[];
  sessionNumber?: number | null;
  executiveSummary?: string | null;
  sessionStartedAt?: string | null;
  sessionEndedAt?: string | null;
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // ─── Color palette ────────────────────────────────────────────────
  const NAVY      = rgb(0.102, 0.137, 0.196);  // #1A2332 header bg
  const NAVY_MID  = rgb(0.165, 0.227, 0.290);  // #2A3A4A badge bg
  const WHITE     = rgb(1, 1, 1);
  const BLUE      = rgb(0.216, 0.541, 0.867);  // #378ADD executive summary
  const CORAL     = rgb(0.847, 0.353, 0.188);  // #D85A30 action items
  const GREEN     = rgb(0.114, 0.620, 0.459);  // #1D9E75 discussion notes
  const GRAY_ACC  = rgb(0.533, 0.529, 0.502);  // #888780 tasks / milestones
  const DARK      = rgb(0.118, 0.118, 0.118);
  const MID       = rgb(0.510, 0.510, 0.510);
  const HDR_LABEL = rgb(0.478, 0.533, 0.600);  // "MEETING MINUTES" label
  const HDR_SUB   = rgb(0.533, 0.600, 0.667);  // subtitle / badge text
  const STAT_BG   = rgb(0.961, 0.961, 0.961);  // #F5F5F5
  const STAT_VAL  = rgb(0.118, 0.118, 0.118);
  const STAT_LBL  = rgb(0.588, 0.588, 0.588);
  const NOTE_TEXT = rgb(0.314, 0.314, 0.314);
  const PREV_TEXT = rgb(0.588, 0.588, 0.588);
  const ALT_BG    = rgb(0.980, 0.980, 0.980);
  const FAINT     = rgb(0.706, 0.706, 0.706);
  const FOOTER_C  = rgb(0.588, 0.588, 0.588);

  // ─── Page geometry ────────────────────────────────────────────────
  const PAGE_W   = 612;
  const PAGE_H   = 792;
  const ML       = 50;
  const MR       = 50;
  const CW       = PAGE_W - ML - MR;  // 512
  const HEADER_H = 90;
  const FOOTER_Y = 40;
  const BOTTOM   = FOOTER_Y + 60;

  // ─── Page state ───────────────────────────────────────────────────
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - HEADER_H - 20;

  // ─── Helpers ──────────────────────────────────────────────────────
  const sanitize = (s: string): string =>
    (s ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x00-\xFF]/g, "");

  const drawText = (t: string, x: number, yPos: number, size: number, f: PDFFont, color: RGB) => {
    const s = sanitize(t);
    if (!s) return;
    page.drawText(s, { x, y: yPos, size, font: f, color });
  };

  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const raw = sanitize(text ?? "");
    const lines: string[] = [];
    for (const para of raw.split("\n")) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(""); continue; }
      let cur = words[0]!;
      for (let i = 1; i < words.length; i++) {
        const test = cur + " " + words[i];
        if (f.widthOfTextAtSize(test, size) <= maxW) {
          cur = test;
        } else {
          lines.push(cur);
          cur = words[i]!;
        }
      }
      lines.push(cur);
    }
    // Remove trailing empty lines
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
  };

  const formatDuration = (): string => {
    if (!opts.sessionStartedAt || !opts.sessionEndedAt) return "-";
    const diff = Math.round(
      (+new Date(opts.sessionEndedAt) - +new Date(opts.sessionStartedAt)) / 60000
    );
    if (diff <= 0) return "-";
    if (diff < 60) return `${diff} min`;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  };

  const statusColor = (s: string): RGB => {
    const n = s.toLowerCase().trim();
    if (n === "in progress" || n === "in-progress" || n === "active")
      return rgb(0.729, 0.459, 0.090);
    if (n === "completed" || n === "complete" || n === "done") return GREEN;
    if (n === "waiting" || n === "delayed" || n === "blocked")
      return rgb(0.600, 0.106, 0.106);
    return MID;
  };

  // Slim 40pt navy continuation header on new pages
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 40, width: PAGE_W, height: 40, color: NAVY });
    const ct = sanitize(opts.meetingTitle).slice(0, 50);
    page.drawText(ct, { x: ML, y: PAGE_H - 26, size: 12, font: bold, color: WHITE });
    y = PAGE_H - 60;
  };

  const ensureSpace = (need: number) => { if (y - need < BOTTOM) newPage(); };

  // 3pt accent bar + 12pt bold label, optional count suffix
  const drawSectionHeading = (label: string, accent: RGB, countLabel?: string) => {
    ensureSpace(28);
    page.drawRectangle({ x: ML, y: y - 14, width: 3, height: 14, color: accent });
    drawText(label, ML + 12, y - 12, 12, bold, DARK);
    if (countLabel) {
      const lx = ML + 12 + bold.widthOfTextAtSize(sanitize(label), 12) + 8;
      drawText(countLabel, lx, y - 12, 9, font, MID);
    }
    y -= 22;
  };

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1 — HEADER BAR
  // ═══════════════════════════════════════════════════════════════════
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: NAVY });

  drawText("MEETING MINUTES", ML, PAGE_H - 16, 8, font, HDR_LABEL);
  drawText(sanitize(opts.meetingTitle).slice(0, 55), ML, PAGE_H - 38, 18, bold, WHITE);

  const subtitleParts: string[] = [sanitize(opts.meetingDateLabel)];
  if (opts.sessionNumber) subtitleParts.push(`Meeting #${opts.sessionNumber}`);
  if (opts.meetingLocation) subtitleParts.push(sanitize(opts.meetingLocation));
  drawText(subtitleParts.join(" - "), ML, PAGE_H - 58, 10, font, HDR_SUB);

  // APP_NAME badge (top-right of header)
  const badgeText = sanitize(APP_NAME);
  const badgeTW   = font.widthOfTextAtSize(badgeText, 9);
  const badgePad  = 6;
  const badgeW    = badgeTW + badgePad * 2;
  const badgeH    = 9 + badgePad * 2 + 2;
  const badgeX    = PAGE_W - MR - badgeW;
  const badgeY    = PAGE_H - HEADER_H + (HEADER_H - badgeH) / 2;
  page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: NAVY_MID });
  drawText(badgeText, badgeX + badgePad, badgeY + badgePad + 1, 9, font, HDR_SUB);

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2 — QUICK STATS ROW
  // ═══════════════════════════════════════════════════════════════════
  const BOX_H   = 50;
  const BOX_GAP = 12;
  const BOX_W   = (CW - BOX_GAP * 2) / 3;

  const presentCount = opts.attendanceData.filter((a) => a.is_present).length;
  const stats = [
    { label: "Duration",     value: formatDuration() },
    { label: "Active tasks", value: String(opts.tasks.length) },
    { label: "Attendees",    value: presentCount > 0 ? String(presentCount) : "-" },
  ];

  for (let i = 0; i < 3; i++) {
    const s = stats[i]!;
    const bx = ML + i * (BOX_W + BOX_GAP);
    page.drawRectangle({ x: bx, y: y - BOX_H, width: BOX_W, height: BOX_H, color: STAT_BG });
    drawText(s.label, bx + 10, y - 14, 8, font, STAT_LBL);
    drawText(s.value, bx + 10, y - 36, 16, bold, STAT_VAL);
  }
  y -= BOX_H + 20;

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3 — EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  if (opts.executiveSummary?.trim()) {
    drawSectionHeading("Key decisions and takeaways", BLUE);
    const execLines = wrap(opts.executiveSummary.trim(), font, 10, CW - 15);
    const accentH   = execLines.length * 14;
    ensureSpace(accentH + 4);
    page.drawRectangle({ x: ML, y: y - accentH, width: 3, height: accentH, color: BLUE });
    for (const el of execLines) {
      drawText(el, ML + 15, y, 10, font, NOTE_TEXT);
      y -= 14;
    }
    y -= 20;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4 — ACTION ITEMS
  // ═══════════════════════════════════════════════════════════════════
  const actionItems = opts.tasks.filter((t) => t.columnName === "Action Items");
  if (actionItems.length > 0) {
    drawSectionHeading(
      "Action items",
      CORAL,
      `${actionItems.length} item${actionItems.length !== 1 ? "s" : ""}`
    );

    for (let ai = 0; ai < actionItems.length; ai++) {
      const item       = actionItems[ai]!;
      const titleLines = wrap(item.title || "Untitled", bold, 10, CW - 30);
      const metaParts  = [
        item.ownerName ? sanitize(item.ownerName) : null,
        item.dueDate   ? `Due: ${item.dueDate}`    : null,
      ].filter(Boolean) as string[];
      const rowH = Math.max(34, titleLines.length * 12 + (metaParts.length ? 12 : 0) + 14);
      ensureSpace(rowH + 2);

      if (ai % 2 !== 0) {
        page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: ALT_BG });
      }
      page.drawRectangle({ x: ML, y: y - rowH, width: 3, height: rowH, color: CORAL });
      // Checkbox square (10x10, 1pt border)
      page.drawRectangle({
        x: ML + 10, y: y - 11, width: 10, height: 10,
        color: WHITE, borderWidth: 1, borderColor: FAINT,
      });
      // Title lines
      let ty = y - 8;
      for (const tl of titleLines) { drawText(tl, ML + 28, ty, 10, bold, DARK); ty -= 12; }
      // Owner + due date
      if (metaParts.length) drawText(metaParts.join(" - "), ML + 28, ty, 9, font, MID);
      y -= rowH + 2;
    }
    y -= 20;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5 — DISCUSSION NOTES
  // ═══════════════════════════════════════════════════════════════════
  const visibleAgenda = opts.agenda.filter((a) => {
    const n = normalizeNotes(a.notes);
    return n && n !== "Not discussed this meeting";
  });

  if (visibleAgenda.length > 0) {
    drawSectionHeading("Discussion notes", GREEN);

    for (const ag of visibleAgenda) {
      const notes   = normalizeNotes(ag.notes);
      const dashIdx = ag.label.indexOf(" - ");
      const agCode  = dashIdx > -1 ? ag.label.slice(0, dashIdx).trim() : "";
      const agTitle = dashIdx > -1 ? ag.label.slice(dashIdx + 3).trim() : ag.label;
      const subLabel = agCode ? `${agCode} - ${agTitle}` : agTitle;

      const noteLines = wrap(notes, font, 10, CW - 24);
      const prevRaw   = normalizeNotes(ag.prevNotes);
      const prevLines = prevRaw ? wrap(prevRaw, font, 9, CW - 24) : [];
      const contentH  = noteLines.length * 14 + (prevLines.length ? 12 + prevLines.length * 11 : 0);

      ensureSpace(14 + contentH + 14);

      // Subheading
      drawText(sanitize(subLabel), ML + 15, y, 10, bold, NOTE_TEXT);
      y -= 14;

      // Thin left border running height of note content
      if (contentH > 0) {
        page.drawRectangle({ x: ML + 15, y: y - contentH, width: 1, height: contentH, color: FAINT });
      }

      for (const nl of noteLines) {
        drawText(nl, ML + 24, y, 10, font, NOTE_TEXT);
        y -= 14;
      }

      if (prevLines.length) {
        drawText("Previous meeting:", ML + 24, y, 9, font, PREV_TEXT);
        y -= 12;
        for (const pl of prevLines) {
          drawText(pl, ML + 24, y, 9, font, PREV_TEXT);
          y -= 11;
        }
      }

      y -= 14;
    }
    y -= 20;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 6 — ACTIVE TASKS OVERVIEW
  // ═══════════════════════════════════════════════════════════════════
  if (opts.tasks.length > 0) {
    const group = new Map<string, TaskRow[]>();
    for (const t of opts.tasks) {
      const key = t.columnName || "Uncategorized";
      if (!group.has(key)) group.set(key, []);
      group.get(key)!.push(t);
    }
    const cats = Array.from(group.keys());
    const taskCountLabel = `${opts.tasks.length} task${opts.tasks.length !== 1 ? "s" : ""} across ${cats.length} categor${cats.length !== 1 ? "ies" : "y"}`;
    drawSectionHeading("Active tasks overview", GRAY_ACC, taskCountLabel);

    for (const cat of cats) {
      const items = group.get(cat) ?? [];
      ensureSpace(20 + items.length * 22);

      page.drawRectangle({ x: ML, y: y - 14, width: 3, height: 14, color: GRAY_ACC });
      drawText(sanitize(cat), ML + 12, y - 12, 10, bold, DARK);
      y -= 20;

      for (const it of items) {
        ensureSpace(20);
        const tText = sanitize(it.title || "Untitled");
        const sText = it.status ? sanitize(it.status) : "";
        const oText = it.ownerName ? sanitize(it.ownerName).slice(0, 25) : "";
        drawText(tText.slice(0, 50), ML + 25, y, 10, font, DARK);
        if (sText) {
          const sx = ML + 25 + Math.min(font.widthOfTextAtSize(tText.slice(0, 50), 10), 250) + 10;
          drawText(sText, sx, y, 9, font, statusColor(sText));
        }
        if (oText) {
          drawText(oText, PAGE_W - MR - font.widthOfTextAtSize(oText, 9), y, 9, font, MID);
        }
        y -= 20;
      }
      y -= 8;
    }
    y -= 12;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 7 — MILESTONES
  // ═══════════════════════════════════════════════════════════════════
  if (opts.milestones.length > 0) {
    drawSectionHeading(
      "Milestones",
      GRAY_ACC,
      `${opts.milestones.length} milestone${opts.milestones.length !== 1 ? "s" : ""}`
    );

    for (const ms of opts.milestones) {
      const parts: string[] = [sanitize(ms.title || "Untitled")];
      if (ms.status)      parts.push(sanitize(ms.status));
      if (ms.target_date) parts.push(`Target: ${ms.target_date}`);
      if (ms.owner_name)  parts.push(sanitize(ms.owner_name));
      ensureSpace(20);
      page.drawRectangle({ x: ML, y: y - 14, width: 3, height: 14, color: GRAY_ACC });
      drawText(parts.join("  |  ").slice(0, 95), ML + 12, y - 12, 9, font, DARK);
      y -= 20;
    }
    y -= 14;
  }

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 8 — ONGOING NOTES
  // ═══════════════════════════════════════════════════════════════════
  if (opts.ongoingNotes.length > 0) {
    drawSectionHeading("Ongoing notes", GRAY_ACC);

    for (const note of opts.ongoingNotes) {
      const contentLines = note.content
        ? wrap(normalizeNotes(note.content), font, 10, CW - 20)
        : [];
      ensureSpace(14 + contentLines.length * 12 + 10);
      drawText(sanitize(note.title || "Untitled"), ML + 12, y, 11, bold, DARK);
      y -= 14;
      for (const cl of contentLines) {
        drawText(cl, ML + 20, y, 10, font, NOTE_TEXT);
        y -= 12;
      }
      y -= 10;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FOOTER — all pages
  // ═══════════════════════════════════════════════════════════════════
  const allPages   = pdf.getPages();
  const totalPages = allPages.length;
  for (let i = 0; i < totalPages; i++) {
    const pg = allPages[i]!;
    pg.drawLine({
      start: { x: ML,           y: FOOTER_Y + 16 },
      end:   { x: PAGE_W - MR,  y: FOOTER_Y + 16 },
      thickness: 0.5, color: FAINT,
    });
    pg.drawText(`Generated by ${sanitize(APP_NAME)}`, {
      x: ML, y: FOOTER_Y, size: 8, font, color: FOOTER_C,
    });
    const pnText = `Page ${i + 1} of ${totalPages}`;
    pg.drawText(pnText, {
      x: (PAGE_W - font.widthOfTextAtSize(pnText, 8)) / 2,
      y: FOOTER_Y, size: 8, font, color: FOOTER_C,
    });
    const confText = "Confidential";
    pg.drawText(confText, {
      x: PAGE_W - MR - font.widthOfTextAtSize(confText, 8),
      y: FOOTER_Y, size: 8, font, color: FOOTER_C,
    });
  }

  return pdf.save();
}

export async function POST(req: Request) {
  let sessionId = "";
  let meetingId = "";
  try {
    requireInternalToken(req);

    const body = (await req.json()) as {
      meetingId?: string;
      sessionId?: string;
    };

    meetingId = String(body.meetingId ?? "").trim();
    sessionId = String(body.sessionId ?? "").trim();

    console.log(`[finalize] starting meetingId=${meetingId} sessionId=${sessionId}`);

    if (!meetingId || !sessionId) {
      return NextResponse.json({ error: "meetingId + sessionId required" }, { status: 400 });
    }

    const admin = supabaseAdmin();

    // Fetch meeting
    const meetingRes = await admin
      .from("meetings")
      .select("id,title,location,start_at")
      .eq("id", meetingId)
      .single();
    if (meetingRes.error) throw meetingRes.error;

    const attendeesRes = await admin
      .from("meeting_attendees")
      .select("email,full_name,user_id,color_hex")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });
    if (attendeesRes.error) throw attendeesRes.error;

    const emailToName = new Map<string, string>();
    const colorByEmail = new Map<string, string>();
    for (const a of attendeesRes.data ?? []) {
      const typedA = a as { email?: string; full_name?: string; color_hex?: string };
      const e = String(typedA.email ?? "").trim().toLowerCase();
      const n = String(typedA.full_name ?? "").trim();
      if (e) emailToName.set(e, n || e);
      if (e && typedA.color_hex) colorByEmail.set(e, typedA.color_hex);
    }

    // Agenda items
    const agendaRes = await admin
      .from("meeting_agenda_items")
      .select("id,code,title,description,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });
    if (agendaRes.error) throw agendaRes.error;

    // Current session notes
    const notesRes = await admin
      .from("meeting_agenda_notes")
      .select("agenda_item_id,notes")
      .eq("session_id", sessionId);
    if (notesRes.error) throw notesRes.error;

    const notesMap: Record<string, string> = {};
    for (const r of notesRes.data ?? []) {
      const typedR = r as { agenda_item_id: string; notes?: string };
      notesMap[String(typedR.agenda_item_id)] = String(typedR.notes ?? "");
    }

    // Previous session notes
    const prevSessionRes = await admin
      .from("meeting_minutes_sessions")
      .select("id,ended_at,started_at")
      .eq("meeting_id", meetingId)
      .neq("id", sessionId)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevSessionId =
      !prevSessionRes.error && prevSessionRes.data?.id
        ? String(prevSessionRes.data.id)
        : null;

    const prevNotesMap: Record<string, string> = {};
    if (prevSessionId) {
      const prevNotesRes = await admin
        .from("meeting_agenda_notes")
        .select("agenda_item_id,notes")
        .eq("session_id", prevSessionId);
      if (prevNotesRes.error) throw prevNotesRes.error;
      for (const r of prevNotesRes.data ?? []) {
        const typedR = r as { agenda_item_id: string; notes?: string };
        prevNotesMap[String(typedR.agenda_item_id)] = String(typedR.notes ?? "");
      }
    }

    // Open tasks (exclude Completed)
    const tasksRes = await admin
      .from("meeting_tasks")
      .select("id,title,status,priority,owner_id,owner_email,owner_name,due_date,notes,column_id")
      .eq("meeting_id", meetingId)
      .neq("status", "Completed");
    if (tasksRes.error) throw tasksRes.error;

    const colsRes = await admin
      .from("meeting_task_columns")
      .select("id,name")
      .eq("meeting_id", meetingId);
    if (colsRes.error) throw colsRes.error;

    const profRes = await admin.from("profiles").select("id,full_name,email,color_hex");
    if (profRes.error) throw profRes.error;

    const colName = new Map(
      (colsRes.data ?? []).map((c: { id: string; name: string }) => [String(c.id), String(c.name)])
    );
    const ownerById = new Map(
      (profRes.data ?? []).map(
        (p: { id: string; full_name?: string; email?: string }) => [
          String(p.id),
          String(p.full_name?.trim() || p.email?.trim() || "Unassigned"),
        ]
      )
    );
    const emailById = new Map(
      (profRes.data ?? []).map((p: { id: string; email?: string }) => [
        String(p.id),
        String(p.email ?? "").trim(),
      ])
    );
    const colorById = new Map(
      (profRes.data ?? [])
        .filter((p: { id: string; color_hex?: string }) => p.color_hex)
        .map((p: { id: string; color_hex?: string }) => [String(p.id), String(p.color_hex)])
    );

    // Latest comment per task
    const taskIds = (tasksRes.data ?? [])
      .map((t: { id: string }) => String(t.id))
      .filter(Boolean);
    const latestCommentByTask = new Map<string, string>();
    if (taskIds.length) {
      const evRes = await admin
        .from("meeting_task_events")
        .select("task_id,event_type,payload,created_at")
        .in("task_id", taskIds)
        .eq("event_type", "comment")
        .order("created_at", { ascending: false });
      if (!evRes.error) {
        for (const ev of evRes.data ?? []) {
          const typedEv = ev as { task_id: string; payload?: { text?: string } };
          const tid = String(typedEv.task_id);
          if (!latestCommentByTask.has(tid)) {
            const text = String(typedEv.payload?.text ?? "").trim();
            if (text) latestCommentByTask.set(tid, text);
          }
        }
      }
    }

    type TaskData = {
      id: string;
      title?: string;
      status?: string;
      priority?: string;
      owner_id?: string;
      owner_email?: string;
      owner_name?: string;
      due_date?: string;
      notes?: string;
      column_id?: string;
    };

    const tasks: TaskRow[] = (tasksRes.data ?? []).map((t: TaskData) => {
      const col = colName.get(String(t.column_id)) ?? "Uncategorized";
      const ownerEmail =
        String(t.owner_email ?? "").trim().toLowerCase() ||
        (t.owner_id
          ? String(emailById.get(String(t.owner_id)) ?? "").trim().toLowerCase()
          : "");
      const ownerName =
        String(t.owner_name ?? "").trim() ||
        (t.owner_id ? String(ownerById.get(String(t.owner_id)) ?? "") : "") ||
        (ownerEmail ? String(emailToName.get(ownerEmail) ?? ownerEmail) : "") ||
        "Unassigned";
      const ownerColor =
        (t.owner_id ? colorById.get(String(t.owner_id)) : undefined) ??
        (ownerEmail ? colorByEmail.get(ownerEmail) : undefined) ??
        undefined;
      const due  = t.due_date ? " | Due: " + String(t.due_date) : "";
      const meta = `${col} | ${String(t.status ?? "")} | ${String(t.priority ?? "")} | ${ownerName}${due}`;
      return {
        title:         String(t.title ?? ""),
        meta,
        notes:         String(t.notes ?? "").trim() || null,
        latestComment: latestCommentByTask.get(String(t.id)) ?? null,
        columnName:    col,
        status:        String(t.status ?? ""),
        priority:      String(t.priority ?? ""),
        ownerName,
        ownerColor:    ownerColor ?? undefined,
        dueDate:       t.due_date ? String(t.due_date) : null,
      };
    });

    const agenda: AgendaPdfRow[] = (agendaRes.data ?? []).map(
      (a: { id: string; code?: string; title?: string }) => ({
        label:    `${a.code ? a.code + " - " : ""}${String(a.title ?? "")}`,
        notes:    String(notesMap[String(a.id)] ?? "").trim(),
        prevNotes: String(prevNotesMap[String(a.id)] ?? "").trim(),
      })
    );

    // Session data (includes started_at / ended_at for duration)
    const sessionRes = await admin
      .from("meeting_minutes_sessions")
      .select("reference_link,session_number,executive_summary,started_at,ended_at")
      .eq("id", sessionId)
      .maybeSingle();
    const referenceLink    = !sessionRes.error ? sessionRes.data?.reference_link    ?? null : null;
    const sessionNumber    = !sessionRes.error ? sessionRes.data?.session_number    ?? null : null;
    const executiveSummary = !sessionRes.error ? sessionRes.data?.executive_summary ?? null : null;
    const sessionStartedAt = !sessionRes.error ? sessionRes.data?.started_at        ?? null : null;
    const sessionEndedAt   = !sessionRes.error ? sessionRes.data?.ended_at          ?? null : null;

    // Milestones
    const milestonesRes = await admin
      .from("meeting_milestones")
      .select("id,title,description,target_date,status,priority,owner_id,owner_email,owner_name,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });

    const milestones = (milestonesRes.data ?? []).map((m: MilestoneData) => {
      const explicit    = String(m.owner_name ?? "").trim();
      const fromProfile = m.owner_id
        ? String(ownerById.get(String(m.owner_id)) ?? "").trim()
        : "";
      const ownerColor  = m.owner_id ? colorById.get(String(m.owner_id)) ?? null : null;
      return {
        title:       String(m.title ?? ""),
        target_date: m.target_date ? String(m.target_date) : null,
        status:      String(m.status ?? "Pending"),
        priority:    String(m.priority ?? "Normal"),
        owner_name:  explicit || fromProfile || "Unassigned",
        description: m.description ? String(m.description) : null,
        owner_color: ownerColor,
      };
    });

    // Ongoing notes
    const ongoingNotesRes = await admin
      .from("meeting_ongoing_notes")
      .select("id,title,content,category,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });

    const ongoingNotes = (ongoingNotesRes.data ?? []).map((n: OngoingNoteData) => ({
      title:    String(n.title ?? ""),
      content:  n.content  ? String(n.content)  : null,
      category: n.category ? String(n.category) : null,
    }));

    // Session attendance
    const attendanceRes = await admin
      .from("meeting_session_attendees")
      .select("email,full_name,is_present,is_guest")
      .eq("session_id", sessionId);

    const attendanceData: AttendanceRow[] = (attendanceRes.data ?? []).map(
      (a: AttendanceData) => ({
        full_name: a.full_name ? String(a.full_name) : null,
        email:     a.email     ? String(a.email)     : null,
        is_present: Boolean(a.is_present),
        is_guest:   Boolean(a.is_guest),
        color_hex:  a.email
          ? colorByEmail.get(String(a.email).trim().toLowerCase()) ?? null
          : null,
      })
    );

    // Build PDF
    const meeting   = meetingRes.data;
    const start     = new Date(meeting.start_at);
    const dateLabel = start.toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
    const timeLabel = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    const pdfBytes = await buildPdf({
      meetingTitle:    meeting.title,
      meetingDateLabel: dateLabel,
      meetingTimeLabel: timeLabel,
      meetingLocation: String(meeting.location ?? ""),
      agenda,
      tasks,
      referenceLink,
      attendanceData,
      milestones,
      ongoingNotes,
      sessionNumber,
      executiveSummary,
      sessionStartedAt,
      sessionEndedAt,
    });

    // Upload PDF
    const pdfBucket = process.env.MINUTES_PDF_BUCKET || "meeting-minutes-pdfs";
    const pdfPath   = `meetings/${meetingId}/sessions/${sessionId}/minutes.pdf`;

    const upPdf = await admin.storage.from(pdfBucket).upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upPdf.error) throw upPdf.error;

    const updSession = await admin
      .from("meeting_minutes_sessions")
      .update({ pdf_path: pdfPath })
      .eq("id", sessionId);
    if (updSession.error) throw updSession.error;

    let pdfUrl: string | null = null;
    try {
      const signed = await admin.storage
        .from(pdfBucket)
        .createSignedUrl(pdfPath, 60 * 60 * 24 * 30);
      if (!signed.error) pdfUrl = signed.data?.signedUrl ?? null;
    } catch {
      // ignore
    }

    try {
      const mark = await admin
        .from("meeting_minutes_sessions")
        .update({ email_status: "ready", email_error: null })
        .eq("id", sessionId);
      if (mark.error && String(mark.error.message || "").includes("email_status")) {
        // column doesn't exist yet — no-op
      }
    } catch {
      // ignore
    }

    await admin
      .from("meeting_minutes_sessions")
      .update({ ai_status: "done", ai_processed_at: new Date().toISOString() })
      .eq("id", sessionId);

    console.log(
      `[finalize] done meetingId=${meetingId} sessionId=${sessionId} pdfPath=${pdfPath}`
    );

    return NextResponse.json({ ok: true, pdfPath, pdfUrl });
  } catch (e: unknown) {
    const err          = e as Error;
    const errorMessage = err?.message || "";
    console.error("[finalize] error:", {
      meetingId,
      sessionId,
      message: errorMessage,
      stack: err?.stack?.split("\n").slice(0, 5).join("\n"),
    });
    if (sessionId) {
      try {
        await supabaseAdmin()
          .from("meeting_minutes_sessions")
          .update({ ai_status: "error", ai_error: `Finalize: ${errorMessage}` })
          .eq("id", sessionId);
      } catch {
        // ignore secondary failure
      }
    }
    const status = String(errorMessage).toLowerCase().includes("unauthorized") ? 401 : 500;
    return NextResponse.json({ error: errorMessage || "Finalize failed" }, { status });
  }
}
