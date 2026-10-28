ALTER TABLE public.work_relations
ADD COLUMN IF NOT EXISTS is_bidirectional boolean NOT NULL DEFAULT false;
