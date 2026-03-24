"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { PageShell } from "@/src/components/PageShell";
import { Button, Input, Modal } from "@/src/components/ui";
import type { SiteProject, SiteMilestone } from "@/src/lib/types/site-reports";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectFormState = {
  name: string;
  client: string;
  location: string;
};

type MilestoneFormState = {
  name: string;
  milestone_date: string;
  scheduled_date: string;
};

const EMPTY_PROJECT: ProjectFormState = { name: "", client: "", location: "" };
const EMPTY_MILESTONE: MilestoneFormState = { name: "", milestone_date: "", scheduled_date: "" };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const [projects, setProjects] = useState<SiteProject[]>([]);
  const [milestones, setMilestones] = useState<Record<string, SiteMilestone[]>>({});
  const [projectTokens, setProjectTokens] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Project modal
  const [projectModal, setProjectModal] = useState<"new" | SiteProject | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectFormState>(EMPTY_PROJECT);
  const [savingProject, setSavingProject] = useState(false);

  // Milestone modal
  const [milestoneModal, setMilestoneModal] = useState<{ project: SiteProject; milestone?: SiteMilestone } | null>(null);
  const [msForm, setMsForm] = useState<MilestoneFormState>(EMPTY_MILESTONE);
  const [savingMs, setSavingMs] = useState(false);

  // Expanded project accordion
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/site-reports/projects");
      const data = await res.json() as { projects?: SiteProject[]; error?: string };
      if (data.error) throw new Error(data.error);
      setProjects(data.projects ?? []);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMilestones = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/site-reports/milestones?project_id=${projectId}`);
    const data = await res.json() as { milestones?: SiteMilestone[]; error?: string };
    if (!data.error) {
      setMilestones((prev) => ({ ...prev, [projectId]: data.milestones ?? [] }));
    }
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  // Load one public_share_token per project so we can link to the master list
  useEffect(() => {
    fetch("/api/site-reports")
      .then((r) => r.json())
      .then((d: { reports?: Array<{ project_id: string; public_share_token: string }> }) => {
        const tokens: Record<string, string> = {};
        for (const r of d.reports ?? []) {
          if (r.project_id && r.public_share_token && !tokens[r.project_id]) {
            tokens[r.project_id] = r.public_share_token;
          }
        }
        setProjectTokens(tokens);
      })
      .catch(() => {});
  }, []);

  function toggleExpand(projectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
        if (!milestones[projectId]) {
          void loadMilestones(projectId);
        }
      }
      return next;
    });
  }

  // ── Project CRUD ─────────────────────────────────────────────────────────

  function openNewProject() {
    setProjectForm(EMPTY_PROJECT);
    setProjectModal("new");
  }

  function openEditProject(p: SiteProject) {
    setProjectForm({ name: p.name, client: p.client, location: p.location });
    setProjectModal(p);
  }

  async function saveProject() {
    if (!projectForm.name.trim()) return;
    setSavingProject(true);
    try {
      const isNew = projectModal === "new";
      const res = await fetch("/api/site-reports/projects", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew ? projectForm : { id: (projectModal as SiteProject).id, ...projectForm }
        ),
      });
      const data = await res.json() as { project?: SiteProject; error?: string };
      if (data.error) throw new Error(data.error);
      await loadProjects();
      setProjectModal(null);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSavingProject(false);
    }
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its reports? This cannot be undone.")) return;
    await fetch(`/api/site-reports/projects?id=${id}`, { method: "DELETE" });
    await loadProjects();
  }

  // ── Milestone CRUD ───────────────────────────────────────────────────────

  function openNewMilestone(project: SiteProject) {
    setMsForm(EMPTY_MILESTONE);
    setMilestoneModal({ project });
  }

  function openEditMilestone(project: SiteProject, ms: SiteMilestone) {
    setMsForm({ name: ms.name, milestone_date: ms.milestone_date ?? "", scheduled_date: ms.scheduled_date ?? "" });
    setMilestoneModal({ project, milestone: ms });
  }

  async function saveMilestone() {
    if (!milestoneModal || !msForm.name.trim()) return;
    setSavingMs(true);
    try {
      const { project, milestone } = milestoneModal;
      const projectMss = milestones[project.id] ?? [];
      const isNew = !milestone;
      const body = isNew
        ? { project_id: project.id, ...msForm, sort_order: projectMss.length }
        : { id: milestone.id, ...msForm };

      const res = await fetch("/api/site-reports/milestones", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { milestone?: SiteMilestone; error?: string };
      if (data.error) throw new Error(data.error);
      await loadMilestones(project.id);
      setMilestoneModal(null);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSavingMs(false);
    }
  }

  async function deleteMilestone(projectId: string, msId: string) {
    if (!confirm("Remove this milestone template?")) return;
    await fetch(`/api/site-reports/milestones?id=${msId}`, { method: "DELETE" });
    await loadMilestones(projectId);
  }

  async function addSpacer(project: SiteProject) {
    const projectMss = milestones[project.id] ?? [];
    await fetch("/api/site-reports/milestones", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: project.id,
        name: "",
        is_spacer: true,
        sort_order: projectMss.length,
      }),
    });
    await loadMilestones(project.id);
  }

  async function moveMilestone(projectId: string, msId: string, direction: "up" | "down") {
    const mss = [...(milestones[projectId] ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    const idx = mss.findIndex((m) => m.id === msId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= mss.length) return;
    // Swap sort_order values
    await Promise.all([
      fetch("/api/site-reports/milestones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mss[idx].id, sort_order: mss[swapIdx].sort_order }),
      }),
      fetch("/api/site-reports/milestones", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: mss[swapIdx].id, sort_order: mss[idx].sort_order }),
      }),
    ]);
    await loadMilestones(projectId);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <PageShell>
      <div className="max-w-4xl space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Projects</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Manage site projects and milestone templates
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/site-reports">
              <Button variant="ghost">← Reports</Button>
            </Link>
            <Button onClick={openNewProject}>+ New Project</Button>
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            {error}
          </div>
        )}

        {loading && <div className="text-center py-12 text-slate-400">Loading…</div>}

        {!loading && projects.length === 0 && (
          <div className="rounded-2xl border border-white/[0.06] bg-surface p-12 text-center">
            <div className="text-4xl mb-4">🏗️</div>
            <h3 className="text-lg font-medium text-slate-200 mb-2">No projects yet</h3>
            <p className="text-slate-400 text-sm mb-6">
              Create a project for each construction site. Add milestone templates that will auto-populate in new reports.
            </p>
            <Button onClick={openNewProject}>+ Create First Project</Button>
          </div>
        )}

        {/* Project list */}
        <div className="space-y-3">
          {projects.map((project) => {
            const isOpen = expanded.has(project.id);
            const pMilestones = milestones[project.id] ?? [];
            const sorted = [...pMilestones].sort((a, b) => a.sort_order - b.sort_order);

            return (
              <div key={project.id} className="rounded-2xl border border-white/[0.06] bg-surface overflow-hidden">
                {/* Project row */}
                <div className="flex items-center gap-3 p-4">
                  <button
                    onClick={() => toggleExpand(project.id)}
                    className="flex-1 flex items-start gap-3 text-left"
                  >
                    <span className="text-slate-400 text-sm mt-0.5">{isOpen ? "▾" : "▸"}</span>
                    <div>
                      <div className="font-medium text-slate-100">{project.name}</div>
                      <div className="text-sm text-slate-400 mt-0.5 flex gap-3 flex-wrap">
                        {project.client && <span>🏢 {project.client}</span>}
                        {project.location && <span>📍 {project.location}</span>}
                        <span className={`capitalize px-1.5 py-0.5 rounded text-xs ${
                          project.status === "active" ? "bg-emerald-500/10 text-emerald-400" :
                          project.status === "completed" ? "bg-slate-500/10 text-slate-400" :
                          "bg-amber-500/10 text-amber-400"
                        }`}>
                          {project.status}
                        </span>
                      </div>
                    </div>
                  </button>
                  <div className="flex gap-2 flex-wrap">
                    {projectTokens[project.id] ? (
                      <a
                        href={`/site-reports/public/${projectTokens[project.id]}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button variant="ghost" className="text-xs px-2.5 py-1.5">
                          View Item Tracker
                        </Button>
                      </a>
                    ) : (
                      <Button
                        variant="ghost"
                        className="text-xs px-2.5 py-1.5 opacity-40 cursor-not-allowed"
                        title="Create a report first to enable the item tracker"
                        disabled
                      >
                        View Item Tracker
                      </Button>
                    )}
                    <Button variant="ghost" className="text-xs px-2.5 py-1.5" onClick={() => openEditProject(project)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-xs px-2.5 py-1.5 text-red-400 hover:text-red-300"
                      onClick={() => deleteProject(project.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* Milestones accordion */}
                {isOpen && (
                  <div className="border-t border-white/[0.06] p-4 bg-white/[0.02]">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-slate-300">
                        Milestone Templates
                        <span className="ml-2 text-xs text-slate-500">({sorted.filter((m) => !m.is_spacer).length})</span>
                      </h4>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          className="text-xs px-2.5 py-1.5 text-slate-500"
                          onClick={() => addSpacer(project)}
                        >
                          + Spacer
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-xs px-2.5 py-1.5"
                          onClick={() => openNewMilestone(project)}
                        >
                          + Add Milestone
                        </Button>
                      </div>
                    </div>

                    {sorted.length === 0 ? (
                      <p className="text-sm text-slate-500 py-2">
                        No milestones yet. Add milestones to auto-populate new reports.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {sorted.map((ms, i) => (
                          ms.is_spacer ? (
                            <div
                              key={ms.id}
                              className="flex items-center gap-2 px-1 py-1"
                            >
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <button
                                  onClick={() => moveMilestone(project.id, ms.id, "up")}
                                  disabled={i === 0}
                                  className="text-slate-700 hover:text-slate-500 disabled:opacity-20 text-xs leading-none"
                                >▲</button>
                                <button
                                  onClick={() => moveMilestone(project.id, ms.id, "down")}
                                  disabled={i === sorted.length - 1}
                                  className="text-slate-700 hover:text-slate-500 disabled:opacity-20 text-xs leading-none"
                                >▼</button>
                              </div>
                              <div className="flex-1 h-px bg-white/[0.08]" />
                              <span className="text-xs text-slate-600 italic shrink-0">spacer</span>
                              <button
                                onClick={() => deleteMilestone(project.id, ms.id)}
                                className="text-slate-600 hover:text-red-400 text-sm leading-none shrink-0"
                              >✕</button>
                            </div>
                          ) : (
                            <div
                              key={ms.id}
                              className="flex items-center gap-2 rounded-lg bg-surface border border-white/[0.06] px-3 py-2"
                            >
                              {/* Reorder */}
                              <div className="flex flex-col gap-0.5">
                                <button
                                  onClick={() => moveMilestone(project.id, ms.id, "up")}
                                  disabled={i === 0}
                                  className="text-slate-600 hover:text-slate-400 disabled:opacity-20 text-xs leading-none"
                                >▲</button>
                                <button
                                  onClick={() => moveMilestone(project.id, ms.id, "down")}
                                  disabled={i === sorted.length - 1}
                                  className="text-slate-600 hover:text-slate-400 disabled:opacity-20 text-xs leading-none"
                                >▼</button>
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm text-slate-200">{ms.name}</span>
                                <div className="flex gap-3 mt-0.5 flex-wrap">
                                  {ms.milestone_date && (
                                    <span className="text-xs text-slate-500">Target: {ms.milestone_date}</span>
                                  )}
                                  {ms.scheduled_date && (
                                    <span className="text-xs text-slate-500">Plan: {ms.scheduled_date}</span>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                className="text-xs px-2 py-1"
                                onClick={() => openEditMilestone(project, ms)}
                              >Edit</Button>
                              <Button
                                variant="ghost"
                                className="text-xs px-2 py-1 text-red-400"
                                onClick={() => deleteMilestone(project.id, ms.id)}
                              >✕</Button>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>

      {/* Project modal */}
      <Modal
        open={projectModal !== null}
        title={projectModal === "new" ? "New Project" : "Edit Project"}
        onClose={() => setProjectModal(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setProjectModal(null)}>Cancel</Button>
            <Button onClick={saveProject} disabled={savingProject || !projectForm.name.trim()}>
              {savingProject ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Project Name *</label>
            <Input
              value={projectForm.name}
              onChange={(e) => setProjectForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Argo/Nvidia/A310"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Client</label>
            <Input
              value={projectForm.client}
              onChange={(e) => setProjectForm((p) => ({ ...p, client: e.target.value }))}
              placeholder="e.g. Nvidia"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Location</label>
            <Input
              value={projectForm.location}
              onChange={(e) => setProjectForm((p) => ({ ...p, location: e.target.value }))}
              placeholder="e.g. Sacramento, CA"
            />
          </div>
          {projectModal !== "new" && (
            <div>
              <label className="block text-sm text-slate-300 mb-1.5">Status</label>
              <select
                value={(projectModal as SiteProject)?.status}
                onChange={(e) => {
                  const val = e.target.value;
                  setProjectModal((prev) => prev && prev !== "new" ? { ...prev, status: val as SiteProject["status"] } : prev);
                }}
                className="w-full rounded-lg border border-white/10 bg-base px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="on-hold">On Hold</option>
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Milestone modal */}
      <Modal
        open={milestoneModal !== null}
        title={milestoneModal?.milestone ? "Edit Milestone" : "Add Milestone"}
        onClose={() => setMilestoneModal(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMilestoneModal(null)}>Cancel</Button>
            <Button onClick={saveMilestone} disabled={savingMs || !msForm.name.trim()}>
              {savingMs ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Milestone Name *</label>
            <Input
              value={msForm.name}
              onChange={(e) => setMsForm((m) => ({ ...m, name: e.target.value }))}
              placeholder="e.g. DH1-310 Construction Mobilization"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Milestone Date (Original Target)</label>
            <Input
              type="date"
              value={msForm.milestone_date}
              onChange={(e) => setMsForm((m) => ({ ...m, milestone_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1.5">Scheduled Date (Current Plan)</label>
            <Input
              type="date"
              value={msForm.scheduled_date}
              onChange={(e) => setMsForm((m) => ({ ...m, scheduled_date: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
