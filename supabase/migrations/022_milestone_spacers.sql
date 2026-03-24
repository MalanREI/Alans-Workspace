-- 022_milestone_spacers.sql
-- Add is_spacer flag to milestone tables for visual grouping separators

alter table public.site_milestones
  add column if not exists is_spacer boolean not null default false;

alter table public.site_report_milestones
  add column if not exists is_spacer boolean not null default false;
