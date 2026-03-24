"use client";

import { useEffect, useState, use } from "react";

function AtpdLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-2xl font-bold text-blue-400">AT-PD</span>;
  return (
    <img
      src="/atpd-logo.png"
      alt="AT-PD"
      className="h-9 w-auto"
      onError={() => setFailed(true)}
    />
  );
}
import Link from "next/link";
import { PageShell } from "@/src/components/PageShell";
import { Button } from "@/src/components/ui";
import type { FullReport, SiteReportItem, SiteReportMilestone } from "@/src/lib/types/site-reports";

export const dynamic = "force-dynamic";

// ─── Status helpers ───────────────────────────────────────────────────────────

function statusLabel(s: string) {
  const map: Record<string, string> = {
    on_track: "On Track", risk: "Risk", behind: "Behind",
    completed: "Completed", not_started: "Not Started",
    green: "Green", yellow: "Yellow", red: "Red",
    open: "Open", closed: "Closed", in_progress: "In Progress",
  };
  return map[s?.toLowerCase()] ?? s;
}

function StatusCell({ status }: { status: string }) {
  const s = status?.toLowerCase();
  const cls =
    s === "green" || s === "on_track" || s === "completed"
      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
      : s === "yellow" || s === "risk"
        ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
        : s === "red" || s === "behind"
          ? "bg-red-500/15 text-red-400 border border-red-500/20"
          : s === "not_started"
            ? "bg-slate-500/10 text-slate-400 border border-slate-500/20"
            : "bg-blue-500/10 text-blue-400 border border-blue-500/20";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>
      {statusLabel(status)}
    </span>
  );
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Section table ────────────────────────────────────────────────────────────

function SectionTable({
  title,
  items,
  token,
  sectionType,
  showDateCol = false,
  showNoneRow = false,
}: {
  title: string;
  items: SiteReportItem[];
  token: string;
  sectionType: string;
  showDateCol?: boolean;
  showNoneRow?: boolean;
}) {
  if (items.length === 0 && !showNoneRow) return null;
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">{title}</h3>
        {items.length > 0 && (
          <a
            href={`/site-reports/public/${token}?type=${sectionType}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            See all {title.toLowerCase()} →
          </a>
        )}
      </div>
      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/[0.04] border-b border-white/[0.06]">
              {showDateCol && <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Date Made</th>}
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400">Item</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Status</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400">Comments</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                {showDateCol && <td className="px-4 py-3" />}
                <td className="px-4 py-3 font-medium text-emerald-400/80">None during this site visit</td>
                <td className="px-4 py-3">
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Green</span>
                </td>
                <td className="px-4 py-3 text-slate-500">—</td>
              </tr>
            ) : (
              items.map((item, i) => (
                <tr key={item.id} className={i % 2 === 1 ? "bg-white/[0.015]" : ""}>
                  {showDateCol && (
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs">
                      {formatDate(item.recommendation_date)}
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium text-slate-200">{item.item_name}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusCell status={item.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-sm">{item.comments || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ViewReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  useEffect(() => {
    fetch(`/api/site-reports?id=${id}`)
      .then((r) => r.json())
      .then((d: { report?: FullReport; error?: string }) => {
        if (d.error) setError(d.error);
        else setReport(d.report ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  async function generatePdf() {
    setPdfGenerating(true);
    try {
      const res = await fetch("/api/site-reports/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: id }),
      });
      const data = await res.json() as { pdf_url?: string; error?: string };
      if (data.pdf_url) window.open(data.pdf_url, "_blank");
      else alert(data.error ?? "PDF generation failed");
    } finally {
      setPdfGenerating(false);
    }
  }

  function copyShareLink() {
    if (!report) return;
    const url = `${window.location.origin}/site-reports/public/${report.public_share_token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) {
    return (
      <PageShell>
        <div className="text-center py-20 text-slate-400">Loading report…</div>
      </PageShell>
    );
  }

  if (error || !report) {
    return (
      <PageShell>
        <div className="max-w-2xl">
          <div className="text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-5">
            {error ?? "Report not found"}
          </div>
          <Link href="/site-reports"><Button variant="ghost" className="mt-4">← Back</Button></Link>
        </div>
      </PageShell>
    );
  }

  const project = report.site_projects;
  const milestones: SiteReportMilestone[] = report.site_report_milestones ?? [];
  const items: SiteReportItem[] = report.site_report_items ?? [];
  const sortedMilestones = [...milestones].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const highlights     = items.filter((i) => i.type === "highlight");
  const recommendations = items.filter((i) => i.type === "recommendation");
  const risks          = items.filter((i) => i.type === "risk");
  const escalations    = items.filter((i) => i.type === "escalation");

  const token = report.public_share_token;

  return (
    <PageShell>
      <div className="max-w-5xl space-y-6">

        {/* ── Action bar ─────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <Link href="/site-reports">
            <Button variant="ghost">← All Reports</Button>
          </Link>
          <div className="flex gap-2 flex-wrap">
            <Button variant="ghost" onClick={generatePdf} disabled={pdfGenerating}>
              {pdfGenerating ? "Generating…" : "📄 Download PDF"}
            </Button>
            <Button variant="ghost" onClick={copyShareLink}>
              {copied ? "✓ Copied!" : "🔗 Copy Share Link"}
            </Button>
            <Link href={`/site-reports/${id}/edit`}>
              <Button variant="ghost">✏️ Edit</Button>
            </Link>
          </div>
        </div>

        {/* ── Report Header ───────────────────────────────────────────────── */}
        <div className="rounded-2xl overflow-hidden border border-white/[0.06]">

          {/* Header bar */}
          <div className="bg-[#0f1726] px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">Internal Onsite Observation Report</p>
                <h1 className="text-xl font-bold text-white">{project.name}</h1>
                <div className="flex gap-3 mt-1 text-sm text-slate-400 flex-wrap">
                  {project.client && <span>Client: {project.client}</span>}
                  {project.location && <span>📍 {project.location}</span>}
                </div>
              </div>
              <div className="flex items-center shrink-0">
                <AtpdLogo />
              </div>
            </div>
          </div>

          {/* General Information */}
          <div className="bg-white/[0.02] border-t border-white/[0.06] px-6 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Observation Date</p>
                <p className="font-semibold text-slate-100">{formatDate(report.observation_date)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Onsite Representative</p>
                <p className="font-semibold text-slate-100">{report.rep_name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Overall Status</p>
                <StatusCell status={report.overall_status} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Schedule Observation ─────────────────────────────────────────── */}
        {sortedMilestones.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300 mb-3">
              Schedule Observation
            </h3>
            <div className="rounded-xl border border-white/[0.06] overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="bg-white/[0.04] border-b border-white/[0.06]">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400">Milestone</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Milestone Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Scheduled Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Completed Date</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedMilestones.map((ms, i) => {
                    if (ms.is_spacer) {
                      return (
                        <tr key={ms.id}>
                          <td colSpan={6} className="px-0 py-1">
                            <div className="h-px bg-white/[0.06] mx-4" />
                          </td>
                        </tr>
                      );
                    }
                    const isCompleted = ms.status === "completed";
                    return (
                      <tr key={ms.id} className={i % 2 === 1 ? "bg-white/[0.015]" : ""}>
                        <td className="px-4 py-3 font-medium text-slate-200">{ms.milestone_name}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusCell status={ms.status} />
                        </td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(ms.milestone_date)}</td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                          {isCompleted ? "—" : formatDate(ms.scheduled_date)}
                        </td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(ms.completed_date)}</td>
                        <td className="px-4 py-3 text-slate-400">{isCompleted ? (ms.comments || "-") : (ms.comments || "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Item Sections ────────────────────────────────────────────────── */}
        <SectionTable title="Highlights" items={highlights} token={token} sectionType="highlight" />
        <SectionTable title="Recommendations to Contractors" items={recommendations} token={token} sectionType="recommendation" showDateCol />
        <SectionTable title="Risks / Opportunities" items={risks} token={token} sectionType="risk" showNoneRow />
        <SectionTable title="Escalations" items={escalations} token={token} sectionType="escalation" showNoneRow />

        {items.length === 0 && milestones.length === 0 && (
          <div className="text-center text-slate-500 py-8">
            This report has no observations recorded.
          </div>
        )}

        {/* ── Footer note ──────────────────────────────────────────────────── */}
        <div className="text-center text-xs text-slate-600 pb-4">
          Public share link:{" "}
          <a
            href={`/site-reports/public/${token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-500 hover:text-emerald-400 underline"
          >
            {typeof window !== "undefined" ? window.location.origin : ""}/site-reports/public/{token}
          </a>
        </div>

      </div>
    </PageShell>
  );
}
