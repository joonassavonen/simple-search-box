-- Site search strategy table: background optimization agent writes strategy here,
-- search edge function reads it to dynamically build prompts and CTA decisions.
CREATE TABLE public.site_search_strategy (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,

  -- AI-generated prompt additions (injected into search system prompt)
  prompt_additions text,

  -- Contact CTA trigger rules (JSON): when to show contact buttons
  -- e.g. {"show_on_zero_results": true, "show_on_low_ctr_queries": true,
  --        "low_ctr_threshold": 0.1, "trigger_categories": ["pricing","support"]}
  contact_trigger_rules jsonb NOT NULL DEFAULT '{"show_on_zero_results": true}',

  -- High-CTR patterns the agent discovered (JSON array)
  -- e.g. [{"pattern":"ilmalämpöpumppu","top_url":"/products/ilp","ctr":0.72}]
  high_ctr_patterns jsonb NOT NULL DEFAULT '[]',

  -- Conversion insights from GA data
  conversion_insights text,

  -- Agent run metadata
  last_optimized_at timestamp with time zone,
  optimization_log text,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  UNIQUE(site_id)
);

ALTER TABLE public.site_search_strategy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view strategy of their sites"
  ON public.site_search_strategy FOR SELECT
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_search_strategy.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Service role manages strategy"
  ON public.site_search_strategy FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_site_search_strategy_updated_at
  BEFORE UPDATE ON public.site_search_strategy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Site contact configs table: stores contact CTA settings per site (replaces localStorage)
CREATE TABLE public.site_contact_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  email text,
  phone text,
  chat_url text,
  cta_text_fi text NOT NULL DEFAULT 'Etkö löytänyt etsimääsi? Ota yhteyttä!',
  cta_text_en text NOT NULL DEFAULT 'Didn''t find what you need? Contact us!',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  UNIQUE(site_id)
);

ALTER TABLE public.site_contact_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contact config of their sites"
  ON public.site_contact_configs FOR SELECT
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can insert contact config for their sites"
  ON public.site_contact_configs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Users can update contact config of their sites"
  ON public.site_contact_configs FOR UPDATE
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.user_id = auth.uid()));

CREATE POLICY "Service role manages contact configs"
  ON public.site_contact_configs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Widget needs to read contact config for active sites
CREATE POLICY "Anon can read contact config for active sites"
  ON public.site_contact_configs FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM sites WHERE sites.id = site_contact_configs.site_id AND sites.is_active = true));

CREATE TRIGGER update_site_contact_configs_updated_at
  BEFORE UPDATE ON public.site_contact_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
