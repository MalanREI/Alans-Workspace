import { NextResponse } from "next/server";
import { supabaseServer } from "@/src/lib/supabase/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

// GET /api/site-reports?project_id=xxx  — list reports
// GET /api/site-reports?id=xxx          — single report with relations
// GET /api/site-reports?latest_for_project=xxx — most recent report's milestones (for persistent completion)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");
    const id = searchParams.get("id");
    const latestForProject = searchParams.get("latest_for_project");

    const sb = await supabaseServer();

    if (latestForProject) {
      // Return milestones from the most recent report for this project
      const { data: reports, error: rErr } = await sb
        .from("site_reports")
        .select("id, observation_date")
        .eq("project_id", latestForProject)
        .order("observation_date", { ascending: false })
        .limit(1);

      if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
      if (!reports || reports.length === 0) return NextResponse.json({ milestones: [] });

      const { data: milestones, error: mErr } = await sb
        .from("site_report_milestones")
        .select("*")
        .eq("report_id", reports[0].id)
        .order("sort_order");

      if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
      return NextResponse.json({ milestones: milestones ?? [] });
    }

    if (id) {
      // Single report with all relations
      const { data, error } = await sb
        .from("site_reports")
        .select(`
          *,
          site_projects(*),
          site_report_milestones(*),
          site_report_items(*)
        `)
        .eq("id", id)
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ report: data });
    }

    let query = sb
      .from("site_reports")
      .select("*, site_projects(id, name, client, location)")
      .order("observation_date", { ascending: false });

    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ reports: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/site-reports — create report with all related data
export async function POST(req: Request) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      project_id: string;
      observation_date: string;
      rep_name: string;
      overall_status: string;
      milestones: Array<{
        milestone_id: string | null;
        is_spacer: boolean;
        milestone_name: string;
        milestone_date: string | null;
        scheduled_date: string | null;
        status: string;
        completed_date: string | null;
        comments: string | null;
        sort_order: number;
      }>;
      items: Array<{
        type: string;
        item_name: string;
        status: string;
        comments: string;
        recommendation_date: string | null;
      }>;
    };

    const admin = supabaseAdmin();

    // 1. Create the report
    const { data: report, error: reportErr } = await admin
      .from("site_reports")
      .insert({
        project_id: body.project_id,
        observation_date: body.observation_date,
        rep_name: body.rep_name,
        overall_status: body.overall_status,
        created_by: user.id,
      })
      .select()
      .single();

    if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });

    // 2. Insert milestones
    if (body.milestones.length > 0) {
      const { error: msErr } = await admin.from("site_report_milestones").insert(
        body.milestones.map((m) => ({ ...m, report_id: report.id }))
      );
      if (msErr) console.error("milestone insert error:", msErr);
    }

    // 3. Insert items — filter blank names; normalize empty date strings to null
    const validItems = (body.items ?? []).filter((i) => i.item_name?.trim());
    console.log(`[site-reports POST] report_id=${report.id} items total=${body.items?.length ?? 0} valid=${validItems.length}`);
    if (validItems.length > 0) {
      const rows = validItems.map((item) => ({
        type: item.type,
        item_name: item.item_name,
        status: item.status,
        comments: item.comments ?? "",
        recommendation_date: item.recommendation_date || null, // "" → null (Postgres date can't accept empty string)
        report_id: report.id,
        project_id: body.project_id,
      }));
      console.log(`[site-reports POST] inserting rows:`, JSON.stringify(rows));
      const { data: insertedItems, error: itemsErr } = await admin
        .from("site_report_items")
        .insert(rows)
        .select();
      if (itemsErr) {
        console.error(`[site-reports POST] items insert FAILED report=${report.id}:`, JSON.stringify(itemsErr));
        return NextResponse.json({ report, warning: `Items not saved: ${itemsErr.message}` });
      }
      console.log(`[site-reports POST] items inserted OK report=${report.id} count=${insertedItems?.length}`);
    }

    return NextResponse.json({ report });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/site-reports — update report (replaces milestones and items)
export async function PUT(req: Request) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      id: string;
      project_id: string;
      observation_date?: string;
      rep_name?: string;
      overall_status?: string;
      milestones?: Array<{
        milestone_id: string | null;
        is_spacer: boolean;
        milestone_name: string;
        milestone_date: string | null;
        scheduled_date: string | null;
        status: string;
        completed_date: string | null;
        comments: string | null;
        sort_order: number;
      }>;
      items?: Array<{
        type: string;
        item_name: string;
        status: string;
        comments: string;
        recommendation_date: string | null;
      }>;
    };

    const { id, milestones, items, ...reportUpdates } = body;
    const admin = supabaseAdmin();

    // 1. Update report header
    const { data: report, error: reportErr } = await admin
      .from("site_reports")
      .update({ ...reportUpdates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (reportErr) return NextResponse.json({ error: reportErr.message }, { status: 500 });

    // 2. Replace milestones
    if (milestones !== undefined) {
      await admin.from("site_report_milestones").delete().eq("report_id", id);
      if (milestones.length > 0) {
        await admin.from("site_report_milestones").insert(
          milestones.map((m) => ({ ...m, report_id: id }))
        );
      }
    }

    // 3. Replace items — filter blank names; normalize empty date strings to null
    if (items !== undefined) {
      await admin.from("site_report_items").delete().eq("report_id", id);
      const validItems = items.filter((i) => i.item_name?.trim());
      console.log(`[site-reports PUT] report_id=${id} items total=${items.length} valid=${validItems.length}`);
      if (validItems.length > 0) {
        const rows = validItems.map((item) => ({
          type: item.type,
          item_name: item.item_name,
          status: item.status,
          comments: item.comments ?? "",
          recommendation_date: item.recommendation_date || null, // "" → null
          report_id: id,
          project_id: body.project_id,
        }));
        const { data: insertedItems, error: itemsErr } = await admin
          .from("site_report_items")
          .insert(rows)
          .select();
        if (itemsErr) console.error(`[site-reports PUT] items insert FAILED report=${id}:`, JSON.stringify(itemsErr));
        else console.log(`[site-reports PUT] items inserted OK report=${id} count=${insertedItems?.length}`);
      }
    }

    return NextResponse.json({ report });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/site-reports?id=xxx
export async function DELETE(req: Request) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const admin = supabaseAdmin();
    const { error } = await admin.from("site_reports").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
