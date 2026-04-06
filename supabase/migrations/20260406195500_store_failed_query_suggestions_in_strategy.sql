ALTER TABLE public.site_search_strategy
ADD COLUMN IF NOT EXISTS failed_query_suggestions jsonb NOT NULL DEFAULT '{}'::jsonb;
