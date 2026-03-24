"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/src/components/ui";
import type {
  SiteProject,
  SiteMilestone,
  SiteReportMilestone,
  MilestoneFormEntry,
  ItemFormEntry,
} from "@/src/lib/types/site-reports";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function makeLocalId() {
  return Math.random().toString(36).slice(2);
}

function makeItem(date = ""): ItemFormEntry {
  return {
    localId: makeLocalId(),
    item_name: "",
    status: "green",
    comments: "",
    recommendation_date: date,
    originalComments: "",
    aiPolished: false,
    polishing: false,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="h-px flex-1 bg-white/[0.06]" />
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider px-2">
        {title}
        {count !== undefined && (
          <span className="ml-1.5 text-slate-500 normal-case tracking-normal">({count})</span>
        )}
      </h2>
      <div className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

// Overall status buttons
function StatusTriple({
  value,
  onChange,
}: {
  value: "on_track" | "risk" | "behind";
  onChange: (v: "on_track" | "risk" | "behind") => void;
}) {
  const opts = [
    { v: "on_track" as const, label: "On Track", active: "bg-emerald-600 text-white", inactive: "bg-white/[0.04] text-slate-400 border-white/10" },
    { v: "risk"     as const, label: "Risk",     active: "bg-amber-500 text-white",   inactive: "bg-white/[0.04] text-slate-400 border-white/10" },
    { v: "behind"   as const, label: "Behind",   active: "bg-red-600 text-white",     inactive: "bg-white/[0.04] text-slate-400 border-white/10" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-xl py-3.5 text-base font-semibold border transition-all ${value === o.v ? o.active + " border-transparent scale-[1.02]" : o.inactive}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Item status (green/yellow/red) selector
function ItemStatus({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const opts = [
    { v: "green",  label: "Green",  active: "bg-emerald-600 text-white border-transparent", inactive: "border-white/10 text-slate-400" },
    { v: "yellow", label: "Yellow", active: "bg-amber-500 text-white border-transparent",   inactive: "border-white/10 text-slate-400" },
    { v: "red",    label: "Red",    active: "bg-red-600 text-white border-transparent",     inactive: "border-white/10 text-slate-400" },
  ];
  return (
    <div className="flex gap-2">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${value === o.v ? o.active : "bg-white/[0.03] " + o.inactive}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Milestone status 4-button selector
function MilestoneStatusButtons({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const opts = [
    { v: "on_track",   label: "Green",     active: "bg-emerald-600 text-white border-transparent", inactive: "border-white/10 text-slate-400" },
    { v: "risk",       label: "Yellow",    active: "bg-amber-500 text-white border-transparent",   inactive: "border-white/10 text-slate-400" },
    { v: "behind",     label: "Red",       active: "bg-red-600 text-white border-transparent",     inactive: "border-white/10 text-slate-400" },
    { v: "completed",  label: "Completed", active: "bg-blue-600 text-white border-transparent",    inactive: "border-white/10 text-slate-400" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`py-2.5 rounded-lg text-sm font-medium border transition-all ${value === o.v ? o.active : "bg-white/[0.03] " + o.inactive}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// AI-polish textarea component
function PolishableTextarea({
  value,
  onChange,
  context,
  placeholder,
  onPolished,
}: {
  value: string;
  onChange: (v: string) => void;
  context: string;
  placeholder?: string;
  onPolished: (original: string, polished: string) => void;
}) {
  const [polishing, setPolishing] = useState(false);
  const [polished, setPolished] = useState(false);
  const [original, setOriginal] = useState("");
  const lastValueRef = useRef(value);

  useEffect(() => {
    lastValueRef.current = value;
  }, [value]);

  async function handleBlur() {
    const text = lastValueRef.current.trim();
    if (text.length < 15 || polishing) return;
    setPolishing(true);
    try {
      const res = await fetch("/api/site-reports/ai-polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context }),
      });
      const data = await res.json() as { polished?: string; error?: string };
      if (data.polished && data.polished !== text) {
        setOriginal(text);
        setPolished(true);
        onChange(data.polished);
        onPolished(text, data.polished);
      }
    } finally {
      setPolishing(false);
    }
  }

  function handleUndo() {
    onChange(original);
    setPolished(false);
    setOriginal("");
  }

  return (
    <div className="relative">
      <textarea
        value={value}
        onChange={(e) => { onChange(e.target.value); setPolished(false); }}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-lg border border-white/10 bg-base px-4 py-3 text-base text-slate-200 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
      />
      {(polishing || polished) && (
        <div className="flex items-center gap-2 mt-1">
          {polishing && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <span className="animate-spin inline-block">⟳</span> AI polishing…
            </span>
          )}
          {polished && !polishing && (
            <>
              <span className="text-xs text-emerald-400">✓ AI polished</span>
              <button
                type="button"
                onClick={handleUndo}
                className="text-xs text-slate-500 hover:text-slate-300 underline"
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Single item card (highlight / recommendation / risk / escalation)
function ItemCard({
  item,
  index,
  context,
  showDateField,
  observationDate,
  onChange,
  onRemove,
}: {
  item: ItemFormEntry;
  index: number;
  context: string;
  showDateField: boolean;
  observationDate: string;
  onChange: (updated: Partial<ItemFormEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          {context} #{index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-500 hover:text-red-400 transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </div>

      {showDateField && (
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">Date Made</label>
          <input
            type="date"
            value={item.recommendation_date || observationDate}
            onChange={(e) => onChange({ recommendation_date: e.target.value })}
            className="w-full rounded-lg border border-white/10 bg-base px-4 py-2.5 text-base text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
      )}

      <div>
        <label className="block text-sm text-slate-400 mb-1.5">Item Name</label>
        <input
          type="text"
          value={item.item_name}
          onChange={(e) => onChange({ item_name: e.target.value })}
          placeholder={`Describe the ${context} item…`}
          className="w-full rounded-lg border border-white/10 bg-base px-4 py-2.5 text-base text-slate-200 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
      </div>

      <div>
        <label className="block text-sm text-slate-400 mb-1.5">Status</label>
        <ItemStatus value={item.status} onChange={(v) => onChange({ status: v })} />
      </div>

      <div>
        <label className="block text-sm text-slate-400 mb-1.5">
          Comments
          <span className="ml-1.5 text-slate-600 normal-case font-normal">(AI will auto-polish on focus out)</span>
        </label>
        <PolishableTextarea
          value={item.comments}
          onChange={(v) => onChange({ comments: v, aiPolished: false })}
          context={context}
          placeholder="Add your field notes here…"
          onPolished={(_orig, _polished) => onChange({ aiPolished: true })}
        />
      </div>
    </div>
  );
}

// ─── Main form component (shared between /new and /edit) ──────────────────────

type ReportFormProps = {
  initialData?: {
    id: string;
    project_id: string;
    observation_date: string;
    rep_name: string;
    overall_status: "on_track" | "risk" | "behind";
    milestones: MilestoneFormEntry[];
    highlights: ItemFormEntry[];
    recommendations: ItemFormEntry[];
    risks: ItemFormEntry[];
    escalations: ItemFormEntry[];
  };
};

export function ReportForm({ initialData }: ReportFormProps) {
  const router = useRouter();
  const isEdit = !!initialData;

  // Project & basic info
  const [projects, setProjects] = useState<SiteProject[]>([]);
  const [projectId, setProjectId] = useState(initialData?.project_id ?? "");
  const [date, setDate] = useState(initialData?.observation_date ?? todayStr());
  const [repName, setRepName] = useState(initialData?.rep_name ?? "");
  const [overallStatus, setOverallStatus] = useState<"on_track" | "risk" | "behind">(
    initialData?.overall_status ?? "on_track"
  );

  // Milestones
  const [milestones, setMilestones] = useState<MilestoneFormEntry[]>(initialData?.milestones ?? []);

  // Item sections
  const [highlights, setHighlights] = useState<ItemFormEntry[]>(initialData?.highlights ?? []);
  const [recommendations, setRecommendations] = useState<ItemFormEntry[]>(initialData?.recommendations ?? []);
  const [risks, setRisks] = useState<ItemFormEntry[]>(initialData?.risks ?? []);
  const [escalations, setEscalations] = useState<ItemFormEntry[]>(initialData?.escalations ?? []);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load user name for rep field — use functional updater to avoid overwriting user input
  useEffect(() => {
    import("@/src/lib/supabase/browser").then(({ supabaseBrowser }) => {
      supabaseBrowser().auth.getUser().then(({ data }) => {
        const email = data.user?.email ?? "";
        const part = email.split("@")[0];
        if (part) {
          const autoName = part.split(".").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
          setRepName((prev) => prev || autoName);
        }
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load projects
  useEffect(() => {
    fetch("/api/site-reports/projects")
      .then((r) => r.json())
      .then((d: { projects?: SiteProject[] }) => setProjects(d.projects ?? []));
  }, []);

  // When project changes (new mode only), load milestone templates + prior completion
  const loadMilestones = useCallback(async (pid: string) => {
    if (!pid || isEdit) return;

    const [templateRes, priorRes] = await Promise.all([
      fetch(`/api/site-reports/milestones?project_id=${pid}`),
      fetch(`/api/site-reports?latest_for_project=${pid}`),
    ]);
    const templateData = await templateRes.json() as { milestones?: SiteMilestone[] };
    const priorData = await priorRes.json() as { milestones?: SiteReportMilestone[] };

    const priorByMilestoneId = new Map(
      (priorData.milestones ?? [])
        .filter((m) => m.milestone_id && m.status === "completed")
        .map((m) => [m.milestone_id!, m])
    );

    setMilestones(
      (templateData.milestones ?? []).sort((a, b) => a.sort_order - b.sort_order).map((ms) => {
        const prior = !ms.is_spacer ? priorByMilestoneId.get(ms.id) : undefined;
        return {
          localId: makeLocalId(),
          milestone_id: ms.id,
          is_spacer: ms.is_spacer,
          milestone_name: ms.name,
          milestone_date: ms.milestone_date ?? "",
          scheduled_date: ms.scheduled_date ?? "",
          status: prior ? ("completed" as const) : ("not_started" as const),
          completed_date: prior?.completed_date ?? "",
          comments: prior ? (prior.comments ?? "-") : "",
          sort_order: ms.sort_order,
        };
      })
    );
  }, [isEdit]);

  function handleProjectChange(pid: string) {
    setProjectId(pid);
    void loadMilestones(pid);
  }

  // ── Milestone helpers ──────────────────────────────────────────────────────

  function updateMilestone(localId: string, updates: Partial<MilestoneFormEntry>) {
    setMilestones((prev) => prev.map((m) => m.localId === localId ? { ...m, ...updates } : m));
  }

  function addCustomMilestone() {
    setMilestones((prev) => [
      ...prev,
      {
        localId: makeLocalId(),
        milestone_id: null,
        is_spacer: false,
        milestone_name: "",
        milestone_date: "",
        scheduled_date: "",
        status: "not_started",
        completed_date: "",
        comments: "",
        sort_order: prev.length,
      },
    ]);
  }

  function removeMilestone(localId: string) {
    setMilestones((prev) => prev.filter((m) => m.localId !== localId));
  }

  // ── Item helpers ───────────────────────────────────────────────────────────

  function updateItem(
    setter: React.Dispatch<React.SetStateAction<ItemFormEntry[]>>,
    localId: string,
    updates: Partial<ItemFormEntry>
  ) {
    setter((prev) => prev.map((item) => item.localId === localId ? { ...item, ...updates } : item));
  }

  function removeItem(
    setter: React.Dispatch<React.SetStateAction<ItemFormEntry[]>>,
    localId: string
  ) {
    setter((prev) => prev.filter((item) => item.localId !== localId));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const buildPayload = useMemo(() => ({
    project_id: projectId,
    observation_date: date,
    rep_name: repName,
    overall_status: overallStatus,
    milestones: milestones.map((m) => ({
      milestone_id: m.milestone_id,
      is_spacer: m.is_spacer,
      milestone_name: m.is_spacer ? "" : m.milestone_name,
      milestone_date: m.is_spacer ? null : (m.milestone_date || null),
      scheduled_date: m.is_spacer || m.status === "completed" ? null : (m.scheduled_date || null),
      status: m.is_spacer ? ("not_started" as const) : m.status,
      completed_date: !m.is_spacer && m.status === "completed" ? (m.completed_date || null) : null,
      comments: m.is_spacer ? null : (m.status === "completed" ? (m.comments || "-") : (m.comments || null)),
      sort_order: m.sort_order,
    })),
    items: [
      ...highlights.map((i) => ({ type: "highlight", ...i })),
      ...recommendations.map((i) => ({ type: "recommendation", ...i })),
      ...risks.map((i) => ({ type: "risk", ...i })),
      ...escalations.map((i) => ({ type: "escalation", ...i })),
    ]
    .filter((i) => i.item_name.trim().length > 0)
    .map(({ localId: _l, originalComments: _o, aiPolished: _a, polishing: _p, ...rest }) => ({
      ...rest,
      // "" is invalid for Postgres date column — must be null
      recommendation_date: rest.recommendation_date || null,
    })),
  }), [projectId, date, repName, overallStatus, milestones, highlights, recommendations, risks, escalations]);

  async function handleSubmit() {
    if (!projectId || !date || !repName.trim()) {
      setSubmitError("Project, date, and rep name are required.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const url = isEdit ? "/api/site-reports" : "/api/site-reports";
      const method = isEdit ? "PUT" : "POST";
      const body = isEdit ? { id: initialData!.id, ...buildPayload } : buildPayload;

      console.log("[submit] raw counts — highlights:", highlights.length, "recs:", recommendations.length, "risks:", risks.length, "escalations:", escalations.length);
      console.log("[submit] payload items:", body.items?.length ?? 0, body.items);

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { report?: { id: string }; error?: string; warning?: string };
      console.log("[submit] response status:", res.status, "body:", data);
      if (data.warning) console.warn("[submit] server warning:", data.warning);
      if (data.error) throw new Error(data.error);

      const reportId = data.report!.id;

      // Generate PDF in background
      fetch("/api/site-reports/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      }).catch(() => {}); // non-blocking

      router.push(`/site-reports/${reportId}`);
    } catch (e: unknown) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 pb-20">

      {/* ── 1. Project & Basic Info ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/[0.06] bg-surface p-5 space-y-5">

        <div>
          <label className="block text-base font-medium text-slate-200 mb-2">Project *</label>
          <select
            value={projectId}
            onChange={(e) => handleProjectChange(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-base px-4 py-3.5 text-base text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ""}</option>
            ))}
          </select>
          {projects.length === 0 && (
            <p className="text-sm text-slate-500 mt-1.5">
              No projects yet.{" "}
              <Link href="/site-reports/projects" className="text-emerald-400 underline">Create one first.</Link>
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-base font-medium text-slate-200 mb-2">Observation Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-base px-4 py-3.5 text-base text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
          <div>
            <label className="block text-base font-medium text-slate-200 mb-2">Onsite Rep Name *</label>
            <input
              type="text"
              value={repName}
              onChange={(e) => setRepName(e.target.value)}
              placeholder="Your full name"
              className="w-full rounded-xl border border-white/10 bg-base px-4 py-3.5 text-base text-slate-200 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
        </div>

        <div>
          <label className="block text-base font-medium text-slate-200 mb-2">Overall Site Status</label>
          <StatusTriple value={overallStatus} onChange={setOverallStatus} />
          {risks.length === 0 && escalations.length === 0 && overallStatus !== "on_track" && (
            <p className="mt-2 text-xs text-emerald-400/70">
              No risks or escalations — consider setting status to <button type="button" onClick={() => setOverallStatus("on_track")} className="underline hover:text-emerald-400">On Track</button>.
            </p>
          )}
        </div>
      </div>

      {/* ── 2. Schedule Observation ────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader title="Schedule Observation" count={milestones.filter((m) => !m.is_spacer).length} />
        {milestones.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-4">
            {projectId
              ? "No milestone templates for this project yet. Add them below or in Projects."
              : "Select a project to auto-load its milestone templates."}
          </p>
        )}
        <div className="space-y-3">
          {milestones.map((ms) => {
            if (ms.is_spacer) {
              return <div key={ms.localId} className="h-3" />;
            }
            const isCompleted = ms.status === "completed";
            return (
              <div
                key={ms.localId}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  {ms.milestone_id ? (
                    <div className="flex-1">
                      <p className="font-medium text-slate-200">{ms.milestone_name}</p>
                      <div className="flex gap-4 mt-0.5 flex-wrap">
                        {ms.milestone_date && (
                          <p className="text-xs text-slate-500">Original Target: {ms.milestone_date}</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={ms.milestone_name}
                      onChange={(e) => updateMilestone(ms.localId, { milestone_name: e.target.value })}
                      placeholder="Milestone name"
                      className="flex-1 rounded-lg border border-white/10 bg-base px-3 py-2 text-base text-slate-200 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeMilestone(ms.localId)}
                    className="text-slate-500 hover:text-red-400 text-lg leading-none shrink-0 mt-0.5"
                  >✕</button>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Status</label>
                  <MilestoneStatusButtons
                    value={ms.status}
                    onChange={(v) => {
                      const updates: Partial<MilestoneFormEntry> = { status: v as MilestoneFormEntry["status"] };
                      if (v === "completed") {
                        if (!ms.comments) updates.comments = "-";
                      } else {
                        updates.completed_date = "";
                      }
                      updateMilestone(ms.localId, updates);
                    }}
                  />
                </div>
                {!isCompleted && (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">Scheduled Date (Current Plan)</label>
                    <input
                      type="date"
                      value={ms.scheduled_date}
                      onChange={(e) => updateMilestone(ms.localId, { scheduled_date: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-base px-4 py-2.5 text-base text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                )}
                {isCompleted && (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1.5">Completed Date</label>
                    <input
                      type="date"
                      value={ms.completed_date}
                      onChange={(e) => updateMilestone(ms.localId, { completed_date: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-base px-4 py-2.5 text-base text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm text-slate-400 mb-1.5">Comments</label>
                  <textarea
                    value={ms.comments}
                    onChange={(e) => updateMilestone(ms.localId, { comments: e.target.value })}
                    placeholder={isCompleted ? "-" : "Optional notes…"}
                    rows={2}
                    className="w-full rounded-lg border border-white/10 bg-base px-4 py-2.5 text-base text-slate-200 placeholder:text-slate-500 outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <Button variant="ghost" onClick={addCustomMilestone} className="w-full py-3">
          + Add Milestone
        </Button>
      </div>

      {/* ── 3. Highlights ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader title="Highlights" count={highlights.length} />
        <div className="space-y-3">
          {highlights.map((item, i) => (
            <ItemCard
              key={item.localId}
              item={item}
              index={i}
              context="highlight"
              showDateField={false}
              observationDate={date}
              onChange={(u) => updateItem(setHighlights, item.localId, u)}
              onRemove={() => removeItem(setHighlights, item.localId)}
            />
          ))}
        </div>
        <Button variant="ghost" onClick={() => setHighlights((p) => [...p, makeItem()])} className="w-full py-3">
          + Add Highlight
        </Button>
      </div>

      {/* ── 4. Recommendations to Contractors ─────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader title="Recommendations to Contractors" count={recommendations.length} />
        <div className="space-y-3">
          {recommendations.map((item, i) => (
            <ItemCard
              key={item.localId}
              item={item}
              index={i}
              context="recommendation"
              showDateField={true}
              observationDate={date}
              onChange={(u) => updateItem(setRecommendations, item.localId, u)}
              onRemove={() => removeItem(setRecommendations, item.localId)}
            />
          ))}
        </div>
        <Button variant="ghost" onClick={() => setRecommendations((p) => [...p, makeItem(date)])} className="w-full py-3">
          + Add Recommendation
        </Button>
      </div>

      {/* ── 5. Risks / Opportunities ──────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader title="Risks / Opportunities" count={risks.length} />
        <div className="space-y-3">
          {risks.map((item, i) => (
            <ItemCard
              key={item.localId}
              item={item}
              index={i}
              context="risk"
              showDateField={false}
              observationDate={date}
              onChange={(u) => updateItem(setRisks, item.localId, u)}
              onRemove={() => removeItem(setRisks, item.localId)}
            />
          ))}
        </div>
        <Button variant="ghost" onClick={() => setRisks((p) => [...p, makeItem()])} className="w-full py-3">
          + Add Risk / Opportunity
        </Button>
        {risks.length > 0 && (
          <p className="text-xs text-slate-500 text-center">
            <Link href="/site-reports" className="text-emerald-400 hover:text-emerald-300 underline">
              See all risks &gt;&gt;
            </Link>
          </p>
        )}
      </div>

      {/* ── 6. Escalations ────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader title="Escalations" count={escalations.length} />
        <div className="space-y-3">
          {escalations.map((item, i) => (
            <ItemCard
              key={item.localId}
              item={item}
              index={i}
              context="escalation"
              showDateField={false}
              observationDate={date}
              onChange={(u) => updateItem(setEscalations, item.localId, u)}
              onRemove={() => removeItem(setEscalations, item.localId)}
            />
          ))}
        </div>
        <Button variant="ghost" onClick={() => setEscalations((p) => [...p, makeItem()])} className="w-full py-3">
          + Add Escalation
        </Button>
      </div>

      {/* ── Submit ────────────────────────────────────────────────────────── */}
      {submitError && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          {submitError}
        </div>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl py-4 text-lg font-semibold transition-colors shadow-lg"
      >
        {submitting
          ? (isEdit ? "Saving…" : "Submitting…")
          : (isEdit ? "Save Changes" : "Submit Report")}
      </button>
      {submitting && (
        <p className="text-center text-sm text-slate-400">
          Saving report and generating PDF…
        </p>
      )}
    </div>
  );
}
