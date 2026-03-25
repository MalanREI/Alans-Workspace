import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";
import { supabaseServer } from "@/src/lib/supabase/server";

const ATTACHMENTS_BUCKET = "meeting-attachments";
const SIGNED_URL_SECONDS = 60 * 60;

async function requireUserId(): Promise<string | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const attachmentId = req.nextUrl.searchParams.get("attachmentId");
    if (!attachmentId) {
      return NextResponse.json({ error: "attachmentId is required" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const row = await admin
      .from("meeting_attachments")
      .select("id,storage_path")
      .eq("id", attachmentId)
      .single();

    if (row.error || !row.data) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    const signed = await admin
      .storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(row.data.storage_path, SIGNED_URL_SECONDS);

    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json({ error: `Failed to sign URL: ${signed.error?.message ?? "Unknown error"}` }, { status: 500 });
    }

    return NextResponse.json({ url: signed.data.signedUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create download URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
