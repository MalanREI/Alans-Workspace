-- 021_milestone_date.sql
-- Add milestone_date (original target date) to milestone template and report milestone tables

alter table public.site_milestones
  add column if not exists milestone_date date;

alter table public.site_report_milestones
  add column if not exists milestone_date date;
