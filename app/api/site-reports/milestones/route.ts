import { NextResponse } from "next/server";
import { supabaseServer } from "@/src/lib/supabase/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("project_id");

    const sb = await supabaseServer();
    let query = sb.from("site_milestones").select("*").order("sort_order");
    if (projectId) query = query.eq("project_id", projectId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ milestones: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      project_id: string;
      name?: string;
      milestone_date?: string | null;
      scheduled_date?: string | null;
      is_spacer?: boolean;
      sort_order?: number;
    };

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("site_milestones")
      .insert(body)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ milestone: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json() as {
      id: string;
      name?: string;
      milestone_date?: string | null;
      scheduled_date?: string | null;
      is_spacer?: boolean;
      sort_order?: number;
    };
    const { id, ...updates } = body;

    const admin = supabaseAdmin();
    const { data, error } = await admin
      .from("site_milestones")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ milestone: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const admin = supabaseAdmin();
    const { error } = await admin.from("site_milestones").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
