import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/src/lib/supabase/admin";

/**
 * Max upload size (bytes) — only enforced on the legacy FormData path.
 * Default: 25MB
 */
const MAX_UPLOAD_BYTES = Number(process.env.MAX_RECORDING_UPLOAD_BYTES || 25_000_000);

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // --- JSON path: browser uploaded file directly to Supabase Storage ---
    // No file touches this route — just persist the metadata row.
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const { meetingId, sessionId, storagePath, durationSeconds, userId } = body as {
        meetingId?: string;
        sessionId?: string;
        storagePath?: string;
        durationSeconds?: number;
        userId?: string;
      };

      if (!meetingId || !sessionId || !storagePath) {
        return NextResponse.json(
          { error: "Missing meetingId, sessionId, or storagePath" },
          { status: 400 }
        );
      }

      const admin = supabaseAdmin();
      const { error: dbError } = await admin.from("meeting_recordings").insert({
        session_id: sessionId,
        storage_path: storagePath,
        duration_seconds: durationSeconds ?? null,
        created_by: userId || null,
      });

      if (dbError) {
        console.error("Failed to save recording record (JSON path)", dbError);
        return NextResponse.json({ error: "Failed to save recording record" }, { status: 500 });
      }

      return NextResponse.json({ success: true, recordingPath: storagePath });
    }

    // --- Legacy FormData path: kept for local dev / fallback ---
    const formData = await req.formData();

    const meetingId = (formData.get("meetingId") as string | null) ?? null;
    const sessionId = (formData.get("sessionId") as string | null) ?? null;
    const durationSeconds = (formData.get("durationSeconds") as string | null) ?? null;
    const createdBy =
      (formData.get("userId") as string | null) ??
      (formData.get("createdBy") as string | null) ??
      null;
    const file = (formData.get("file") as File | null) ?? null;

    if (!meetingId || !sessionId || !file) {
      return NextResponse.json({ error: "Missing meetingId, sessionId, or file" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `Recording too large (${file.size} bytes). Max allowed is ${MAX_UPLOAD_BYTES} bytes.`,
        },
        { status: 413 }
      );
    }

    const admin = supabaseAdmin();
    const recordingsBucket = process.env.RECORDINGS_BUCKET || "meeting-recordings";
    const storagePath = `${meetingId}/${sessionId}/recording_${Date.now()}.webm`;

    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(recordingsBucket)
      .upload(storagePath, buffer, { contentType: "audio/webm", upsert: false });

    if (uploadError) {
      console.error("Failed to upload recording to storage (FormData path)", uploadError);
      return NextResponse.json({ error: "Failed to upload recording" }, { status: 500 });
    }

    const { error: dbError } = await admin.from("meeting_recordings").insert({
      session_id: sessionId,
      storage_path: storagePath,
      duration_seconds: durationSeconds ? Number(durationSeconds) : null,
      created_by: createdBy,
    });

    if (dbError) {
      console.error("Failed to save recording record (FormData path)", dbError);
      return NextResponse.json({ error: "Failed to save recording record" }, { status: 500 });
    }

    return NextResponse.json({ success: true, recordingPath: storagePath });
  } catch (err: unknown) {
    console.error("Upload recording error:", err);
    return NextResponse.json(
      { error: (err as Error)?.message || "Failed to upload recording" },
      { status: 500 }
    );
  }
}
