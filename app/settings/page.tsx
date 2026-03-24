"use client";

import { useMemo, useEffect, useState, useRef } from "react";
import { PageShell } from "@/src/components/PageShell";
import { Card, Button, Input, Modal } from "@/src/components/ui";
import { supabaseBrowser } from "@/src/lib/supabase/browser";

// ─── Reusable primitives ─────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
        checked ? "bg-emerald-600" : "bg-white/10",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-white/10 bg-base px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-400">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function RowToggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-white/[0.06] last:border-0">
      <div>
        <div className="text-sm text-slate-200">{label}</div>
        {description && <div className="text-xs text-slate-500 mt-0.5">{description}</div>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 mt-6 first:mt-0">{children}</h3>;
}

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { value: "profile", label: "Profile & Account", icon: "👤" },
  { value: "appearance", label: "Appearance", icon: "🎨" },
  { value: "notifications", label: "Notifications", icon: "🔔" },
  { value: "ai", label: "AI Preferences", icon: "🤖" },
  { value: "integrations", label: "Integrations", icon: "🔗" },
  { value: "team", label: "Team Management", icon: "👥" },
  { value: "data", label: "Data & Privacy", icon: "🔒" },
  { value: "about", label: "About", icon: "ℹ️" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

// ─── Section components ───────────────────────────────────────────────────────

function ProfileSection({ email }: { email: string }) {
  const [displayName, setDisplayName] = useState("Alan Moore");
  const [role, setRole] = useState("Team Lead");
  const [company, setCompany] = useState("Alan's Workspace");
  const [saved, setSaved] = useState(false);

  // TODO: Supabase table needed: profiles (id uuid FK auth.users, display_name text, role text, company text, avatar_url text)

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      <Card title="Profile & Account">
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-white/[0.06]">
          <div className="relative">
            <div className="h-16 w-16 rounded-full bg-emerald-600/20 border border-emerald-500/20 flex items-center justify-center text-2xl font-bold text-emerald-400">
              {displayName?.[0]?.toUpperCase() ?? "U"}
            </div>
            <button
              className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-elevated border border-white/10 flex items-center justify-center text-slate-400 hover:text-slate-200 text-xs transition-colors"
              title="Upload avatar"
            >
              ✏️
            </button>
            {/* TODO: wire up avatar upload to Supabase Storage bucket "avatars" */}
          </div>
          <div>
            <div className="text-sm font-medium text-slate-200">{displayName}</div>
            <div className="text-xs text-slate-500">{email}</div>
            <button className="mt-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">Change avatar</button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Display Name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </Field>
          <Field label="Email" hint="Managed by Supabase Auth — contact admin to change">
            <Input value={email} readOnly className="opacity-60 cursor-not-allowed" />
          </Field>
          <Field label="Role / Title">
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Team Lead" />
          </Field>
          <Field label="Company Name">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Alan's Workspace" />
          </Field>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={save}>{saved ? "Saved ✓" : "Save Changes"}</Button>
          {saved && <span className="text-xs text-emerald-400">Profile updated</span>}
        </div>
      </Card>
    </div>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [sidebarDefault, setSidebarDefault] = useState<"expanded" | "collapsed">("expanded");
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");

  // TODO: Supabase table: user_preferences (user_id, theme, sidebar_default, density)

  return (
    <Card title="Appearance">
      <div className="space-y-6">
        <SectionHeading>Theme</SectionHeading>
        <div className="grid grid-cols-3 gap-3">
          {(["dark", "light", "system"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={[
                "rounded-xl border p-4 text-left transition-all",
                theme === t
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  : "border-white/10 bg-base text-slate-400 hover:border-white/20 hover:text-slate-200",
              ].join(" ")}
            >
              <div className="text-lg mb-1">{t === "dark" ? "🌙" : t === "light" ? "☀️" : "💻"}</div>
              <div className="text-sm font-medium capitalize">{t}</div>
              <div className="text-xs opacity-60 mt-0.5">
                {t === "dark" ? "Always dark" : t === "light" ? "Always light" : "Follow OS"}
              </div>
            </button>
          ))}
        </div>

        <SectionHeading>Sidebar</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          {(["expanded", "collapsed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSidebarDefault(s)}
              className={[
                "rounded-xl border p-4 text-left transition-all",
                sidebarDefault === s
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  : "border-white/10 bg-base text-slate-400 hover:border-white/20 hover:text-slate-200",
              ].join(" ")}
            >
              <div className="text-sm font-medium capitalize">{s}</div>
              <div className="text-xs opacity-60 mt-0.5">
                {s === "expanded" ? "Show labels by default" : "Icon-only by default"}
              </div>
            </button>
          ))}
        </div>

        <SectionHeading>Dashboard Density</SectionHeading>
        <div className="grid grid-cols-2 gap-3">
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDensity(d)}
              className={[
                "rounded-xl border p-4 text-left transition-all",
                density === d
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  : "border-white/10 bg-base text-slate-400 hover:border-white/20 hover:text-slate-200",
              ].join(" ")}
            >
              <div className="text-sm font-medium capitalize">{d}</div>
              <div className="text-xs opacity-60 mt-0.5">
                {d === "comfortable" ? "More spacing, easier to read" : "Tighter layout, more on screen"}
              </div>
            </button>
          ))}
        </div>

        <Button className="mt-2">Save Preferences</Button>
      </div>
    </Card>
  );
}

function NotificationsSection() {
  const [prefs, setPrefs] = useState({
    emailNewLeads: true,
    meetingReminders: true,
    postApprovals: true,
    weeklySummary: false,
    browserPush: false,
  });

  const [reminderTiming, setReminderTiming] = useState("15");

  // TODO: Supabase table: notification_preferences (user_id, email_new_leads bool, meeting_reminders bool, reminder_minutes int, post_approvals bool, weekly_summary bool, browser_push bool)

  function toggle(key: keyof typeof prefs) {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  }

  return (
    <Card title="Notifications">
      <SectionHeading>Email Notifications</SectionHeading>
      <RowToggle
        label="New lead notifications"
        description="Get an email when a new lead enters your sales funnel"
        checked={prefs.emailNewLeads}
        onChange={() => toggle("emailNewLeads")}
      />
      <RowToggle
        label="Post approval requests"
        description="Notify when a social post needs your approval"
        checked={prefs.postApprovals}
        onChange={() => toggle("postApprovals")}
      />
      <RowToggle
        label="Weekly summary email"
        description="Every Monday — activity recap for the past week"
        checked={prefs.weeklySummary}
        onChange={() => toggle("weeklySummary")}
      />

      <SectionHeading>Meeting Reminders</SectionHeading>
      <RowToggle
        label="Meeting reminders"
        description="Send a reminder before scheduled meetings"
        checked={prefs.meetingReminders}
        onChange={() => toggle("meetingReminders")}
      />
      {prefs.meetingReminders && (
        <div className="mt-3 ml-1">
          <Field label="Remind me">
            <Select
              value={reminderTiming}
              onChange={setReminderTiming}
              options={[
                { value: "15", label: "15 minutes before" },
                { value: "30", label: "30 minutes before" },
                { value: "60", label: "1 hour before" },
              ]}
            />
          </Field>
        </div>
      )}

      <SectionHeading>Browser</SectionHeading>
      <RowToggle
        label="Browser push notifications"
        description="Show desktop notifications (requires browser permission)"
        checked={prefs.browserPush}
        onChange={() => toggle("browserPush")}
      />

      <Button className="mt-4">Save Notification Settings</Button>
    </Card>
  );
}

function AISection() {
  const [model, setModel] = useState("gpt-4o");
  const [brandVoice, setBrandVoice] = useState("professional");
  const [autoNotes, setAutoNotes] = useState(true);
  const [recapDetail, setRecapDetail] = useState<"brief" | "standard" | "detailed">("standard");

  // TODO: Supabase table: ai_preferences (user_id, default_model text, default_brand_voice text, auto_meeting_notes bool, recap_detail text)
  // TODO: brand_voices table (id, name, description, tone) — pull real values here once table exists

  return (
    <Card title="AI Preferences">
      <div className="space-y-5">
        <SectionHeading>Model</SectionHeading>
        <Field label="Default AI Model" hint="Used for content generation and AI features throughout the app">
          <Select
            value={model}
            onChange={setModel}
            options={[
              { value: "gpt-4o", label: "GPT-4o (Recommended)" },
              { value: "gpt-4o-mini", label: "GPT-4o Mini (Faster, cheaper)" },
              { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
              { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
            ]}
          />
        </Field>

        <SectionHeading>Content Generation</SectionHeading>
        <Field label="Default Brand Voice" hint="Applied when generating social posts and marketing copy">
          <Select
            value={brandVoice}
            onChange={setBrandVoice}
            options={[
              { value: "professional", label: "Professional" },
              { value: "friendly", label: "Friendly & Approachable" },
              { value: "bold", label: "Bold & Confident" },
              { value: "informative", label: "Educational & Informative" },
            ]}
          />
          {/* TODO: replace mock options with real brand_voices rows from Supabase */}
        </Field>

        <SectionHeading>Meeting AI</SectionHeading>
        <RowToggle
          label="Auto-generate meeting notes"
          description="Automatically create AI notes after each meeting recording ends"
          checked={autoNotes}
          onChange={setAutoNotes}
        />

        <Field label="AI Recap Detail Level">
          <div className="grid grid-cols-3 gap-3 mt-1">
            {(["brief", "standard", "detailed"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setRecapDetail(d)}
                className={[
                  "rounded-xl border p-3 text-left transition-all",
                  recapDetail === d
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                    : "border-white/10 bg-base text-slate-400 hover:border-white/20 hover:text-slate-200",
                ].join(" ")}
              >
                <div className="text-sm font-medium capitalize">{d}</div>
                <div className="text-xs opacity-60 mt-0.5">
                  {d === "brief" ? "Key points only" : d === "standard" ? "Balanced summary" : "Full transcript analysis"}
                </div>
              </button>
            ))}
          </div>
        </Field>

        <Button>Save AI Preferences</Button>
      </div>
    </Card>
  );
}

type ConnectionStatus = "connected" | "disconnected";

function IntegrationRow({
  name,
  description,
  status,
  onConnect,
  onDisconnect,
}: {
  name: string;
  description: string;
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 border-b border-white/[0.06] last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-200">{name}</div>
        <div className="text-xs text-slate-500 mt-0.5">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={[
            "text-xs px-2 py-0.5 rounded-full border",
            status === "connected"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-white/[0.04] border-white/10 text-slate-500",
          ].join(" ")}
        >
          {status === "connected" ? "Connected" : "Not connected"}
        </span>
        {status === "connected" ? (
          <Button variant="ghost" onClick={onDisconnect} className="text-xs py-1 px-2">
            Disconnect
          </Button>
        ) : (
          <Button onClick={onConnect} className="text-xs py-1 px-2">
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function IntegrationsSection() {
  const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({
    google: "connected",
    openai: "connected",
    instagram: "disconnected",
    facebook: "disconnected",
    linkedin: "disconnected",
    twitter: "disconnected",
  });

  const [apiKeyModal, setApiKeyModal] = useState<{ key: string; label: string } | null>(null);
  const [newApiKey, setNewApiKey] = useState("");

  // TODO: Supabase table: integrations (user_id, platform text, access_token text encrypted, refresh_token text, expires_at timestamptz, status text)

  function toggle(platform: string) {
    setConnections((prev) => ({
      ...prev,
      [platform]: prev[platform] === "connected" ? "disconnected" : "connected",
    }));
  }

  const INTEGRATIONS = [
    { key: "google", name: "Google", description: "Calendar sync and Google Meet integration" },
    { key: "instagram", name: "Instagram", description: "Post scheduling and analytics" },
    { key: "facebook", name: "Facebook", description: "Page management and post scheduling" },
    { key: "linkedin", name: "LinkedIn", description: "Professional content publishing" },
    { key: "twitter", name: "X / Twitter", description: "Tweet scheduling and engagement tracking" },
  ];

  const API_KEYS = [
    { key: "openai", label: "OpenAI API Key" },
    { key: "anthropic", label: "Anthropic API Key" },
  ];

  return (
    <div className="space-y-4">
      <Card title="Connected Accounts">
        {INTEGRATIONS.map((i) => (
          <IntegrationRow
            key={i.key}
            name={i.name}
            description={i.description}
            status={connections[i.key] as ConnectionStatus}
            onConnect={() => toggle(i.key)}
            onDisconnect={() => toggle(i.key)}
          />
        ))}
      </Card>

      <Card title="API Keys">
        <p className="text-xs text-slate-500 mb-4">Keys are stored encrypted and never shown in full after saving.</p>
        {API_KEYS.map((k) => (
          <div key={k.key} className="flex items-center justify-between gap-4 py-3 border-b border-white/[0.06] last:border-0">
            <div>
              <div className="text-sm text-slate-200">{k.label}</div>
              <div className="font-mono text-xs text-slate-500 mt-0.5">
                {connections[k.key] === "connected" ? "sk-••••••••••••••••••••" : "Not configured"}
              </div>
            </div>
            <Button
              variant="ghost"
              className="text-xs py-1 px-2 shrink-0"
              onClick={() => {
                setApiKeyModal(k);
                setNewApiKey("");
              }}
            >
              Update
            </Button>
          </div>
        ))}
      </Card>

      <Modal
        open={!!apiKeyModal}
        title={`Update ${apiKeyModal?.label}`}
        onClose={() => setApiKeyModal(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setApiKeyModal(null)}>Cancel</Button>
            <Button onClick={() => { setApiKeyModal(null); }}>Save Key</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Paste your new API key below. It will be encrypted before storage.</p>
          <Field label="API Key">
            <Input
              type="password"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder="sk-..."
              autoFocus
            />
          </Field>
          {/* TODO: POST to /api/settings/api-keys with { platform: apiKeyModal.key, key: newApiKey } */}
        </div>
      </Modal>
    </div>
  );
}

type MemberRole = "Admin" | "Editor" | "Viewer";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  avatarInitial: string;
}

interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  sentAt: string;
}

function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([
    { id: "1", name: "Alan Moore", email: "alan@reiteam.com", role: "Admin", avatarInitial: "A" },
    { id: "2", name: "Sarah Kim", email: "sarah@reiteam.com", role: "Editor", avatarInitial: "S" },
    { id: "3", name: "Marcus T.", email: "marcus@reiteam.com", role: "Viewer", avatarInitial: "M" },
  ]);

  const [invites, setInvites] = useState<PendingInvite[]>([
    { id: "inv1", email: "jordan@reiteam.com", role: "Editor", sentAt: "Mar 10, 2026" },
  ]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("Editor");
  const [removeModal, setRemoveModal] = useState<TeamMember | null>(null);

  // TODO: Supabase table: team_members (id, workspace_id, user_id FK auth.users, role text, created_at)
  // TODO: Supabase table: team_invites (id, workspace_id, email, role, token, expires_at, accepted_at)

  function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInvites((prev) => [
      ...prev,
      { id: Date.now().toString(), email: inviteEmail, role: inviteRole, sentAt: "Just now" },
    ]);
    setInviteEmail("");
    // TODO: POST /api/team/invite { email, role }
  }

  function removeMember(id: string) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
    setRemoveModal(null);
    // TODO: DELETE /api/team/members/:id
  }

  function cancelInvite(id: string) {
    setInvites((prev) => prev.filter((i) => i.id !== id));
    // TODO: DELETE /api/team/invites/:id
  }

  return (
    <div className="space-y-4">
      <Card title="Invite Team Member">
        <div className="flex gap-3 flex-col sm:flex-row">
          <div className="flex-1">
            <Input
              type="email"
              placeholder="colleague@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendInvite()}
            />
          </div>
          <div className="w-full sm:w-36">
            <Select
              value={inviteRole}
              onChange={(v) => setInviteRole(v as MemberRole)}
              options={[
                { value: "Admin", label: "Admin" },
                { value: "Editor", label: "Editor" },
                { value: "Viewer", label: "Viewer" },
              ]}
            />
          </div>
          <Button onClick={sendInvite}>Send Invite</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Admin — full access · Editor — create & edit · Viewer — read only
        </p>
      </Card>

      <Card title="Current Members">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 py-3 border-b border-white/[0.06] last:border-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-full bg-elevated border border-white/10 flex items-center justify-center text-sm font-semibold text-slate-300 shrink-0">
                {m.avatarInitial}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200 truncate">{m.name}</div>
                <div className="text-xs text-slate-500 truncate">{m.email}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400 bg-white/[0.04] border border-white/10 px-2 py-0.5 rounded-full">
                {m.role}
              </span>
              {m.role !== "Admin" && (
                <Button
                  variant="ghost"
                  className="text-xs py-1 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
                  onClick={() => setRemoveModal(m)}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </Card>

      {invites.length > 0 && (
        <Card title="Pending Invitations">
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 py-3 border-b border-white/[0.06] last:border-0">
              <div>
                <div className="text-sm text-slate-200">{inv.email}</div>
                <div className="text-xs text-slate-500">Invited {inv.sentAt} · {inv.role}</div>
              </div>
              <Button
                variant="ghost"
                className="text-xs py-1 px-2 shrink-0"
                onClick={() => cancelInvite(inv.id)}
              >
                Cancel
              </Button>
            </div>
          ))}
        </Card>
      )}

      <Modal
        open={!!removeModal}
        title="Remove Team Member"
        onClose={() => setRemoveModal(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveModal(null)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-500"
              onClick={() => removeModal && removeMember(removeModal.id)}
            >
              Remove Member
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Are you sure you want to remove <strong className="text-slate-100">{removeModal?.name}</strong> from the team?
          They will lose access immediately.
        </p>
      </Modal>
    </div>
  );
}

function DataSection() {
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const MOCK_SESSIONS = [
    { id: "s1", device: "MacBook Pro — Chrome", location: "San Francisco, CA", lastActive: "Active now" },
    { id: "s2", device: "iPhone 15 — Safari", location: "San Francisco, CA", lastActive: "2 hours ago" },
    { id: "s3", device: "Windows — Firefox", location: "Los Angeles, CA", lastActive: "3 days ago" },
  ];

  // TODO: Supabase: use auth.sessions table via admin API for real session data

  return (
    <div className="space-y-4">
      <Card title="Export Data">
        <p className="text-sm text-slate-400 mb-4">
          Download a complete export of your data including meetings, posts, leads, and settings.
        </p>
        <Button variant="ghost" onClick={() => alert("Export requested — you'll receive an email with your data shortly.")}>
          Export My Data
        </Button>
        {/* TODO: POST /api/account/export → triggers background job, emails download link */}
      </Card>

      <Card title="Session Management">
        <p className="text-xs text-slate-500 mb-4">Active sessions on your account. Sign out sessions you don&apos;t recognise.</p>
        {MOCK_SESSIONS.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 py-3 border-b border-white/[0.06] last:border-0">
            <div>
              <div className="text-sm text-slate-200">{s.device}</div>
              <div className="text-xs text-slate-500">{s.location} · {s.lastActive}</div>
            </div>
            {s.lastActive !== "Active now" && (
              <Button variant="ghost" className="text-xs py-1 px-2 shrink-0">
                Sign out
              </Button>
            )}
            {s.lastActive === "Active now" && (
              <span className="text-xs text-emerald-400">Current</span>
            )}
          </div>
        ))}
        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <Button
            variant="ghost"
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border-red-500/20"
            onClick={() => alert("Signed out of all other sessions.")}
          >
            Sign out all other devices
          </Button>
          {/* TODO: POST /api/auth/sessions/revoke-all */}
        </div>
      </Card>

      <Card title="Delete Account">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="text-sm font-medium text-red-400 mb-1">Danger Zone</div>
          <p className="text-xs text-slate-400 mb-4">
            Permanently deletes your account and all associated data. This cannot be undone.
          </p>
          <Button
            className="bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30"
            variant="ghost"
            onClick={() => setDeleteModal(true)}
          >
            Delete My Account
          </Button>
        </div>
      </Card>

      <Modal
        open={deleteModal}
        title="Delete Account"
        onClose={() => { setDeleteModal(false); setDeleteConfirm(""); }}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setDeleteModal(false); setDeleteConfirm(""); }}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-500"
              disabled={deleteConfirm !== "DELETE"}
              onClick={() => alert("Account deletion requested.")}
            >
              Permanently Delete
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
            This will permanently delete your account, all meetings, posts, leads, and settings. There is no recovery.
          </div>
          <Field label='Type "DELETE" to confirm'>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
          </Field>
        </div>
        {/* TODO: DELETE /api/account — calls Supabase admin.deleteUser() then clears all user data */}
      </Modal>
    </div>
  );
}

function AboutSection() {
  return (
    <Card title="About">
      <div className="space-y-4 text-sm">
        <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
          <span className="text-slate-400">App</span>
          <span className="text-slate-200 font-medium">Alan&apos;s Workspace</span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
          <span className="text-slate-400">Version</span>
          <span className="font-mono text-slate-200 text-xs bg-white/[0.04] border border-white/10 px-2 py-0.5 rounded">
            0.1.0
          </span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
          <span className="text-slate-400">Framework</span>
          <span className="text-slate-200">Next.js 15 · Supabase · Tailwind CSS</span>
        </div>
        <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
          <span className="text-slate-400">Changelog</span>
          <a href="/CHANGES.md" className="text-emerald-400 hover:text-emerald-300 transition-colors">
            View CHANGES.md →
          </a>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-slate-400">Support / Feedback</span>
          <a
            href="https://github.com/MalanREI/Little-Helper-Tool-with-features/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            GitHub Issues →
          </a>
        </div>
      </div>
    </Card>
  );
}

// ─── Main settings page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [email, setEmail] = useState("");
  const [activeTab, setActiveTab] = useState<TabValue>("profile");
  const [mobileOpen, setMobileOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setEmail(data?.user?.email ?? ""));
  }, [sb]);

  const activeTabLabel = TABS.find((t) => t.value === activeTab)?.label ?? "";

  function renderSection() {
    switch (activeTab) {
      case "profile": return <ProfileSection email={email} />;
      case "appearance": return <AppearanceSection />;
      case "notifications": return <NotificationsSection />;
      case "ai": return <AISection />;
      case "integrations": return <IntegrationsSection />;
      case "team": return <TeamSection />;
      case "data": return <DataSection />;
      case "about": return <AboutSection />;
    }
  }

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your account, preferences, and workspace</p>
        </div>

        {/* Mobile: dropdown tab selector */}
        <div className="sm:hidden mb-4">
          <select
            ref={selectRef}
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as TabValue)}
            className="w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            {TABS.map((t) => (
              <option key={t.value} value={t.value} className="bg-slate-900">
                {t.icon} {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-6 items-start">
          {/* Desktop: left tab nav */}
          <nav className="hidden sm:flex flex-col w-52 shrink-0 rounded-2xl border border-white/[0.06] bg-surface p-2 gap-0.5 sticky top-20">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setActiveTab(t.value)}
                className={[
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-left transition-colors w-full",
                  activeTab === t.value
                    ? "bg-emerald-500/10 text-emerald-400 font-medium"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
                ].join(" ")}
              >
                <span className="text-base leading-none">{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {renderSection()}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
