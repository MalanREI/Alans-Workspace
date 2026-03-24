"use client";

import { useEffect, useState, use, useMemo } from "react";
import type { SiteProject, SiteReportItem } from "@/src/lib/types/site-reports";

function AtpdLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="text-2xl font-bold text-blue-400 shrink-0">AT-PD</span>;
  return (
    <img
      src="/atpd-logo.png"
      alt="AT-PD"
      className="h-9 w-auto shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type PublicReport = {
  id: string;
  observation_date: string;
  rep_name: string;
  overall_status: string;
};

type PublicData = {
  project: SiteProject;
  items: (SiteReportItem & { site_reports: { observation_date: string; rep_name: string; overall_status: string } })[];
  reports: PublicReport[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusLabel(s: string) {
  const map: Record<string, string> = {
    on_track: "On Track", risk: "Risk", behind: "Behind",
    completed: "Completed", not_started: "Not Started",
    green: "Green", yellow: "Yellow", red: "Red",
    open: "Open", closed: "Closed", in_progress: "In Progress",
  };
  return map[s?.toLowerCase()] ?? s;
}

function statusColor(s: string): string {
  const k = s?.toLowerCase();
  if (k === "green" || k === "on_track" || k === "completed") return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  if (k === "yellow" || k === "risk") return "bg-amber-100 text-amber-800 border border-amber-200";
  if (k === "red" || k === "behind") return "bg-red-100 text-red-800 border border-red-200";
  if (k === "not_started") return "bg-gray-100 text-gray-600 border border-gray-200";
  return "bg-blue-100 text-blue-800 border border-blue-200";
}

function typeColor(t: string): string {
  if (t === "highlight")      return "bg-sky-100 text-sky-800 border border-sky-200";
  if (t === "recommendation") return "bg-violet-100 text-violet-800 border border-violet-200";
  if (t === "risk")           return "bg-orange-100 text-orange-800 border border-orange-200";
  if (t === "escalation")     return "bg-red-100 text-red-800 border border-red-200";
  return "bg-gray-100 text-gray-700 border border-gray-200";
}

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    highlight: "Highlight",
    recommendation: "Recommendation",
    risk: "Risk / Opp",
    escalation: "Escalation",
  };
  return map[t] ?? t;
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
        active
          ? "bg-slate-800 text-white border-slate-700"
          : "bg-white text-slate-600 border-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Sort button ──────────────────────────────────────────────────────────────

type SortKey = "date" | "type" | "status";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PublicMasterList({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PublicData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`/api/site-reports/public/${token}`)
      .then((r) => r.json())
      .then((d: PublicData & { error?: string }) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let items = [...data.items];

    // Tab filter
    if (activeType !== "all") items = items.filter((i) => i.type === activeType);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.item_name.toLowerCase().includes(q) ||
          i.comments.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q)
      );
    }

    // Sort
    items.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") {
        const da = a.site_reports?.observation_date ?? a.created_at ?? "";
        const db = b.site_reports?.observation_date ?? b.created_at ?? "";
        cmp = da.localeCompare(db);
      } else if (sortKey === "type") {
        cmp = a.type.localeCompare(b.type);
      } else if (sortKey === "status") {
        cmp = a.status.localeCompare(b.status);
      }
      return sortAsc ? cmp : -cmp;
    });

    return items;
  }, [data, activeType, search, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return " ↕";
    return sortAsc ? " ↑" : " ↓";
  }

  const counts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const c: Record<string, number> = { all: data.items.length };
    for (const item of data.items) {
      c[item.type] = (c[item.type] ?? 0) + 1;
    }
    return c;
  }, [data]);

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Link not found</h2>
          <p className="text-gray-500 text-sm">{error ?? "This share link is invalid or has expired."}</p>
        </div>
      </div>
    );
  }

  const { project } = data;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-[#0f1726] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">
                Internal Onsite Observation Report — Master List
              </p>
              <h1 className="text-2xl font-bold">{project.name}</h1>
              <div className="flex gap-4 mt-1.5 text-sm text-slate-300 flex-wrap">
                {project.client && <span>Client: {project.client}</span>}
                {project.location && <span>📍 {project.location}</span>}
                <span className="text-slate-400">{data.reports.length} site visit{data.reports.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
            <AtpdLogo />
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">

          {/* Tab filters */}
          <div className="flex gap-2 flex-wrap">
            {(["all", "highlight", "recommendation", "risk", "escalation"] as const).map((t) => (
              <TabBtn key={t} active={activeType === t} onClick={() => setActiveType(t)}>
                {t === "all" ? "All Items" :
                 t === "highlight" ? "Highlights" :
                 t === "recommendation" ? "Recommendations" :
                 t === "risk" ? "Risks / Opp" : "Escalations"}
                <span className="ml-1.5 text-xs opacity-60">({counts[t] ?? 0})</span>
              </TabBtn>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full sm:w-56 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-gray-400"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              No items found{search ? " matching your search" : ""}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 whitespace-nowrap"
                      onClick={() => toggleSort("type")}
                    >
                      Type{sortIndicator("type")}
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 whitespace-nowrap"
                      onClick={() => toggleSort("date")}
                    >
                      Date{sortIndicator("date")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Item
                    </th>
                    <th
                      className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 whitespace-nowrap"
                      onClick={() => toggleSort("status")}
                    >
                      Status{sortIndicator("status")}
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Comments
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      Site Visit
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${typeColor(item.type)}`}>
                          {typeLabel(item.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                        {formatDate(item.site_reports?.observation_date)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{item.item_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(item.status)}`}>
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm max-w-xs">
                        {item.comments || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                        {item.site_reports?.rep_name ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["highlight", "recommendation", "risk", "escalation"] as const).map((t) => (
            <div key={t} className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
              <p className="text-2xl font-bold text-gray-800">{counts[t] ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1">{typeLabel(t)}{(counts[t] ?? 0) !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>

      </div>

      {/* Footer */}
      <footer className="text-center py-8 text-xs text-gray-400 border-t border-gray-200 mt-8">
        Generated by Alan&apos;s Workspace · View-only access · Confidential AT-PD document
      </footer>

    </div>
  );
}
