-- Meeting AI settings table
-- meeting_id IS NULL = global defaults; specific meeting_id = per-meeting overrides
CREATE TABLE IF NOT EXISTS public.meeting_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique index for per-meeting settings
CREATE UNIQUE INDEX IF NOT EXISTS meeting_ai_settings_meeting_uniq
  ON public.meeting_ai_settings (meeting_id, setting_key)
  WHERE meeting_id IS NOT NULL;

-- Unique index for global settings (meeting_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS meeting_ai_settings_global_uniq
  ON public.meeting_ai_settings (setting_key)
  WHERE meeting_id IS NULL;

ALTER TABLE public.meeting_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_select ON public.meeting_ai_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY ai_settings_insert ON public.meeting_ai_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ai_settings_update ON public.meeting_ai_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY ai_settings_delete ON public.meeting_ai_settings FOR DELETE TO authenticated USING (true);
