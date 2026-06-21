
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS businesses_sort_order_idx ON public.businesses(owner_id, sort_order);

-- Backfill sort_order based on created_at for existing rows
WITH ordered AS (
  SELECT id, row_number() OVER (PARTITION BY owner_id ORDER BY created_at) AS rn
  FROM public.businesses
)
UPDATE public.businesses b SET sort_order = o.rn
FROM ordered o WHERE b.id = o.id AND b.sort_order = 0;
