
CREATE TABLE public.page_analytics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  page_path text NOT NULL,
  pageviews integer NOT NULL DEFAULT 0,
  sessions integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  conversion_rate real NOT NULL DEFAULT 0,
  bounce_rate real NOT NULL DEFAULT 0,
  avg_time_on_page real NOT NULL DEFAULT 0,
  period_start date NOT NULL,
  period_end date NOT NULL,
  fetched_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(site_id, page_path, period_start, period_end)
);

ALTER TABLE public.page_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view analytics of their sites"
  ON public.page_analytics FOR SELECT
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = page_analytics.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can insert analytics for their sites"
  ON public.page_analytics FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = page_analytics.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can update analytics of their sites"
  ON public.page_analytics FOR UPDATE
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = page_analytics.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can delete analytics of their sites"
  ON public.page_analytics FOR DELETE
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = page_analytics.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Service role manages page_analytics"
  ON public.page_analytics FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_page_analytics_site_path ON public.page_analytics(site_id, page_path);
CREATE INDEX idx_page_analytics_conversions ON public.page_analytics(site_id, conversions DESC);

CREATE TRIGGER update_page_analytics_updated_at
  BEFORE UPDATE ON public.page_analytics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add ga_property_id to sites table for GA integration config
ALTER TABLE public.sites ADD COLUMN ga_property_id text;
