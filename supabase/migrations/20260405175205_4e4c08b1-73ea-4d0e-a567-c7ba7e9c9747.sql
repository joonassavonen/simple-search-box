-- Allow widget (anon) to read search_logs for active sites (trending/suggestions)
CREATE POLICY "Anon can read search logs for active sites"
ON public.search_logs
FOR SELECT
TO anon
USING (EXISTS (
  SELECT 1 FROM sites
  WHERE sites.id = search_logs.site_id AND sites.is_active = true
));

-- Allow widget (anon) to read pages for active sites (popular products)
CREATE POLICY "Anon can read pages for active sites"
ON public.pages
FOR SELECT
TO anon
USING (EXISTS (
  SELECT 1 FROM sites
  WHERE sites.id = pages.site_id AND sites.is_active = true
));