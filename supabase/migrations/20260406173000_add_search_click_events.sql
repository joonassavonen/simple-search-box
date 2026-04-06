CREATE TABLE public.search_click_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  search_log_id UUID REFERENCES public.search_logs(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  page_url TEXT NOT NULL,
  click_id TEXT,
  session_id TEXT,
  click_position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_search_click_events_site_id ON public.search_click_events(site_id);
CREATE INDEX idx_search_click_events_search_log_id ON public.search_click_events(search_log_id);
CREATE INDEX idx_search_click_events_click_id ON public.search_click_events(click_id);
CREATE INDEX idx_search_click_events_created_at ON public.search_click_events(created_at);

ALTER TABLE public.search_click_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view search click events of their sites"
ON public.search_click_events FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.sites
    WHERE sites.id = search_click_events.site_id
      AND sites.user_id = auth.uid()
  )
);

CREATE POLICY "Anyone can insert search click events for active sites"
ON public.search_click_events FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sites
    WHERE sites.id = search_click_events.site_id
      AND sites.is_active = true
  )
);
