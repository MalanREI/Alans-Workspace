"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/src/components/PageShell";
import { Button } from "@/src/components/ui";
import type { SiteReport, SiteProject } from "@/src/lib/types/site-reports";

export const dynamic = "force-dynamic";

type ReportWithProject = SiteReport & { site_projects: SiteProject };

// ─── Status helpers ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    on_track: { label: "On Track", classes: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
    risk:     { label: "Risk",     classes: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
    behind:   { label: "Behind",   classes: "bg-red-500/15 text-red-400 border-red-500/20" },
  };
  const s = map[status] ?? { label: status, classes: "bg-slate-500/15 text-slate-400 border-slate-500/20" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.classes}`}>
      {s.label}
    </span>
  );
}

function formatDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SiteReportsObservationsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<ReportWithProject[]>([]);
  const [projects, setProjects] = useState<SiteProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterProject, setFilterProject] = useState<string>("all");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRes, pRes] = await Promise.all([
        fetch("/api/site-reports"),
        fetch("/api/site-reports/projects"),
      ]);
      const rData = await rRes.json() as { reports?: ReportWithProject[]; error?: string };
      const pData = await pRes.json() as { projects?: SiteProject[]; error?: string };
      if (rData.error) throw new Error(rData.error);
      if (pData.error) throw new Error(pData.error);
      setReports(rData.reports ?? []);
      setProjects(pData.projects ?? []);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() =>
    filterProject === "all"
      ? reports
      : reports.filter((r) => r.project_id === filterProject),
    [reports, filterProject]
  );

  async function handleDelete(id: string) {
    if (!confirm("Delete this report and all its data? This cannot be undone.")) return;
    setDeleting(id);
    try {
      await fetch(`/api/site-reports?id=${id}`, { method: "DELETE" });
      setReports((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  async function handleGeneratePdf(reportId: string) {
    setPdfGenerating(reportId);
    try {
      const res = await fetch("/api/site-reports/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });
      const data = await res.json() as { pdf_url?: string; error?: string };
      if (data.pdf_url) {
        window.open(data.pdf_url, "_blank");
        // Refresh to show updated pdf_storage_path
        void load();
      } else {
        alert(data.error ?? "PDF generation failed");
      }
    } finally {
      setPdfGenerating(null);
    }
  }

  function handleCopyLink(token: string, reportId: string) {
    const url = `${window.location.origin}/site-reports/public/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(reportId);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <PageShell>
      <div className="max-w-6xl space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Observation Reports</h1>
            <p className="text-slate-400 text-sm mt-0.5">AT-PD construction site observation reports</p>
          </div>
          <div className="flex gap-2">
            <Link href="/site-reports/projects">
              <Button variant="ghost">Manage Projects</Button>
            </Link>
            <Link href="/site-reports/new">
              <Button>+ New Report</Button>
            </Link>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Filters */}
        {projects.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">Filter:</span>
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="rounded-lg border border-white/10 bg-surface px-3 py-1.5 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <span className="text-xs text-slate-500">{filtered.length} report{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-16 text-slate-400">Loading reports…</div>
        )}

        {/* Empty state */}
        {!loading && filtered.length === 0 && (
          <div className="rounded-2xl border border-white/[0.06] bg-surface p-12 text-center">
            <div className="text-4xl mb-4">📋</div>
            <h3 className="text-lg font-medium text-slate-200 mb-2">No reports yet</h3>
            <p className="text-slate-400 text-sm mb-6">
              {projects.length === 0
                ? "Start by creating a project, then submit your first site observation report."
                : "Create your first observation report for a site visit."}
            </p>
            <div className="flex justify-center gap-3">
              {projects.length === 0 && (
                <Link href="/site-reports/projects">
                  <Button variant="ghost">Create Project</Button>
                </Link>
              )}
              <Link href="/site-reports/new">
                <Button>+ New Report</Button>
              </Link>
            </div>
          </div>
        )}

        {/* Report cards */}
        {!loading && filtered.length > 0 && (
          <div className="grid gap-3">
            {filtered.map((report) => (
              <div
                key={report.id}
                className="rounded-2xl border border-white/[0.06] bg-surface p-5 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-slate-100">
                        {report.site_projects?.name ?? "Unknown Project"}
                      </h3>
                      <StatusBadge status={report.overall_status} />
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-400 flex-wrap">
                      <span>📅 {formatDate(report.observation_date)}</span>
                      <span>·</span>
                      <span>👤 {report.rep_name}</span>
                      {report.site_projects?.client && (
                        <>
                          <span>·</span>
                          <span>🏢 {report.site_projects.client}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <Button
                      variant="ghost"
                      className="text-xs px-2.5 py-1.5"
                      onClick={() => router.push(`/site-reports/${report.id}`)}
                    >
                      View
                    </Button>

                    <Button
                      variant="ghost"
                      className="text-xs px-2.5 py-1.5"
                      onClick={() => handleGeneratePdf(report.id)}
                      disabled={pdfGenerating === report.id}
                    >
                      {pdfGenerating === report.id ? "Generating…" : "PDF"}
                    </Button>

                    {report.pdf_storage_path && (
                      <a
                        href={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/site-reports/${report.pdf_storage_path}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="ghost" className="text-xs px-2.5 py-1.5">
                          ↓ Download
                        </Button>
                      </a>
                    )}

                    <Button
                      variant="ghost"
                      className={`text-xs px-2.5 py-1.5 ${copied === report.id ? "text-emerald-400" : ""}`}
                      onClick={() => handleCopyLink(report.public_share_token, report.id)}
                    >
                      {copied === report.id ? "Copied!" : "🔗 Share"}
                    </Button>

                    <Button
                      variant="ghost"
                      className="text-xs px-2.5 py-1.5"
                      onClick={() => router.push(`/site-reports/${report.id}/edit`)}
                    >
                      Edit
                    </Button>

                    <Button
                      variant="ghost"
                      className="text-xs px-2.5 py-1.5 text-red-400 hover:text-red-300"
                      onClick={() => handleDelete(report.id)}
                      disabled={deleting === report.id}
                    >
                      {deleting === report.id ? "…" : "Delete"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </PageShell>
  );
}
