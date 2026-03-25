CREATE TABLE IF NOT EXISTS public.meeting_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  parent_type text NOT NULL CHECK (parent_type IN ('task', 'milestone', 'note')),
  parent_id uuid NOT NULL,
  file_name text NOT NULL,
  file_size integer,
  file_type text,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meeting_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_attachments_select ON public.meeting_attachments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY meeting_attachments_insert ON public.meeting_attachments
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY meeting_attachments_delete ON public.meeting_attachments
  FOR DELETE TO authenticated USING (true);
