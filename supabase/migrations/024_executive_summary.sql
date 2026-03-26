-- Add executive summary column to meeting minutes sessions
ALTER TABLE public.meeting_minutes_sessions ADD COLUMN IF NOT EXISTS executive_summary text;
