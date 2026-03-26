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
  if (!expected) return; // if unset, allow (useful for local dev)
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

function clampText(s: string, maxLen: number): string {
  const t = (s ?? "").trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + "…";
}

function normalizeNotes(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * Very small word-wrap helper for pdf-lib.
 */
function wrapText(opts: { text: string; font: PDFFont; size: number; maxWidth: number }): string[] {
  const text = (opts.text ?? "").replace(/\r\n/g, "\n");
  const paras = text.split("\n");
  const lines: string[] = [];

  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let cur = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const w = words[i]!;
      const test = cur + " " + w;
      const width = opts.font.widthOfTextAtSize(test, opts.size);
      if (width <= opts.maxWidth) {
        cur = test;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    lines.push(cur);
  }

  return lines;
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

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function getStatusBadgeColors(status: string): { bg: RGB; text: RGB } {
  const n = status.toLowerCase().trim();
  if (n === "in progress" || n === "in-progress" || n === "active")
    return { bg: rgb(0.859, 0.890, 0.996), text: rgb(0.118, 0.251, 0.686) };
  if (n === "waiting")
    return { bg: rgb(0.996, 0.953, 0.780), text: rgb(0.573, 0.251, 0.055) };
  if (n === "completed" || n === "complete" || n === "done")
    return { bg: rgb(0.863, 0.988, 0.906), text: rgb(0.086, 0.396, 0.204) };
  if (n === "delayed" || n === "overdue" || n === "blocked")
    return { bg: rgb(0.996, 0.886, 0.886), text: rgb(0.600, 0.106, 0.106) };
  if (n === "needs review")
    return { bg: rgb(0.996, 0.929, 0.835), text: rgb(0.573, 0.251, 0.055) };
  // Pending / default
  return { bg: rgb(0.945, 0.961, 0.976), text: rgb(0.392, 0.455, 0.545) };
}

function getPriorityBorderColor(priority: string): RGB {
  const n = priority.toLowerCase().trim();
  if (n === "urgent") return rgb(0.937, 0.267, 0.267);
  if (n === "high") return rgb(0.976, 0.451, 0.086);
  if (n === "normal") return rgb(0.231, 0.510, 0.965);
  return rgb(0.796, 0.835, 0.882); // Low / default
}

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
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

  // ─── Color palette ────────────────────────────────────────────────
  const NAVY      = rgb(0.102, 0.157, 0.267); // #1A2844 — header bar
  const NAVY_DARK = rgb(0.071, 0.110, 0.196); // #12203A — session badge bg
  const WHITE     = rgb(1, 1, 1);
  const BLUE      = rgb(0.216, 0.541, 0.867); // #378ADD — executive summary accent
  const BLUE_BG   = rgb(0.918, 0.941, 0.976); // soft blue fill
  const CORAL     = rgb(0.847, 0.353, 0.188); // #D85A30 — action items accent
  const CORAL_BG  = rgb(0.984, 0.933, 0.922); // soft coral fill
  const GREEN     = rgb(0.114, 0.620, 0.459); // #1D9E75 — discussion notes accent
  const GREEN_BG  = rgb(0.890, 0.961, 0.941); // soft green fill
  const GRAY_ACC  = rgb(0.533, 0.529, 0.502); // #888780 — tasks / milestones accent
  const GRAY_BG   = rgb(0.957, 0.957, 0.953); // soft gray fill
  const DARK      = rgb(0.118, 0.153, 0.196); // near black text
  const MID       = rgb(0.392, 0.455, 0.545); // mid-gray text
  const BORDER    = rgb(0.886, 0.910, 0.941); // slate-200
  const SLATE_50  = rgb(0.973, 0.980, 0.988);

  // ─── Page geometry ────────────────────────────────────────────────
  const PAGE_W   = 612;
  const PAGE_H   = 792;
  const MARGIN_X = 44;
  const CW       = PAGE_W - MARGIN_X * 2; // content width = 524
  const HEADER_H = 76; // height of the big navy header on page 1
  const FOOTER_H = 30;
  const BOTTOM   = FOOTER_H + 10;

  // ─── Page state ───────────────────────────────────────────────────
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - HEADER_H - 18; // start below page-1 header

  const drawText = (t: string, x: number, yPos: number, size: number, f: PDFFont, color: RGB) => {
    if (!t) return;
    page.drawText(t, { x, y: yPos, size, font: f, color });
  };

  // Draw continuation header inline when a new page is added
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    // Thin blue top accent
    page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: BLUE });
    // Navy continuation bar
    page.drawRectangle({ x: 0, y: PAGE_H - 30, width: PAGE_W, height: 26, color: NAVY });
    const ct = clampText(opts.meetingTitle, 46);
    page.drawText(ct, { x: MARGIN_X, y: PAGE_H - 22, size: 10, font: bold, color: WHITE });
    const contLabel = "(continued)";
    const clW = font.widthOfTextAtSize(contLabel, 8);
    page.drawText(contLabel, {
      x: PAGE_W - MARGIN_X - clW,
      y: PAGE_H - 22,
      size: 8,
      font,
      color: rgb(0.600, 0.655, 0.729),
    });
    y = PAGE_H - 46;
  };

  const ensureSpace = (need: number) => {
    if (y - need < BOTTOM) newPage();
  };

  // Colored-bar section header
  const drawSection = (label: string, accentColor: RGB, bgColor: RGB) => {
    ensureSpace(32);
    const H = 22;
    page.drawRectangle({ x: MARGIN_X, y: y - H, width: CW, height: H, color: bgColor });
    page.drawRectangle({ x: MARGIN_X, y: y - H, width: 3, height: H, color: accentColor });
    drawText(label, MARGIN_X + 10, y - 15, 8, bold, accentColor);
    y -= H + 8;
  };

  // Pill badge — returns badge width
  const drawPill = (
    text: string,
    x: number,
    yPos: number,
    bg: RGB,
    textColor: RGB,
    textFont: PDFFont,
    sz: number,
    border?: RGB
  ): number => {
    const tw = textFont.widthOfTextAtSize(text, sz);
    const px = 6, py = 2;
    const bw = tw + px * 2, bh = sz + py * 2 + 2;
    page.drawRectangle({
      x, y: yPos - py - 1, width: bw, height: bh,
      color: bg, borderWidth: border ? 1 : 0, borderColor: border ?? bg,
    });
    drawText(text, x + px, yPos + 1, sz, textFont, textColor);
    return bw;
  };

  // ═══════════════════════════════════════════════════════════════════
  // PAGE 1 — NAVY HEADER BAR
  // ═══════════════════════════════════════════════════════════════════
  page.drawRectangle({ x: 0, y: PAGE_H - 4, width: PAGE_W, height: 4, color: BLUE });
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H - 4, color: NAVY });

  // Meeting title
  drawText(clampText(opts.meetingTitle, 52), MARGIN_X, PAGE_H - 30, 17, bold, WHITE);

  // Date / time / location
  const headerMeta = [opts.meetingDateLabel, opts.meetingTimeLabel, opts.meetingLocation]
    .filter(Boolean)
    .join("  \u2022  ");
  drawText(headerMeta, MARGIN_X, PAGE_H - 50, 10, font, rgb(0.686, 0.745, 0.820));

  // Session # badge (top-right of header)
  if (opts.sessionNumber) {
    const bt = `MEETING #${opts.sessionNumber}`;
    const btw = bold.widthOfTextAtSize(bt, 8);
    const bx = PAGE_W - MARGIN_X - btw - 14;
    page.drawRectangle({ x: bx - 4, y: PAGE_H - HEADER_H + 12, width: btw + 14, height: 20, color: NAVY_DARK });
    drawText(bt, bx + 3, PAGE_H - HEADER_H + 18, 8, bold, BLUE);
  }

  // ─── STATS ROW (3 boxes) ──────────────────────────────────────────
  const statBoxH = 46;
  const statGap  = 8;
  const statBoxW = (CW - statGap * 2) / 3;
  const statBoxY = y;

  const stats = [
    { val: String(opts.attendanceData.filter((a) => a.is_present).length), lbl: "ATTENDEES" },
    { val: String(opts.tasks.length), lbl: "OPEN TASKS" },
    { val: String(opts.agenda.length), lbl: "AGENDA ITEMS" },
  ];

  stats.forEach((s, i) => {
    const bx = MARGIN_X + i * (statBoxW + statGap);
    page.drawRectangle({ x: bx, y: statBoxY - statBoxH, width: statBoxW, height: statBoxH, color: NAVY });
    const vw = bold.widthOfTextAtSize(s.val, 20);
    drawText(s.val, bx + (statBoxW - vw) / 2, statBoxY - 22, 20, bold, WHITE);
    const lw = font.widthOfTextAtSize(s.lbl, 7);
    drawText(s.lbl, bx + (statBoxW - lw) / 2, statBoxY - 38, 7, font, rgb(0.580, 0.640, 0.720));
  });

  y -= statBoxH + 18;

  // ═══════════════════════════════════════════════════════════════════
  // EXECUTIVE SUMMARY
  // ═══════════════════════════════════════════════════════════════════
  if (opts.executiveSummary?.trim()) {
    drawSection("EXECUTIVE SUMMARY", BLUE, BLUE_BG);
    const execLines = wrapText({ text: opts.executiveSummary.trim(), font, size: 10, maxWidth: CW - 20 });
    for (const el of execLines) {
      ensureSpace(14);
      drawText(el, MARGIN_X + 10, y, 10, font, DARK);
      y -= 14;
    }
    y -= 10;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════
  drawSection("ATTENDANCE", GRAY_ACC, GRAY_BG);

  const present = opts.attendanceData.filter((a) => a.is_present && !a.is_guest);
  const absent  = opts.attendanceData.filter((a) => !a.is_present && !a.is_guest);
  const guests  = opts.attendanceData.filter((a) => a.is_guest);

  if (opts.attendanceData.length === 0) {
    ensureSpace(20);
    drawText("No attendance data recorded.", MARGIN_X + 10, y, 9, oblique, MID);
    y -= 20;
  } else {
    const drawChipRow = (label: string, items: AttendanceRow[], chipBg: RGB, dotFallback: RGB) => {
      if (items.length === 0) return;
      ensureSpace(28);
      drawText(label, MARGIN_X + 4, y, 7, bold, MID);
      y -= 13;
      let cx = MARGIN_X + 4;
      const chipH = 18;
      for (const att of items) {
        const name = (att.full_name ?? "").trim() || (att.email ?? "").trim() || "Unknown";
        const nameW = font.widthOfTextAtSize(name, 9);
        const chipW = nameW + 22;
        if (cx + chipW > PAGE_W - MARGIN_X) { y -= chipH + 4; cx = MARGIN_X + 4; ensureSpace(chipH + 4); }
        page.drawRectangle({ x: cx, y: y - 4, width: chipW, height: chipH, color: chipBg, borderWidth: 1, borderColor: BORDER });
        const dotColor = att.color_hex ? hexToRgb(att.color_hex) : dotFallback;
        page.drawCircle({ x: cx + 9, y: y + 5, size: 3, color: dotColor });
        drawText(name, cx + 16, y + 1, 9, font, DARK);
        cx += chipW + 6;
      }
      y -= chipH + 8;
    };

    drawChipRow("PRESENT", present, SLATE_50, MID);
    drawChipRow("ABSENT",  absent,  rgb(0.980, 0.960, 0.960), rgb(0.800, 0.400, 0.400));
    drawChipRow("GUESTS",  guests,  rgb(0.940, 0.955, 0.996), rgb(0.400, 0.400, 0.800));
  }

  y -= 8;

  // ═══════════════════════════════════════════════════════════════════
  // ACTION ITEMS (tasks in "Action Items" column)
  // ═══════════════════════════════════════════════════════════════════
  const actionItems = opts.tasks.filter((t) => t.columnName === "Action Items");
  drawSection("ACTION ITEMS", CORAL, CORAL_BG);

  if (actionItems.length === 0) {
    ensureSpace(20);
    drawText("No action items recorded.", MARGIN_X + 10, y, 9, oblique, MID);
    y -= 20;
  } else {
    for (let ai = 0; ai < actionItems.length; ai++) {
      const item = actionItems[ai]!;
      const titleLines = wrapText({ text: item.title || "Untitled", font: bold, size: 10, maxWidth: CW - 130 });
      const rowH = Math.max(28, titleLines.length * 12 + 16);
      ensureSpace(rowH + 2);

      // Alternating row background
      if (ai % 2 === 0) {
        page.drawRectangle({ x: MARGIN_X, y: y - rowH, width: CW, height: rowH, color: CORAL_BG });
      }

      // Priority left bar
      const prioColor = getPriorityBorderColor(item.priority ?? "Normal");
      page.drawRectangle({ x: MARGIN_X, y: y - rowH, width: 3, height: rowH, color: prioColor });

      // Coral dot
      page.drawCircle({ x: MARGIN_X + 10, y: y - rowH / 2, size: 3, color: CORAL });

      // Title (left)
      let ty = y - 5;
      for (const tl of titleLines) { drawText(tl, MARGIN_X + 18, ty, 10, bold, DARK); ty -= 12; }

      // Owner + due date (right)
      const rightX = PAGE_W - MARGIN_X - 115;
      const ownerDotC = item.ownerColor ? hexToRgb(item.ownerColor) : MID;
      page.drawCircle({ x: rightX + 4, y: y - 8, size: 2.5, color: ownerDotC });
      drawText(clampText(item.ownerName ?? "Unassigned", 18), rightX + 10, y - 11, 8, font, MID);
      if (item.dueDate) {
        drawText(`Due: ${item.dueDate}`, rightX, y - rowH + 7, 8, font, CORAL);
      }

      y -= rowH + 2;
    }
  }

  y -= 10;

  // ═══════════════════════════════════════════════════════════════════
  // DISCUSSION NOTES (side-by-side: this meeting | previous)
  // ═══════════════════════════════════════════════════════════════════
  drawSection("DISCUSSION NOTES", GREEN, GREEN_BG);

  if (opts.agenda.length === 0) {
    ensureSpace(20);
    drawText("No agenda items.", MARGIN_X + 10, y, 9, oblique, MID);
    y -= 20;
  }

  const noteGap = 10;
  const colW = (CW - noteGap) / 2;

  const drawAgendaSection = (row: AgendaPdfRow) => {
    const leftLines = wrapText({
      text: normalizeNotes(row.notes) || "(No notes)",
      font, size: 10, maxWidth: colW - 16,
    });
    const rightLines = wrapText({
      text: normalizeNotes(row.prevNotes) || "(No previous notes)",
      font, size: 10, maxWidth: colW - 16,
    });
    const maxLines = Math.max(leftLines.length, rightLines.length);
    const lineH = 12;
    const boxBodyH = Math.max(50, Math.min(320, maxLines * lineH + 28));
    ensureSpace(20 + boxBodyH + 14);

    // Agenda item header
    const labelParts = row.label.split(" - ");
    const code = labelParts.length > 1 ? labelParts[0]!.trim() : "";
    const title = labelParts.length > 1 ? labelParts.slice(1).join(" - ").trim() : row.label;

    if (code) {
      const codeW = bold.widthOfTextAtSize(code, 8) + 10;
      page.drawRectangle({ x: MARGIN_X, y: y - 14, width: codeW, height: 14, color: GREEN });
      drawText(code, MARGIN_X + 5, y - 10, 8, bold, WHITE);
      drawText(title, MARGIN_X + codeW + 6, y - 10, 11, bold, DARK);
    } else {
      page.drawRectangle({ x: MARGIN_X, y: y - 14, width: 3, height: 14, color: GREEN });
      drawText(title, MARGIN_X + 10, y - 10, 11, bold, DARK);
    }
    y -= 24;

    const leftX  = MARGIN_X;
    const rightX = MARGIN_X + colW + noteGap;

    page.drawRectangle({ x: leftX,  y: y - boxBodyH, width: colW, height: boxBodyH, color: SLATE_50, borderWidth: 1, borderColor: BORDER });
    page.drawRectangle({ x: rightX, y: y - boxBodyH, width: colW, height: boxBodyH, color: SLATE_50, borderWidth: 1, borderColor: BORDER });

    // Column header strips
    page.drawRectangle({ x: leftX,  y: y - 18, width: colW, height: 18, color: GREEN_BG });
    drawText("THIS MEETING",     leftX  + 8, y - 12, 7, bold, GREEN);
    page.drawRectangle({ x: rightX, y: y - 18, width: colW, height: 18, color: GRAY_BG });
    drawText("PREVIOUS MEETING", rightX + 8, y - 12, 7, bold, GRAY_ACC);

    let ly = y - 28;
    for (const ln of leftLines) {
      if (ly < y - boxBodyH + 8) break;
      const isPlaceholder = ln === "(No notes)";
      drawText(ln, leftX + 8, ly, 10, isPlaceholder ? oblique : font, isPlaceholder ? MID : DARK);
      ly -= lineH;
    }

    let ry = y - 28;
    for (const rn of rightLines) {
      if (ry < y - boxBodyH + 8) break;
      const isPlaceholder = rn === "(No previous notes)";
      drawText(rn, rightX + 8, ry, 10, isPlaceholder ? oblique : font, isPlaceholder ? MID : DARK);
      ry -= lineH;
    }

    y -= boxBodyH + 12;
  };

  for (const a of opts.agenda) {
    drawAgendaSection(a);
  }

  y -= 8;

  // ═══════════════════════════════════════════════════════════════════
  // ACTIVE TASKS (2-column, tasks NOT in "Action Items")
  // ═══════════════════════════════════════════════════════════════════
  const otherTasks = opts.tasks.filter((t) => t.columnName !== "Action Items");

  if (otherTasks.length > 0) {
    drawSection("ACTIVE TASKS", GRAY_ACC, GRAY_BG);

    const taskColGap = 14;
    const taskColW = (CW - taskColGap) / 2;
    let leftY = y;
    let rightY = y;

    const group = new Map<string, TaskRow[]>();
    for (const t of otherTasks) {
      const key = t.columnName || "Uncategorized";
      if (!group.has(key)) group.set(key, []);
      group.get(key)!.push(t);
    }
    const categories = Array.from(group.keys()).sort((a, b) => a.localeCompare(b));

    const drawTaskCategory = (x: number, yTop: number, cat: string, items: TaskRow[]) => {
      const headerH = 22;
      let bodyH = 8;
      for (const it of items) {
        const tLines = wrapText({ text: it.title || "", font: bold, size: 10, maxWidth: taskColW - 18 });
        bodyH += tLines.length * 12 + 16 + 12 + 8;
        const note = (it.notes ?? "").trim();
        const comm = (it.latestComment ?? "").trim();
        if (note) bodyH += Math.min(2, wrapText({ text: note, font: oblique, size: 8, maxWidth: taskColW - 18 }).length) * 10;
        if (comm) bodyH += Math.min(2, wrapText({ text: `Latest: ${comm}`, font: oblique, size: 8, maxWidth: taskColW - 18 }).length) * 10;
      }
      const totalH = headerH + Math.max(28, bodyH);

      page.drawRectangle({ x, y: yTop - totalH, width: taskColW, height: totalH, borderWidth: 1, borderColor: BORDER });
      page.drawRectangle({ x: x + 1, y: yTop - headerH, width: taskColW - 2, height: headerH - 1, color: GRAY_BG });
      drawText(cat, x + 8, yTop - 14, 10, bold, GRAY_ACC);
      const ct = String(items.length);
      drawPill(ct, x + taskColW - font.widthOfTextAtSize(ct, 8) - 18, yTop - 14, GRAY_BG, GRAY_ACC, font, 8, BORDER);

      let cy = yTop - headerH - 10;
      for (let ti = 0; ti < items.length; ti++) {
        const it = items[ti]!;
        if (ti > 0) {
          page.drawLine({ start: { x: x + 6, y: cy + 6 }, end: { x: x + taskColW - 6, y: cy + 6 }, thickness: 0.5, color: GRAY_BG });
          cy -= 2;
        }
        const tLines = wrapText({ text: it.title || "", font: bold, size: 10, maxWidth: taskColW - 18 });
        for (const tl of tLines) { drawText(tl, x + 10, cy, 10, bold, DARK); cy -= 12; }
        if (it.status) {
          const sc = getStatusBadgeColors(it.status);
          const sw = drawPill(it.status, x + 10, cy, sc.bg, sc.text, font, 7);
          if (it.dueDate) drawPill(it.dueDate, x + 10 + sw + 6, cy, SLATE_50, MID, font, 7, BORDER);
        } else if (it.dueDate) {
          drawPill(it.dueDate, x + 10, cy, SLATE_50, MID, font, 7, BORDER);
        }
        cy -= 14;
        const ownerDotC = it.ownerColor ? hexToRgb(it.ownerColor) : MID;
        page.drawCircle({ x: x + 14, y: cy + 3, size: 2.5, color: ownerDotC });
        drawText(clampText(it.ownerName ?? "Unassigned", 30), x + 20, cy, 9, font, MID);
        cy -= 12;
        const note = (it.notes ?? "").trim();
        if (note) {
          for (const nl of wrapText({ text: note, font: oblique, size: 8, maxWidth: taskColW - 18 }).slice(0, 2)) {
            drawText(nl, x + 10, cy, 8, oblique, MID); cy -= 10;
          }
        }
        const comm = (it.latestComment ?? "").trim();
        if (comm) {
          for (const cl of wrapText({ text: `Latest: ${comm}`, font: oblique, size: 8, maxWidth: taskColW - 18 }).slice(0, 2)) {
            drawText(cl, x + 10, cy, 8, oblique, MID); cy -= 10;
          }
        }
        cy -= 4;
      }
      return totalH;
    };

    for (const cat of categories) {
      const items = group.get(cat) ?? [];
      const rough = 22 + Math.min(300, 40 + items.length * 50);
      if (Math.min(leftY, rightY) - rough < BOTTOM) {
        newPage();
        drawSection("ACTIVE TASKS (CONT.)", GRAY_ACC, GRAY_BG);
        leftY = y; rightY = y;
      }
      const useLeft = leftY >= rightY;
      if ((useLeft ? leftY : rightY) - 80 < BOTTOM) {
        newPage();
        drawSection("ACTIVE TASKS (CONT.)", GRAY_ACC, GRAY_BG);
        leftY = y; rightY = y;
      }
      const drawX = useLeft ? MARGIN_X : MARGIN_X + taskColW + taskColGap;
      const drawY = useLeft ? leftY : rightY;
      const h = drawTaskCategory(drawX, drawY, cat, items);
      if (useLeft) leftY -= h + 10;
      else rightY -= h + 10;
    }

    if (categories.length > 0) y = Math.min(leftY, rightY) - 8;
  }

  // ═══════════════════════════════════════════════════════════════════
  // MILESTONES
  // ═══════════════════════════════════════════════════════════════════
  if (opts.milestones.length > 0) {
    drawSection("MILESTONES", GRAY_ACC, GRAY_BG);

    const sortedMs = [...opts.milestones].sort((a, b) => {
      if (a.target_date && !b.target_date) return -1;
      if (!a.target_date && b.target_date) return 1;
      if (a.target_date && b.target_date) return a.target_date.localeCompare(b.target_date);
      return 0;
    });

    const msLeftW  = CW * 0.65;
    const msRightW = CW * 0.35;

    for (let mi = 0; mi < sortedMs.length; mi++) {
      const ms = sortedMs[mi]!;
      const titleLines = wrapText({ text: ms.title, font: bold, size: 10, maxWidth: msLeftW - 20 });
      const descLines  = ms.description
        ? wrapText({ text: ms.description, font: oblique, size: 9, maxWidth: msRightW - 12 }).slice(0, 2)
        : [];
      const rowH = Math.max(36, titleLines.length * 12 + 24);
      ensureSpace(rowH + 4);

      const rowTop = y;
      const borderColor = getPriorityBorderColor(ms.priority);
      page.drawRectangle({ x: MARGIN_X, y: rowTop - rowH, width: 4, height: rowH, color: borderColor });

      if (mi === 0) page.drawLine({ start: { x: MARGIN_X, y: rowTop }, end: { x: PAGE_W - MARGIN_X, y: rowTop }, thickness: 1, color: BORDER });
      page.drawLine({ start: { x: MARGIN_X,       y: rowTop - rowH }, end: { x: PAGE_W - MARGIN_X, y: rowTop - rowH }, thickness: 1, color: BORDER });
      page.drawLine({ start: { x: MARGIN_X,       y: rowTop }, end: { x: MARGIN_X,       y: rowTop - rowH }, thickness: 1, color: BORDER });
      page.drawLine({ start: { x: PAGE_W - MARGIN_X, y: rowTop }, end: { x: PAGE_W - MARGIN_X, y: rowTop - rowH }, thickness: 1, color: BORDER });

      let ly = rowTop - 12;
      for (const tl of titleLines) { drawText(tl, MARGIN_X + 10, ly, 10, bold, DARK); ly -= 12; }

      const metaY = ly;
      let mx = MARGIN_X + 10;
      if (ms.target_date) { drawText(ms.target_date, mx, metaY, 8, font, MID); mx += font.widthOfTextAtSize(ms.target_date, 8) + 8; }
      const sc = getStatusBadgeColors(ms.status);
      const sw = drawPill(ms.status, mx, metaY, sc.bg, sc.text, font, 7);
      mx += sw + 8;
      const ownerDotColor = ms.owner_color ? hexToRgb(ms.owner_color) : MID;
      page.drawCircle({ x: mx + 3, y: metaY + 3, size: 2.5, color: ownerDotColor });
      drawText(clampText(ms.owner_name, 20), mx + 9, metaY, 8, font, MID);

      if (descLines.length > 0) {
        let ry = rowTop - 12;
        const rightX = MARGIN_X + msLeftW;
        for (const dl of descLines) { drawText(dl, rightX, ry, 9, oblique, MID); ry -= 11; }
      }

      y -= rowH;
    }

    y -= 12;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ONGOING NOTES
  // ═══════════════════════════════════════════════════════════════════
  if (opts.ongoingNotes.length > 0) {
    drawSection("ONGOING NOTES", GRAY_ACC, GRAY_BG);

    for (const note of opts.ongoingNotes) {
      const titleLines   = wrapText({ text: note.title, font: bold, size: 11, maxWidth: CW - 20 });
      const contentLines = note.content
        ? wrapText({ text: normalizeNotes(note.content), font, size: 10, maxWidth: CW - 30 })
        : [];
      const neededH = titleLines.length * 14 + contentLines.length * 12 + (note.category ? 14 : 0) + 24;
      ensureSpace(neededH);

      page.drawRectangle({ x: MARGIN_X, y: y - neededH, width: CW, height: neededH, color: rgb(1, 1, 1), borderWidth: 1, borderColor: BORDER });

      let ny = y - 10;
      for (const tl of titleLines) { drawText(tl, MARGIN_X + 10, ny, 11, bold, DARK); ny -= 14; }
      if (note.category) { drawText(note.category, MARGIN_X + 10, ny, 8, font, GRAY_ACC); ny -= 14; }
      if (contentLines.length > 0) {
        for (const cl of contentLines) { drawText(cl, MARGIN_X + 16, ny, 10, font, MID); ny -= 12; }
      } else {
        drawText("(No content)", MARGIN_X + 16, ny, 10, oblique, MID);
      }

      y -= neededH + 8;
    }
  }

  // Reference link
  if (opts.referenceLink) {
    ensureSpace(40);
    page.drawLine({ start: { x: MARGIN_X, y }, end: { x: PAGE_W - MARGIN_X, y }, thickness: 1, color: BORDER });
    y -= 16;
    drawText("Reference:", MARGIN_X, y, 9, bold, DARK);
    drawText(clampText(opts.referenceLink, 140), MARGIN_X + 70, y, 9, font, BLUE);
    y -= 12;
  }

  // ═══════════════════════════════════════════════════════════════════
  // FOOTER — all pages
  // ═══════════════════════════════════════════════════════════════════
  const allPages = pdf.getPages();
  const totalPages = allPages.length;
  for (let i = 0; i < totalPages; i++) {
    const pg = allPages[i]!;

    // Footer separator
    pg.drawLine({ start: { x: MARGIN_X, y: FOOTER_H + 4 }, end: { x: PAGE_W - MARGIN_X, y: FOOTER_H + 4 }, thickness: 0.5, color: BORDER });

    // Left: brand
    pg.drawText(`Generated by ${APP_NAME}`, { x: MARGIN_X, y: FOOTER_H - 10, size: 7, font, color: MID });

    // Center: page number
    const pnText = `Page ${i + 1} of ${totalPages}`;
    const pnW = font.widthOfTextAtSize(pnText, 7);
    pg.drawText(pnText, { x: (PAGE_W - pnW) / 2, y: FOOTER_H - 10, size: 7, font, color: MID });

    // Right: CONFIDENTIAL
    const confText = "CONFIDENTIAL";
    const confW = bold.widthOfTextAtSize(confText, 7);
    pg.drawText(confText, { x: PAGE_W - MARGIN_X - confW, y: FOOTER_H - 10, size: 7, font: bold, color: MID });
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

    // Fetch meeting + attendees (include names)
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

    // Current notes
    const agendaRes = await admin
      .from("meeting_agenda_items")
      .select("id,code,title,description,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });
    if (agendaRes.error) throw agendaRes.error;

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

    const prevSessionId = !prevSessionRes.error && prevSessionRes.data?.id ? String(prevSessionRes.data.id) : null;

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

    // OPEN tasks only (no Completed)
    const tasksRes = await admin
      .from("meeting_tasks")
      .select("id,title,status,priority,owner_id,owner_email,owner_name,due_date,notes,column_id")
      .eq("meeting_id", meetingId)
      .neq("status", "Completed");
    if (tasksRes.error) throw tasksRes.error;

    const colsRes = await admin.from("meeting_task_columns").select("id,name").eq("meeting_id", meetingId);
    if (colsRes.error) throw colsRes.error;

    const profRes = await admin.from("profiles").select("id,full_name,email,color_hex");
    if (profRes.error) throw profRes.error;

    const colName = new Map((colsRes.data ?? []).map((c: { id: string; name: string }) => [String(c.id), String(c.name)]));
    const ownerById = new Map(
      (profRes.data ?? []).map((p: { id: string; full_name?: string; email?: string }) => [
        String(p.id),
        String(p.full_name?.trim() || p.email?.trim() || "Unassigned"),
      ])
    );
    const emailById = new Map((profRes.data ?? []).map((p: { id: string; email?: string }) => [String(p.id), String(p.email ?? "").trim()]));
    const colorById = new Map(
      (profRes.data ?? [])
        .filter((p: { id: string; color_hex?: string }) => p.color_hex)
        .map((p: { id: string; color_hex?: string }) => [String(p.id), String(p.color_hex)])
    );

    // Latest comment per task (from events)
    const taskIds = (tasksRes.data ?? []).map((t: { id: string }) => String(t.id)).filter(Boolean);
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

      // owner priority:
      // 1) explicit owner_name
      // 2) owner_id -> profiles
      // 3) owner_email -> meeting attendees name
      const ownerEmail = String(t.owner_email ?? "").trim().toLowerCase() || (t.owner_id ? String(emailById.get(String(t.owner_id)) ?? "").trim().toLowerCase() : "");
      const ownerName =
        String(t.owner_name ?? "").trim() ||
        (t.owner_id ? String(ownerById.get(String(t.owner_id)) ?? "") : "") ||
        (ownerEmail ? String(emailToName.get(ownerEmail) ?? ownerEmail) : "") ||
        "Unassigned";

      // Resolve owner color from profiles or attendees
      const ownerColor = (t.owner_id ? colorById.get(String(t.owner_id)) : undefined)
        ?? (ownerEmail ? colorByEmail.get(ownerEmail) : undefined)
        ?? undefined;

      const due = t.due_date ? " | Due: " + String(t.due_date) : "";

      const meta = `${col} | ${String(t.status ?? "")} | ${String(t.priority ?? "")} | ${ownerName}${due}`;

      return {
        title: String(t.title ?? ""),
        meta,
        notes: String(t.notes ?? "").trim() || null,
        latestComment: latestCommentByTask.get(String(t.id)) ?? null,
        columnName: col,
        status: String(t.status ?? ""),
        priority: String(t.priority ?? ""),
        ownerName,
        ownerColor: ownerColor ?? undefined,
        dueDate: t.due_date ? String(t.due_date) : null,
      };
    });

    const agenda: AgendaPdfRow[] = (agendaRes.data ?? []).map((a: { id: string; code?: string; title?: string }) => ({
      label: `${a.code ? a.code + " - " : ""}${String(a.title ?? "")}`,
      notes: String(notesMap[String(a.id)] ?? "").trim(),
      prevNotes: String(prevNotesMap[String(a.id)] ?? "").trim(),
    }));

    // Reference link and session number stored on the session
    const sessionRes = await admin
      .from("meeting_minutes_sessions")
      .select("reference_link,session_number,executive_summary")
      .eq("id", sessionId)
      .maybeSingle();
    const referenceLink    = !sessionRes.error ? sessionRes.data?.reference_link    ?? null : null;
    const sessionNumber    = !sessionRes.error ? sessionRes.data?.session_number    ?? null : null;
    const executiveSummary = !sessionRes.error ? sessionRes.data?.executive_summary ?? null : null;

    // Fetch milestones
    const milestonesRes = await admin
      .from("meeting_milestones")
      .select("id,title,description,target_date,status,priority,owner_id,owner_email,owner_name,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });

    const milestones = (milestonesRes.data ?? []).map((m: MilestoneData) => {
      const explicit = String(m.owner_name ?? "").trim();
      const fromProfile = m.owner_id ? String(ownerById.get(String(m.owner_id)) ?? "").trim() : "";
      const ownerColor = m.owner_id ? colorById.get(String(m.owner_id)) ?? null : null;
      return {
        title: String(m.title ?? ""),
        target_date: m.target_date ? String(m.target_date) : null,
        status: String(m.status ?? "Pending"),
        priority: String(m.priority ?? "Normal"),
        owner_name: explicit || fromProfile || "Unassigned",
        description: m.description ? String(m.description) : null,
        owner_color: ownerColor,
      };
    });

    // Fetch ongoing notes
    const ongoingNotesRes = await admin
      .from("meeting_ongoing_notes")
      .select("id,title,content,category,position")
      .eq("meeting_id", meetingId)
      .order("position", { ascending: true });

    const ongoingNotes = (ongoingNotesRes.data ?? []).map((n: OngoingNoteData) => ({
      title: String(n.title ?? ""),
      content: n.content ? String(n.content) : null,
      category: n.category ? String(n.category) : null,
    }));

    // Fetch session attendance
    const attendanceRes = await admin
      .from("meeting_session_attendees")
      .select("email,full_name,is_present,is_guest")
      .eq("session_id", sessionId);

    const attendanceData: AttendanceRow[] = (attendanceRes.data ?? []).map((a: AttendanceData) => ({
      full_name: a.full_name ? String(a.full_name) : null,
      email: a.email ? String(a.email) : null,
      is_present: Boolean(a.is_present),
      is_guest: Boolean(a.is_guest),
      color_hex: a.email ? colorByEmail.get(String(a.email).trim().toLowerCase()) ?? null : null,
    }));

    // Build PDF
    const meeting = meetingRes.data;
    const start = new Date(meeting.start_at);
    const dateLabel = start.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    const timeLabel = `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

    const pdfBytes = await buildPdf({
      meetingTitle: meeting.title,
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
    });

    // Upload PDF
    const pdfBucket = process.env.MINUTES_PDF_BUCKET || "meeting-minutes-pdfs";
    const pdfPath = `meetings/${meetingId}/sessions/${sessionId}/minutes.pdf`;

    const upPdf = await admin.storage.from(pdfBucket).upload(pdfPath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upPdf.error) throw upPdf.error;

    // Save PDF path
    const updSession = await admin.from("meeting_minutes_sessions").update({ pdf_path: pdfPath }).eq("id", sessionId);
    if (updSession.error) throw updSession.error;

    // Signed URL (optional)
    let pdfUrl: string | null = null;
    try {
      const signed = await admin.storage.from(pdfBucket).createSignedUrl(pdfPath, 60 * 60 * 24 * 30);
      if (!signed.error) pdfUrl = signed.data?.signedUrl ?? null;
    } catch {
      // ignore
    }

    // Mark email as ready to send (manual send endpoint handles delivery)
    try {
      const mark = await admin
        .from("meeting_minutes_sessions")
        .update({ email_status: "ready", email_error: null })
        .eq("id", sessionId);
      // ignore if column doesn't exist yet
      if (mark.error && String(mark.error.message || "").includes("email_status")) {
        // no-op
      }
    } catch {
      // ignore
    }

    // Mark processing complete — this is what the frontend polls for
    await admin
      .from("meeting_minutes_sessions")
      .update({ ai_status: "done", ai_processed_at: new Date().toISOString() })
      .eq("id", sessionId);

    console.log(`[finalize] done meetingId=${meetingId} sessionId=${sessionId} pdfPath=${pdfPath}`);

    return NextResponse.json({ ok: true, pdfPath, pdfUrl });
  } catch (e: unknown) {
    const err = e as Error;
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
