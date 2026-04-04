
DROP POLICY "Anyone can insert search logs" ON public.search_logs;
CREATE POLICY "Anyone can insert search logs for active sites" ON public.search_logs FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.sites WHERE sites.id = search_logs.site_id AND sites.is_active = true));
