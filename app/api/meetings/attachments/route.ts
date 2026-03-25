import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";
import { supabaseServer } from "@/src/lib/supabase/server";

type ParentType = "task" | "milestone" | "note";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENTS_BUCKET = "meeting-attachments";

function isParentType(value: string | null): value is ParentType {
  return value === "task" || value === "milestone" || value === "note";
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);
}

async function requireUserId(): Promise<string | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

async function ensureAttachmentsBucket() {
  const admin = supabaseAdmin();
  await admin.storage
    .createBucket(ATTACHMENTS_BUCKET, {
      public: false,
      fileSizeLimit: `${MAX_ATTACHMENT_BYTES}`,
      allowedMimeTypes: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "image/png",
        "image/jpeg",
        "text/plain",
        "text/csv",
      ],
    })
    .catch(() => {});
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await req.formData();
    const file = (form.get("file") as File | null) ?? null;
    const meetingId = (form.get("meetingId") as string | null) ?? null;
    const parentTypeRaw = (form.get("parentType") as string | null) ?? null;
    const parentId = (form.get("parentId") as string | null) ?? null;

    if (!file || !meetingId || !parentTypeRaw || !parentId) {
      return NextResponse.json(
        { error: "Missing file, meetingId, parentType, or parentId" },
        { status: 400 }
      );
    }

    if (!isParentType(parentTypeRaw)) {
      return NextResponse.json({ error: "Invalid parentType" }, { status: 400 });
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        {
          error: `File too large (${file.size} bytes). Max allowed is ${MAX_ATTACHMENT_BYTES} bytes.`,
        },
        { status: 413 }
      );
    }

    await ensureAttachmentsBucket();

    const admin = supabaseAdmin();
    const cleanName = sanitizeFileName(file.name || "attachment");
    const stamp = Date.now();
    const storagePath = `${meetingId}/${parentTypeRaw}/${parentId}/${stamp}_${cleanName}`;
    const payload = Buffer.from(await file.arrayBuffer());

    const upload = await admin.storage.from(ATTACHMENTS_BUCKET).upload(storagePath, payload, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (upload.error) {
      return NextResponse.json({ error: `Upload failed: ${upload.error.message}` }, { status: 500 });
    }

    const ins = await admin
      .from("meeting_attachments")
      .insert({
        meeting_id: meetingId,
        parent_type: parentTypeRaw,
        parent_id: parentId,
        file_name: file.name,
        file_size: file.size,
        file_type: file.type || null,
        storage_path: storagePath,
        uploaded_by: userId,
      })
      .select("id,meeting_id,parent_type,parent_id,file_name,file_size,file_type,storage_path,uploaded_by,created_at")
      .single();

    if (ins.error) {
      await admin.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: `Database insert failed: ${ins.error.message}` }, { status: 500 });
    }

    return NextResponse.json({ attachment: ins.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to upload attachment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meetingId = req.nextUrl.searchParams.get("meetingId");
    const parentTypeRaw = req.nextUrl.searchParams.get("parentType");
    const parentId = req.nextUrl.searchParams.get("parentId");

    if (!meetingId || !parentTypeRaw || !parentId) {
      return NextResponse.json(
        { error: "meetingId, parentType, and parentId are required" },
        { status: 400 }
      );
    }

    if (!isParentType(parentTypeRaw)) {
      return NextResponse.json({ error: "Invalid parentType" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const q = await admin
      .from("meeting_attachments")
      .select("id,meeting_id,parent_type,parent_id,file_name,file_size,file_type,storage_path,uploaded_by,created_at")
      .eq("meeting_id", meetingId)
      .eq("parent_type", parentTypeRaw)
      .eq("parent_id", parentId)
      .order("created_at", { ascending: false });

    console.log("[attachments.GET] supabase response", {
      meetingId,
      parentType: parentTypeRaw,
      parentId,
      data: q.data,
      error: q.error,
    });

    if (q.error) {
      return NextResponse.json({ error: `Failed to list attachments: ${q.error.message}` }, { status: 500 });
    }

    return NextResponse.json({ attachments: q.data ?? [] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list attachments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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

    const storagePath = row.data.storage_path;
    const rm = await admin.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
    if (rm.error) {
      return NextResponse.json({ error: `Failed to remove file: ${rm.error.message}` }, { status: 500 });
    }

    const del = await admin.from("meeting_attachments").delete().eq("id", attachmentId);
    if (del.error) {
      return NextResponse.json({ error: `Failed to delete attachment row: ${del.error.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete attachment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
