-- ============================================================
-- Site Construction Observation Reports
-- AT-PD / Nvidia Data Center Projects
-- ============================================================

-- site_projects
create table if not exists public.site_projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  client      text not null default '',
  location    text not null default '',
  status      text not null default 'active'
                check (status in ('active', 'completed', 'on-hold')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- site_milestones (template milestones per project, reused across reports)
create table if not exists public.site_milestones (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.site_projects(id) on delete cascade,
  name           text not null,
  scheduled_date date,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

-- site_reports (one row per site visit)
create table if not exists public.site_reports (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.site_projects(id) on delete cascade,
  observation_date   date not null,
  rep_name           text not null,
  overall_status     text not null default 'on_track'
                       check (overall_status in ('on_track', 'risk', 'behind')),
  public_share_token text unique not null default encode(gen_random_bytes(16), 'hex'),
  pdf_storage_path   text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- site_report_milestones (per-report snapshot of milestone status)
create table if not exists public.site_report_milestones (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.site_reports(id) on delete cascade,
  milestone_id   uuid references public.site_milestones(id) on delete set null,
  milestone_name text not null,
  scheduled_date date,
  status         text not null default 'not_started'
                   check (status in ('on_track', 'risk', 'behind', 'completed', 'not_started')),
  completed_date date,
  comments       text,
  sort_order     integer not null default 0
);

-- site_report_items (highlights / recommendations / risks / escalations — all in one table)
create table if not exists public.site_report_items (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.site_projects(id) on delete cascade,
  report_id           uuid not null references public.site_reports(id) on delete cascade,
  type                text not null
                        check (type in ('highlight', 'recommendation', 'risk', 'escalation')),
  item_name           text not null,
  status              text not null default 'green',
  comments            text not null default '',
  recommendation_date date,
  created_at          timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.site_projects          enable row level security;
alter table public.site_milestones        enable row level security;
alter table public.site_reports           enable row level security;
alter table public.site_report_milestones enable row level security;
alter table public.site_report_items      enable row level security;

-- Drop existing policies (idempotent)
do $$
declare
  pol text;
  tbl text;
begin
  for tbl, pol in
    values
      ('site_projects',          'sr_projects_select'),
      ('site_projects',          'sr_projects_insert'),
      ('site_projects',          'sr_projects_update'),
      ('site_projects',          'sr_projects_delete'),
      ('site_milestones',        'sr_milestones_select'),
      ('site_milestones',        'sr_milestones_insert'),
      ('site_milestones',        'sr_milestones_update'),
      ('site_milestones',        'sr_milestones_delete'),
      ('site_reports',           'sr_reports_select_auth'),
      ('site_reports',           'sr_reports_select_anon'),
      ('site_reports',           'sr_reports_insert'),
      ('site_reports',           'sr_reports_update'),
      ('site_reports',           'sr_reports_delete'),
      ('site_report_milestones', 'sr_rm_select_auth'),
      ('site_report_milestones', 'sr_rm_select_anon'),
      ('site_report_milestones', 'sr_rm_insert'),
      ('site_report_milestones', 'sr_rm_update'),
      ('site_report_milestones', 'sr_rm_delete'),
      ('site_report_items',      'sr_items_select_auth'),
      ('site_report_items',      'sr_items_select_anon'),
      ('site_report_items',      'sr_items_insert'),
      ('site_report_items',      'sr_items_update'),
      ('site_report_items',      'sr_items_delete')
  loop
    execute format('drop policy if exists %I on public.%I', pol, tbl);
  end loop;
end $$;

-- ---- site_projects: authenticated CRUD ----
create policy sr_projects_select on public.site_projects
  for select to authenticated using (true);

create policy sr_projects_insert on public.site_projects
  for insert to authenticated with check (true);

create policy sr_projects_update on public.site_projects
  for update to authenticated using (true) with check (true);

create policy sr_projects_delete on public.site_projects
  for delete to authenticated using (true);

-- ---- site_milestones: authenticated CRUD ----
create policy sr_milestones_select on public.site_milestones
  for select to authenticated using (true);

create policy sr_milestones_insert on public.site_milestones
  for insert to authenticated with check (true);

create policy sr_milestones_update on public.site_milestones
  for update to authenticated using (true) with check (true);

create policy sr_milestones_delete on public.site_milestones
  for delete to authenticated using (true);

-- ---- site_reports: authenticated + public anon (any report with a token) ----
create policy sr_reports_select_auth on public.site_reports
  for select to authenticated using (true);

create policy sr_reports_select_anon on public.site_reports
  for select to anon using (public_share_token is not null);

create policy sr_reports_insert on public.site_reports
  for insert to authenticated with check (true);

create policy sr_reports_update on public.site_reports
  for update to authenticated using (true) with check (true);

create policy sr_reports_delete on public.site_reports
  for delete to authenticated using (true);

-- ---- site_report_milestones ----
create policy sr_rm_select_auth on public.site_report_milestones
  for select to authenticated using (true);

create policy sr_rm_select_anon on public.site_report_milestones
  for select to anon using (
    exists (select 1 from public.site_reports r where r.id = report_id)
  );

create policy sr_rm_insert on public.site_report_milestones
  for insert to authenticated with check (true);

create policy sr_rm_update on public.site_report_milestones
  for update to authenticated using (true) with check (true);

create policy sr_rm_delete on public.site_report_milestones
  for delete to authenticated using (true);

-- ---- site_report_items ----
create policy sr_items_select_auth on public.site_report_items
  for select to authenticated using (true);

create policy sr_items_select_anon on public.site_report_items
  for select to anon using (
    exists (select 1 from public.site_reports r where r.id = report_id)
  );

create policy sr_items_insert on public.site_report_items
  for insert to authenticated with check (true);

create policy sr_items_update on public.site_report_items
  for update to authenticated using (true) with check (true);

create policy sr_items_delete on public.site_report_items
  for delete to authenticated using (true);
