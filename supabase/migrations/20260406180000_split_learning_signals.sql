ALTER TABLE public.search_synonyms
ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';

UPDATE public.search_synonyms
SET source = COALESCE(source, 'manual'),
    status = COALESCE(status, 'approved');

ALTER TABLE public.search_synonyms
DROP CONSTRAINT IF EXISTS search_synonyms_status_check;

ALTER TABLE public.search_synonyms
ADD CONSTRAINT search_synonyms_status_check
CHECK (status IN ('proposed', 'approved', 'rejected'));

CREATE TABLE IF NOT EXISTS public.query_page_affinities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  query text NOT NULL,
  page_url text NOT NULL,
  confidence real NOT NULL DEFAULT 0.3,
  click_count integer NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'clicks',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_observed_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(site_id, query, page_url)
);

CREATE INDEX IF NOT EXISTS idx_query_page_affinities_site_id
ON public.query_page_affinities(site_id);

CREATE INDEX IF NOT EXISTS idx_query_page_affinities_query
ON public.query_page_affinities(site_id, query);

CREATE INDEX IF NOT EXISTS idx_query_page_affinities_confidence
ON public.query_page_affinities(site_id, confidence DESC, click_count DESC);

ALTER TABLE public.query_page_affinities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view query page affinities of their sites"
ON public.query_page_affinities FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.sites
    WHERE sites.id = query_page_affinities.site_id
      AND sites.user_id = auth.uid()
  )
);

CREATE POLICY "Service role manages query page affinities"
ON public.query_page_affinities FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_query_page_affinities_updated_at
BEFORE UPDATE ON public.query_page_affinities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
