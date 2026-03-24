import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

// Public (no auth) endpoint — fetches all items for the project identified by token.
// The middleware excludes /api/ routes so no auth middleware applies here.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

    const admin = supabaseAdmin();

    // 1. Find the report (and project) by token
    const { data: report, error: rErr } = await admin
      .from("site_reports")
      .select("id, project_id, public_share_token, site_projects(id, name, client, location)")
      .eq("public_share_token", token)
      .single();

    if (rErr || !report) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
    }

    const projectId = report.project_id;

    // 2. All items for this project (across all reports)
    const { data: items, error: iErr } = await admin
      .from("site_report_items")
      .select("*, site_reports(id, observation_date, rep_name, overall_status)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    console.log(`[public-api/${token}] project_id=${projectId} items=${items?.length ?? "null"} err=${iErr?.message ?? "none"}`);

    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

    // If no items found via project_id, fall back to joining through report ids
    // (handles items saved before project_id column was populated)
    let resolvedItems = items ?? [];
    if (resolvedItems.length === 0) {
      const { data: reportIds } = await admin
        .from("site_reports")
        .select("id")
        .eq("project_id", projectId);
      if (reportIds && reportIds.length > 0) {
        const ids = reportIds.map((r) => r.id);
        const { data: fallbackItems, error: fbErr } = await admin
          .from("site_report_items")
          .select("*, site_reports(id, observation_date, rep_name, overall_status)")
          .in("report_id", ids)
          .order("created_at", { ascending: false });
        console.log(`[public-api/${token}] fallback by report_id: items=${fallbackItems?.length ?? "null"} err=${fbErr?.message ?? "none"}`);
        resolvedItems = fallbackItems ?? [];
      }
    }

    // 3. All reports for this project (for context)
    const { data: reports } = await admin
      .from("site_reports")
      .select("id, observation_date, rep_name, overall_status")
      .eq("project_id", projectId)
      .order("observation_date", { ascending: false });

    return NextResponse.json({
      project: report.site_projects,
      items: resolvedItems,
      reports: reports ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
