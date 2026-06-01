
ALTER TABLE public.item_tags ADD COLUMN IF NOT EXISTS notified_at timestamptz;
CREATE INDEX IF NOT EXISTS item_tags_pending_notify_idx
  ON public.item_tags (tagged_user_id)
  WHERE tagged_user_id IS NOT NULL AND notified_at IS NULL;
