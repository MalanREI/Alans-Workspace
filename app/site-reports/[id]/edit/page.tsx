"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { PageShell } from "@/src/components/PageShell";
import { Button } from "@/src/components/ui";
import { ReportForm } from "@/app/site-reports/_components/ReportForm";
import type { FullReport, MilestoneFormEntry, ItemFormEntry } from "@/src/lib/types/site-reports";

export const dynamic = "force-dynamic";

function makeLocalId() {
  return Math.random().toString(36).slice(2);
}

export default function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [report, setReport] = useState<FullReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Map DB rows back to form entries
  const milestones: MilestoneFormEntry[] = (report.site_report_milestones ?? [])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((ms) => ({
      localId: makeLocalId(),
      milestone_id: ms.milestone_id,
      is_spacer: ms.is_spacer,
      milestone_name: ms.milestone_name,
      milestone_date: ms.milestone_date ?? "",
      scheduled_date: ms.scheduled_date ?? "",
      status: ms.status,
      completed_date: ms.completed_date ?? "",
      comments: ms.comments ?? "",
      sort_order: ms.sort_order,
    }));

  function mapItems(type: string): ItemFormEntry[] {
    return (report!.site_report_items ?? [])
      .filter((i) => i.type === type)
      .map((i) => ({
        localId: makeLocalId(),
        item_name: i.item_name,
        status: i.status,
        comments: i.comments,
        recommendation_date: i.recommendation_date ?? "",
        originalComments: i.comments,
        aiPolished: false,
        polishing: false,
      }));
  }

  const initialData = {
    id: report.id,
    project_id: report.project_id,
    observation_date: report.observation_date,
    rep_name: report.rep_name,
    overall_status: report.overall_status,
    milestones,
    highlights: mapItems("highlight"),
    recommendations: mapItems("recommendation"),
    risks: mapItems("risk"),
    escalations: mapItems("escalation"),
  };

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Edit Report</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {report.site_projects?.name} — {report.observation_date}
            </p>
          </div>
          <Link href={`/site-reports/${id}`}>
            <Button variant="ghost">← Cancel</Button>
          </Link>
        </div>
        <ReportForm initialData={initialData} />
      </div>
    </PageShell>
  );
}
