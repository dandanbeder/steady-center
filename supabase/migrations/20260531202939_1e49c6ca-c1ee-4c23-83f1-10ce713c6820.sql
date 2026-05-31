-- Meetings table
CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  business_id uuid,
  event_id uuid,
  platform text NOT NULL DEFAULT 'other',
  title text NOT NULL DEFAULT 'Untitled meeting',
  transcript text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  audio_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meetings TO authenticated;
GRANT ALL ON public.meetings TO service_role;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner select meetings" ON public.meetings FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert meetings" ON public.meetings FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update meetings" ON public.meetings FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete meetings" ON public.meetings FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Action items table
CREATE TABLE public.action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  business_id uuid,
  source_type text NOT NULL DEFAULT 'meeting',
  source_id uuid,
  text text NOT NULL,
  owner_label text,
  due_at timestamptz,
  task_id uuid,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_items TO authenticated;
GRANT ALL ON public.action_items TO service_role;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner select action_items" ON public.action_items FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner insert action_items" ON public.action_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owner update action_items" ON public.action_items FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Owner delete action_items" ON public.action_items FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- Storage bucket for meeting audio (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('meeting-audio', 'meeting-audio', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Owner read meeting audio" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'meeting-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner upload meeting audio" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'meeting-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner delete meeting audio" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'meeting-audio' AND auth.uid()::text = (storage.foldername(name))[1]);
