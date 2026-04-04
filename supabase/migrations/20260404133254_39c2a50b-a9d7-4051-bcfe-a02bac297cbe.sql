
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Sites table
CREATE TABLE public.sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  sitemap_url TEXT,
  api_key TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  page_count INTEGER NOT NULL DEFAULT 0,
  last_crawled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own sites" ON public.sites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own sites" ON public.sites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sites" ON public.sites FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sites" ON public.sites FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pages table
CREATE TABLE public.pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  content TEXT,
  embedding extensions.vector(1536),
  last_indexed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view pages of their sites" ON public.pages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = pages.site_id AND sites.user_id = auth.uid()));
CREATE POLICY "Users can insert pages for their sites" ON public.pages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = pages.site_id AND sites.user_id = auth.uid()));
CREATE POLICY "Users can update pages of their sites" ON public.pages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = pages.site_id AND sites.user_id = auth.uid()));
CREATE POLICY "Users can delete pages of their sites" ON public.pages FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = pages.site_id AND sites.user_id = auth.uid()));
CREATE TRIGGER update_pages_updated_at BEFORE UPDATE ON public.pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Crawl jobs table
CREATE TABLE public.crawl_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'done_with_errors', 'failed')),
  pages_found INTEGER NOT NULL DEFAULT 0,
  pages_indexed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crawl_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view crawl jobs of their sites" ON public.crawl_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = crawl_jobs.site_id AND sites.user_id = auth.uid()));
CREATE POLICY "Users can create crawl jobs for their sites" ON public.crawl_jobs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = crawl_jobs.site_id AND sites.user_id = auth.uid()));
CREATE TRIGGER update_crawl_jobs_updated_at BEFORE UPDATE ON public.crawl_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Search logs table
CREATE TABLE public.search_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  results_count INTEGER NOT NULL DEFAULT 0,
  clicked BOOLEAN NOT NULL DEFAULT false,
  language TEXT,
  response_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view search logs of their sites" ON public.search_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = search_logs.site_id AND sites.user_id = auth.uid()));
CREATE POLICY "Anyone can insert search logs" ON public.search_logs FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_pages_site_id ON public.pages (site_id);
CREATE INDEX idx_search_logs_site_id ON public.search_logs (site_id);
CREATE INDEX idx_search_logs_created_at ON public.search_logs (created_at);
CREATE INDEX idx_crawl_jobs_site_id ON public.crawl_jobs (site_id);
