
-- Synonyms table for learned query associations
CREATE TABLE public.search_synonyms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL,
  query_from text NOT NULL,
  query_to text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  times_used integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(site_id, query_from, query_to)
);

ALTER TABLE public.search_synonyms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read synonyms for active sites"
ON public.search_synonyms FOR SELECT
USING (EXISTS (
  SELECT 1 FROM sites WHERE sites.id = search_synonyms.site_id AND sites.is_active = true
));

CREATE POLICY "Service role manages synonyms"
ON public.search_synonyms FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Click tracking table
CREATE TABLE public.search_clicks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL,
  query text NOT NULL,
  page_url text NOT NULL,
  click_count integer NOT NULL DEFAULT 1,
  last_clicked_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_search_clicks_unique ON public.search_clicks (site_id, query, page_url);

ALTER TABLE public.search_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read clicks"
ON public.search_clicks FOR SELECT
USING (true);

CREATE POLICY "Anyone can insert clicks for active sites"
ON public.search_clicks FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM sites WHERE sites.id = search_clicks.site_id AND sites.is_active = true
));

CREATE POLICY "Service role manages clicks"
ON public.search_clicks FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow updating search_logs.clicked
CREATE POLICY "Anyone can update clicked status on search logs"
ON public.search_logs FOR UPDATE
USING (true)
WITH CHECK (true);
