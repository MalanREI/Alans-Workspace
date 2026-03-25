import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, PDFString, PDFName } from "pdf-lib";
import { supabaseAdmin } from "@/src/lib/supabase/admin";
import type { FullReport, SiteReportItem } from "@/src/lib/types/site-reports";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmbeddedImage = Awaited<ReturnType<PDFDocument["embedPng"]>>;

// ─── Color palette ────────────────────────────────────────────────────────────

const COLOR = {
  headerBg:    rgb(0.09, 0.12, 0.18),
  headerText:  rgb(1, 1, 1),
  sectionBg:   rgb(0.94, 0.96, 0.98),
  tableHead:   rgb(0.20, 0.24, 0.34),
  tableHeadTx: rgb(1, 1, 1),
  rowAlt:      rgb(0.96, 0.97, 0.98),
  rowWhite:    rgb(1, 1, 1),
  border:      rgb(0.78, 0.82, 0.88),
  bodyText:    rgb(0.10, 0.12, 0.18),
  mutedText:   rgb(0.45, 0.48, 0.55),
  green:       rgb(0.15, 0.62, 0.38),
  greenLight:  rgb(0.88, 0.97, 0.92),
  yellow:      rgb(0.82, 0.60, 0.05),
  yellowLight: rgb(0.99, 0.95, 0.82),
  red:         rgb(0.80, 0.18, 0.18),
  redLight:    rgb(0.99, 0.88, 0.88),
  blue:        rgb(0.14, 0.42, 0.78),
  blueLight:   rgb(0.88, 0.93, 0.99),
  grayLight:   rgb(0.90, 0.91, 0.93),
  footerBg:    rgb(0.09, 0.12, 0.18),
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const PAGE_W    = 612;
const PAGE_H    = 792;
const MARGIN_L  = 44;
const MARGIN_R  = 44;
const MARGIN_B  = 52;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R; // 524
const FOOTER_H  = 28;
const HEADER_H  = 72;
const STATUS_W   = 46;  // status column — same x-position across ALL tables

// ─── Shared column alignment constants ───────────────────────────────────────
// Every table's "name" column is NAME_COL_W wide, starting at MARGIN_L.
// Every table's "status" column therefore starts at MARGIN_L + NAME_COL_W = 204.
// For recommendations (dated), DATE_COL_W + REC_NAME_W = NAME_COL_W so Status
// still lands at x=204. Comment column is always 318px for item tables.
const NAME_COL_W  = 160; // milestone name / item name column width
const DATE_COL_W  = 60;  // "Date Made" prefix for recommendations
// Derived: recommendation item-name width = NAME_COL_W - DATE_COL_W = 100
// Milestone extra date columns (sit between Status and Comments)
const MS_DATE_W   = 70;  // Milestone Date column
const MS_SCHED_W  = 70;  // Scheduled Date column
const MS_COMP_W   = 70;  // Completed Date column
// Milestone comment = CONTENT_W - NAME_COL_W - STATUS_W - MS_DATE_W - MS_SCHED_W - MS_COMP_W = 108
// Item comment      = CONTENT_W - NAME_COL_W - STATUS_W = 318 (same for all item types)

// ─── Date formatting (MM/DD/YYYY) — improvement #3 ───────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`;
  return d;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

// #9: completed maps to blue (not green)
function statusBg(status: string): ReturnType<typeof rgb> {
  const s = status.toLowerCase();
  if (s === "green" || s === "on_track") return COLOR.greenLight;
  if (s === "yellow" || s === "risk")    return COLOR.yellowLight;
  if (s === "red"    || s === "behind")  return COLOR.redLight;
  if (s === "completed")                 return COLOR.blueLight;
  if (s === "not_started")               return COLOR.grayLight;
  return COLOR.rowAlt;
}

function statusFg(status: string): ReturnType<typeof rgb> {
  const s = status.toLowerCase();
  if (s === "green" || s === "on_track") return COLOR.green;
  if (s === "yellow" || s === "risk")    return COLOR.yellow;
  if (s === "red"    || s === "behind")  return COLOR.red;
  if (s === "completed")                 return COLOR.blue;
  return COLOR.mutedText;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    on_track: "On Track", risk: "Risk", behind: "Behind",
    completed: "Completed", not_started: "Not Started",
    open: "Open", in_progress: "In Progress", closed: "Closed",
    green: "Green", yellow: "Yellow", red: "Red",
  };
  return map[status.toLowerCase()] ?? status;
}

// ─── Draw context ─────────────────────────────────────────────────────────────

type Ctx = {
  doc: PDFDocument;
  pages: ReturnType<PDFDocument["addPage"]>[];
  pageIdx: number;
  y: number;
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>;
};

function curPage(ctx: Ctx) { return ctx.pages[ctx.pageIdx]; }

function addPage(ctx: Ctx) {
  const page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(page);
  ctx.pageIdx = ctx.pages.length - 1;
  ctx.y = PAGE_H - 62;
  drawPageFrame(ctx);
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN_B + FOOTER_H + 10) addPage(ctx);
}

// ─── Page frame ───────────────────────────────────────────────────────────────

function drawPageFrame(ctx: Ctx) {
  const page = curPage(ctx);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: COLOR.footerBg });
  page.drawText("Confidential: For Internal AT-PD Use Only", {
    x: MARGIN_L, y: 9, size: 7, font: ctx.font, color: rgb(0.7, 0.72, 0.78),
  });
  const pn = `Page ${ctx.pageIdx + 1} of ${ctx.pages.length}`;
  page.drawText(pn, {
    x: PAGE_W - MARGIN_R - ctx.font.widthOfTextAtSize(pn, 7),
    y: 9, size: 7, font: ctx.font, color: rgb(0.7, 0.72, 0.78),
  });
}

function finalizePageNumbers(ctx: Ctx) {
  const total = ctx.pages.length;
  for (let i = 0; i < total; i++) {
    const page = ctx.pages[i];
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: FOOTER_H, color: COLOR.footerBg });
    page.drawText("Confidential: For Internal AT-PD Use Only", {
      x: MARGIN_L, y: 9, size: 7, font: ctx.font, color: rgb(0.7, 0.72, 0.78),
    });
    const pn = `Page ${i + 1} of ${total}`;
    page.drawText(pn, {
      x: PAGE_W - MARGIN_R - ctx.font.widthOfTextAtSize(pn, 7),
      y: 9, size: 7, font: ctx.font, color: rgb(0.7, 0.72, 0.78),
    });
  }
}

// ─── Text utilities ───────────────────────────────────────────────────────────

function clampText(text: string, maxW: number, size: number, font: Ctx["font"]): string {
  if (!text) return "";
  let out = text;
  while (out.length > 0 && font.widthOfTextAtSize(out + "...", size) > maxW) out = out.slice(0, -1);
  return out.length < text.length ? out + "..." : text;
}

function wrapText(text: string, maxW: number, size: number, font: Ctx["font"]): string[] {
  if (!text) return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW) { if (cur) lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// ─── Section header bar ───────────────────────────────────────────────────────

function drawSectionHeader(ctx: Ctx, title: string) {
  ensureSpace(ctx, 28);
  const page = curPage(ctx);
  page.drawRectangle({ x: MARGIN_L, y: ctx.y - 20, width: CONTENT_W, height: 22, color: COLOR.tableHead });
  page.drawText(title.toUpperCase(), {
    x: MARGIN_L + 8, y: ctx.y - 14, size: 9, font: ctx.bold, color: COLOR.tableHeadTx,
  });
  ctx.y -= 22;
}

// ─── Table row ────────────────────────────────────────────────────────────────

type CellDef = {
  text: string;
  width: number;
  isStatus?: boolean;    // draw background color only (no text) — improvement #9
  statusValue?: string;
  wrap?: boolean;
  bold?: boolean;        // render cell text bold — improvements #6 & #7
};

// compact=true: smaller rows for the milestone table — improvement #8
function drawTableRow(ctx: Ctx, cells: CellDef[], isHeader: boolean, altRow: boolean, compact = false): number {
  const fs_   = isHeader ? 7.5 : (compact ? 6.5 : 7);
  const lh    = fs_ + 2;
  const pad   = compact ? 2.5 : 4;
  const minH  = compact ? 14 : 18;

  let maxLines = 1;
  if (!isHeader) {
    for (const c of cells) {
      if (c.wrap) maxLines = Math.max(maxLines, wrapText(c.text, c.width - pad * 2, fs_, ctx.font).length);
    }
  }
  const rowH = Math.max(minH, maxLines * lh + pad * 2);

  ensureSpace(ctx, rowH);
  const page = curPage(ctx);
  const rowY = ctx.y - rowH;
  let x = MARGIN_L;

  for (const c of cells) {
    const bg = isHeader
      ? COLOR.tableHead
      : (c.isStatus && c.statusValue) ? statusBg(c.statusValue)
      : altRow ? COLOR.rowAlt : COLOR.rowWhite;

    page.drawRectangle({ x, y: rowY, width: c.width, height: rowH, color: bg, borderColor: COLOR.border, borderWidth: 0.4 });

    // #9: status cells in data rows are color-only — skip text
    if (!isHeader && c.isStatus) {
      // intentionally empty
    } else {
      const f = (!isHeader && c.bold) ? ctx.bold : (isHeader ? ctx.bold : ctx.font);
      const col = isHeader ? COLOR.tableHeadTx : COLOR.bodyText;

      if (c.wrap && !isHeader) {
        const lines = wrapText(c.text, c.width - pad * 2, fs_, ctx.font);
        lines.forEach((line, i) => {
          page.drawText(line, { x: x + pad, y: rowY + rowH - pad - fs_ - i * lh, size: fs_, font: f, color: col });
        });
      } else {
        const txt = isHeader ? c.text : clampText(c.text, c.width - pad * 2, fs_, ctx.font);
        page.drawText(txt, { x: x + pad, y: rowY + (rowH - fs_) / 2, size: fs_, font: f, color: col });
      }
    }

    x += c.width;
  }

  ctx.y = rowY;
  return rowH;
}

function drawFinalTrackerCta(ctx: Ctx, url: string) {
  ensureSpace(ctx, 88);
  const page = curPage(ctx);

  ctx.y -= 12;
  const dividerY = ctx.y;
  page.drawLine({
    start: { x: MARGIN_L, y: dividerY },
    end: { x: PAGE_W - MARGIN_R, y: dividerY },
    thickness: 0.6,
    color: COLOR.border,
  });

  const blurb = "Complete observation history and item tracking available online";
  const blurbSize = 8.5;
  const blurbW = ctx.font.widthOfTextAtSize(blurb, blurbSize);
  const blurbX = (PAGE_W - blurbW) / 2;
  const blurbY = dividerY - 18;
  page.drawText(blurb, { x: blurbX, y: blurbY, size: blurbSize, font: ctx.font, color: COLOR.mutedText });

  const cta = "View Project Tracker";
  const ctaSize = 12;
  const ctaW = ctx.bold.widthOfTextAtSize(cta, ctaSize);
  const ctaX = (PAGE_W - ctaW) / 2;
  const ctaY = blurbY - 20;
  page.drawText(cta, { x: ctaX, y: ctaY, size: ctaSize, font: ctx.bold, color: COLOR.blue });
  page.drawLine({
    start: { x: ctaX, y: ctaY - 1 },
    end: { x: ctaX + ctaW, y: ctaY - 1 },
    thickness: 0.7,
    color: COLOR.blue,
  });

  try {
    const annotRef = ctx.doc.context.register(
      ctx.doc.context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Link"),
        Rect: [ctaX - 2, ctaY - 3, ctaX + ctaW + 2, ctaY + ctaSize + 2],
        Border: [0, 0, 0],
        C: [],
        A: ctx.doc.context.obj({
          S: PDFName.of("URI"),
          URI: PDFString.of(url),
        }),
      })
    );
    page.node.addAnnot(annotRef);
  } catch {
    // Annotation support can vary by PDF reader.
  }

  const footer = "Confidential - For Internal AT-PD Use Only";
  const footerSize = 7;
  const footerW = ctx.font.widthOfTextAtSize(footer, footerSize);
  const footerX = (PAGE_W - footerW) / 2;
  const footerY = ctaY - 14;
  page.drawText(footer, { x: footerX, y: footerY, size: footerSize, font: ctx.font, color: COLOR.mutedText });

  ctx.y = footerY - 8;
}

// ─── Build the full PDF ───────────────────────────────────────────────────────

async function buildPdf(report: FullReport, items: SiteReportItem[], publicUrl: string): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // #1: try to embed logo, fall back to "AT-PD" text
  let logo: EmbeddedImage | null = null;
  try {
    const logoBytes = fs.readFileSync(path.join(process.cwd(), "public", "atpd-logo.png"));
    logo = await doc.embedPng(logoBytes);
  } catch { /* no logo file */ }

  const firstPage = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { doc, pages: [firstPage], pageIdx: 0, y: PAGE_H - 52, font, bold };
  drawPageFrame(ctx);

  const project = report.site_projects;
  const page    = curPage(ctx);

  // ── Header bar ───────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: COLOR.headerBg });
  page.drawText("INTERNAL ONSITE OBSERVATION REPORT", {
    x: MARGIN_L, y: PAGE_H - 28, size: 13, font: bold, color: COLOR.headerText,
  });
  page.drawText(`Project: ${project.name}${project.client ? "  ·  Client: " + project.client : ""}`, {
    x: MARGIN_L, y: PAGE_H - 46, size: 9, font, color: rgb(0.72, 0.78, 0.88),
  });
  if (project.location) {
    page.drawText(`Location: ${project.location}`, {
      x: MARGIN_L, y: PAGE_H - 59, size: 8, font, color: rgb(0.55, 0.60, 0.70),
    });
  }
  // Logo or text fallback
  if (logo) {
    const dims = logo.scaleToFit(80, 36);
    page.drawImage(logo, {
      x: PAGE_W - MARGIN_R - dims.width,
      y: PAGE_H - HEADER_H / 2 - dims.height / 2,
      ...dims,
    });
  } else {
    page.drawText("AT-PD", {
      x: PAGE_W - MARGIN_R - bold.widthOfTextAtSize("AT-PD", 18),
      y: PAGE_H - 40, size: 18, font: bold, color: rgb(0.26, 0.62, 0.95),
    });
  }
  ctx.y = PAGE_H - HEADER_H - 14;

  // ── General Information ── #2: no label; #3: dates; #4: clean 3-col layout
  const obsStatus = report.overall_status;
  const col1 = MARGIN_L + 8;
  const col2 = MARGIN_L + CONTENT_W / 3;
  const col3 = MARGIN_L + (CONTENT_W / 3) * 2;
  const GI_H = 44;

  page.drawRectangle({ x: MARGIN_L, y: ctx.y - GI_H + 4, width: CONTENT_W, height: GI_H, color: COLOR.sectionBg });

  const labelY = ctx.y - 10;
  const valueY = ctx.y - 24;

  page.drawText("Observation Date",      { x: col1, y: labelY, size: 7,   font,       color: COLOR.mutedText });
  page.drawText(fmtDate(report.observation_date), { x: col1, y: valueY, size: 9, font: bold, color: COLOR.bodyText });

  page.drawText("Onsite Representative", { x: col2, y: labelY, size: 7,   font,       color: COLOR.mutedText });
  page.drawText(report.rep_name,         { x: col2, y: valueY, size: 9,   font: bold, color: COLOR.bodyText });

  page.drawText("Overall Status",        { x: col3, y: labelY, size: 7,   font,       color: COLOR.mutedText });
  page.drawRectangle({ x: col3 - 2, y: valueY - 3, width: 68, height: 14, color: statusBg(obsStatus) });
  page.drawText(statusLabel(obsStatus),  { x: col3 + 2, y: valueY, size: 8.5, font: bold, color: statusFg(obsStatus) });

  ctx.y -= GI_H + 8;

  // ── Schedule Observation ─────────────────────────────────────────────────
  const milestones = (report.site_report_milestones ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  if (milestones.length > 0) {
    ctx.y -= 8;
    drawSectionHeader(ctx, "Schedule Observation");

    // Shared alignment: Status at x = MARGIN_L + NAME_COL_W = 204
    const MS_COMM_W = CONTENT_W - NAME_COL_W - STATUS_W - MS_DATE_W - MS_SCHED_W - MS_COMP_W; // 108

    drawTableRow(ctx, [
      { text: "Milestone",      width: NAME_COL_W },
      { text: "Status",         width: STATUS_W   },
      { text: "Milestone Date", width: MS_DATE_W  },
      { text: "Scheduled Date", width: MS_SCHED_W },
      { text: "Completed Date", width: MS_COMP_W  },
      { text: "Comments",       width: MS_COMM_W  },
    ], true, false, true);

    let rowIdx = 0;
    for (const ms of milestones) {
      if (ms.is_spacer) {
        ensureSpace(ctx, 6);
        const p = curPage(ctx);
        p.drawRectangle({ x: MARGIN_L, y: ctx.y - 6, width: CONTENT_W, height: 6, color: COLOR.rowWhite });
        p.drawLine({
          start: { x: MARGIN_L + 6,             y: ctx.y - 3 },
          end:   { x: MARGIN_L + CONTENT_W - 6, y: ctx.y - 3 },
          thickness: 0.4, color: COLOR.border,
        });
        ctx.y -= 6;
        continue;
      }
      const isCompleted = ms.status === "completed";
      drawTableRow(ctx, [
        { text: ms.milestone_name,                                        width: NAME_COL_W, bold: true        },
        { text: ms.status, width: STATUS_W, isStatus: true, statusValue: ms.status                            },
        { text: fmtDate(ms.milestone_date),                               width: MS_DATE_W                    },
        { text: isCompleted ? "—" : fmtDate(ms.scheduled_date),           width: MS_SCHED_W                   },
        { text: fmtDate(ms.completed_date),                               width: MS_COMP_W,  bold: isCompleted },
        { text: isCompleted ? (ms.comments ?? "-") : (ms.comments ?? ""), width: MS_COMM_W,  wrap: true        },
      ], false, rowIdx % 2 === 1, true);
      rowIdx++;
    }
  }

  // ── Item sections ─────────────────────────────────────────────────────────
  // Shared alignment: item name col = NAME_COL_W (160), Status at x=204 for all
  // For recommendations: DATE_COL_W(60) + REC_NAME_W(100) = NAME_COL_W → Status still at 204
  const ITEM_COMM_W = CONTENT_W - NAME_COL_W - STATUS_W; // 318 — same for every item type

  const typeConfigs: Array<{ type: SiteReportItem["type"]; label: string; hasDates: boolean }> = [
    { type: "highlight",      label: "Highlights",                    hasDates: false },
    { type: "recommendation", label: "Recommendations to Contractors", hasDates: true  },
    { type: "risk",           label: "Risks / Opportunities",          hasDates: false },
    { type: "escalation",     label: "Escalations",                    hasDates: false },
  ];

  for (const { type, label, hasDates } of typeConfigs) {
    const section  = items.filter((i) => i.type === type);
    const showNone = section.length === 0 && (type === "risk" || type === "escalation");
    if (section.length === 0 && !showNone) continue;

    ctx.y -= 10;
    drawSectionHeader(ctx, label);

    // DATE_COL_W + itemNameW = NAME_COL_W so Status column is always at x=204
    const itemNameW = hasDates ? (NAME_COL_W - DATE_COL_W) : NAME_COL_W; // 100 or 160

    drawTableRow(ctx, [
      ...(hasDates ? [{ text: "Date Made", width: DATE_COL_W }] : []),
      { text: "Item",     width: itemNameW   },
      { text: "Status",   width: STATUS_W    },
      { text: "Comments", width: ITEM_COMM_W },
    ], true, false);

    if (showNone) {
      drawTableRow(ctx, [
        ...(hasDates ? [{ text: "—", width: DATE_COL_W }] : []),
        { text: "None during this site visit", width: itemNameW   },
        { text: "green", width: STATUS_W, isStatus: true, statusValue: "green" },
        { text: "—",     width: ITEM_COMM_W },
      ], false, false);
    } else {
      section.forEach((item, i) => {
        drawTableRow(ctx, [
          ...(hasDates ? [{ text: fmtDate(item.recommendation_date), width: DATE_COL_W }] : []),
          { text: item.item_name,   width: itemNameW                                          },
          { text: item.status, width: STATUS_W, isStatus: true, statusValue: item.status     },
          { text: item.comments ?? "", width: ITEM_COMM_W, wrap: true                         },
        ], false, i % 2 === 1);
      });

    }
  }

  drawFinalTrackerCta(ctx, publicUrl);

  finalizePageNumbers(ctx);
  return doc.save();
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { report_id } = await req.json() as { report_id: string };
    if (!report_id) return NextResponse.json({ error: "report_id required" }, { status: 400 });

    const admin = supabaseAdmin();

    const { data: report, error: fetchErr } = await admin
      .from("site_reports")
      .select(`*, site_projects(*), site_report_milestones(*), site_report_items(*)`)
      .eq("id", report_id)
      .single();

    if (fetchErr || !report) {
      return NextResponse.json({ error: fetchErr?.message ?? "Report not found" }, { status: 404 });
    }

    // Explicit items query — more reliable than the join
    const { data: explicitItems, error: itemsQueryErr } = await admin
      .from("site_report_items")
      .select("*")
      .eq("report_id", report_id);

    console.log(`[generate-pdf] report_id=${report_id}`);
    console.log(`[generate-pdf] explicit items query: count=${explicitItems?.length ?? "null"}, error=${itemsQueryErr?.message ?? "none"}`);
    console.log(`[generate-pdf] join items count=${(report.site_report_items as SiteReportItem[])?.length ?? "null"}`);

    const items: SiteReportItem[] = explicitItems ?? (report.site_report_items as SiteReportItem[]) ?? [];
    const byType = items.reduce((a, i) => { a[i.type] = (a[i.type] ?? 0) + 1; return a; }, {} as Record<string, number>);
    console.log(`[generate-pdf] items by type:`, byType);

    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const derivedBase = host ? `${proto}://${host}` : "http://localhost:3000";
    const baseUrl = process.env.APP_BASE_URL ?? process.env.SITE_URL ?? derivedBase;
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    const publicToken = report.public_share_token;
    if (!publicToken) {
      return NextResponse.json({ error: "Report is missing public_share_token" }, { status: 500 });
    }
    const publicUrl = `${normalizedBaseUrl}/site-reports/public/${publicToken}`;

    console.log(`[generate-pdf] embedded tracker url=${publicUrl}`);

    const pdfBytes = await buildPdf(report as FullReport, items, publicUrl);

    const bucketName = "site-reports";
    await admin.storage.createBucket(bucketName, {
      public: true,
      allowedMimeTypes: ["application/pdf"],
    }).catch(() => {});

    const filePath = `pdfs/${report_id}/${report.observation_date}.pdf`;
    const { error: uploadErr } = await admin.storage
      .from(bucketName)
      .upload(filePath, pdfBytes, { contentType: "application/pdf", upsert: true });

    if (uploadErr) {
      return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from(bucketName).getPublicUrl(filePath);

    await admin
      .from("site_reports")
      .update({ pdf_storage_path: filePath, updated_at: new Date().toISOString() })
      .eq("id", report_id);

    return NextResponse.json({ pdf_url: urlData.publicUrl, path: filePath });
  } catch (e: unknown) {
    const err = e as Error;
    console.error("generate-pdf error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
