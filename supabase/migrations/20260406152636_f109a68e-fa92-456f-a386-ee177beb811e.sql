
-- Table for optimization strategy (one per site)
CREATE TABLE public.site_search_strategy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  prompt_additions TEXT DEFAULT '',
  contact_trigger_rules JSONB DEFAULT '{}',
  high_ctr_patterns JSONB DEFAULT '[]',
  conversion_insights TEXT DEFAULT '',
  last_optimized_at TIMESTAMP WITH TIME ZONE,
  optimization_log TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(site_id)
);

ALTER TABLE public.site_search_strategy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view strategy of their sites"
  ON public.site_search_strategy FOR SELECT
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_search_strategy.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Service role manages strategy"
  ON public.site_search_strategy FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Table for contact configuration (one per site)
CREATE TABLE public.site_contact_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  email TEXT,
  phone TEXT,
  chat_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(site_id)
);

ALTER TABLE public.site_contact_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage contact config of their sites"
  ON public.site_contact_configs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Service role manages contact configs"
  ON public.site_contact_configs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Anon can read contact config for active sites"
  ON public.site_contact_configs FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.is_active = true));
