"use client";

import Link from "next/link";
import { PageShell } from "@/src/components/PageShell";
import { Button } from "@/src/components/ui";
import { ReportForm } from "@/app/site-reports/_components/ReportForm";

export const dynamic = "force-dynamic";

export default function NewReportPage() {
  return (
    <PageShell>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">New Observation Report</h1>
            <p className="text-slate-400 text-sm mt-0.5">AT-PD Internal Site Report</p>
          </div>
          <Link href="/site-reports">
            <Button variant="ghost">← Back</Button>
          </Link>
        </div>
        <ReportForm />
      </div>
    </PageShell>
  );
}
