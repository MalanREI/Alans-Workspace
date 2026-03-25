"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/src/components/ui";

export type AttachmentParentType = "task" | "milestone" | "note";

type AttachmentRecord = {
  id: string;
  meeting_id: string;
  parent_type: AttachmentParentType;
  parent_id: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
};

type Props = {
  meetingId: string;
  parentType: AttachmentParentType;
  parentId: string;
  onCountChange?: (count: number) => void;
};

const ACCEPT_TYPES = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".txt",
  ".csv",
].join(",");

function formatBytes(bytes: number | null): string {
  if (!bytes || Number.isNaN(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleString();
}

export default function AttachmentSection({
  meetingId,
  parentType,
  parentId,
  onCountChange,
}: Props) {
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const onCountChangeRef = useRef<Props["onCountChange"]>(onCountChange);

  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  const canUpload = useMemo(() => !uploading && !loading, [uploading, loading]);

  const loadAttachments = useCallback(async () => {
    setLoading(true);
    setErr(null);
    let timeout: number | null = null;
    try {
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 15000);
      const params = new URLSearchParams({
        meetingId,
        parentType,
        parentId,
      });
      const res = await fetch(`/api/meetings/attachments?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        attachments?: AttachmentRecord[];
      };
      console.log("[AttachmentSection] loadAttachments", {
        meetingId,
        parentType,
        parentId,
        ok: res.ok,
        status: res.status,
        data: body.attachments ?? null,
        error: body.error ?? null,
      });
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to load attachments");
      }

      const rows = body.attachments ?? [];
      setAttachments(rows);
      onCountChangeRef.current?.(rows.length);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setErr("Loading attachments timed out. Please try again.");
        return;
      }
      const message = e instanceof Error ? e.message : "Failed to load attachments";
      setErr(message);
    } finally {
      if (timeout !== null) window.clearTimeout(timeout);
      setLoading(false);
    }
  }, [meetingId, parentId, parentType]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadPercent(0);
      setErr(null);

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("meetingId", meetingId);
        form.append("parentType", parentType);
        form.append("parentId", parentId);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/meetings/attachments");

          xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
            if (!event.lengthComputable) return;
            const pct = Math.round((event.loaded / event.total) * 100);
            setUploadPercent(pct);
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadPercent(100);
              resolve();
              return;
            }

            try {
              const parsed = JSON.parse(xhr.responseText) as { error?: string };
              reject(new Error(parsed.error ?? "Upload failed"));
            } catch {
              reject(new Error("Upload failed"));
            }
          };

          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(form);
        });

        await loadAttachments();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Upload failed";
        setErr(message);
      } finally {
        setUploading(false);
      }
    },
    [loadAttachments, meetingId, parentId, parentType]
  );

  const onPickFile = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    await handleUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [handleUpload]);

  const onDelete = useCallback(
    async (attachment: AttachmentRecord) => {
      const ok = window.confirm(`Delete ${attachment.file_name}?`);
      if (!ok) return;

      setBusyDeleteId(attachment.id);
      setErr(null);
      try {
        const params = new URLSearchParams({ attachmentId: attachment.id });
        const res = await fetch(`/api/meetings/attachments?${params.toString()}`, {
          method: "DELETE",
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(body.error ?? "Failed to delete attachment");
        }

        await loadAttachments();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to delete attachment";
        setErr(message);
      } finally {
        setBusyDeleteId(null);
      }
    },
    [loadAttachments]
  );

  const onView = useCallback(async (attachment: AttachmentRecord) => {
    setErr(null);
    try {
      const params = new URLSearchParams({ attachmentId: attachment.id });
      const res = await fetch(`/api/meetings/attachments/download?${params.toString()}`, {
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error ?? "Failed to open attachment");
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to open attachment";
      setErr(message);
    }
  }, []);

  return (
    <div className="rounded-xl border p-3 md:p-4 bg-base/40">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-200">Attachments</div>
        <div className="text-xs text-slate-400">Max 10MB each</div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_TYPES}
          onChange={() => {
            void onPickFile();
          }}
          className="hidden"
          disabled={!canUpload}
        />
        <Button
          type="button"
          variant="ghost"
          disabled={!canUpload}
          onClick={() => fileInputRef.current?.click()}
          className="w-full sm:w-auto"
        >
          {uploading ? "Uploading..." : "Upload File"}
        </Button>
        <div className="text-xs text-slate-500">PDF, DOCX, XLSX, PNG, JPG, TXT, CSV</div>
      </div>

      {uploading && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-slate-400">{uploadPercent}%</div>
        </div>
      )}

      {err && <div className="mt-3 text-sm text-red-400">{err}</div>}

      <div className="mt-3 rounded-lg border border-white/10 bg-surface/50">
        {loading ? (
          <div className="p-3 text-sm text-slate-400">Loading attachments...</div>
        ) : attachments.length === 0 ? (
          <div className="p-3 text-sm text-slate-400">No attachments yet</div>
        ) : (
          <div className="divide-y divide-white/10">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-100">{attachment.file_name}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatBytes(attachment.file_size)} • {formatWhen(attachment.created_at)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => void onView(attachment)}>
                      View
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => void onDelete(attachment)}
                      disabled={busyDeleteId === attachment.id}
                    >
                      {busyDeleteId === attachment.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
