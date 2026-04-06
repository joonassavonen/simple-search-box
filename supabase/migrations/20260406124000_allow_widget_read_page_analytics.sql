-- Allow widget (anon) to read page analytics for active sites (GA trending)
CREATE POLICY "Anon can read page analytics for active sites"
ON public.page_analytics
FOR SELECT
TO anon
USING (EXISTS (
  SELECT 1 FROM sites
  WHERE sites.id = page_analytics.site_id AND sites.is_active = true
));
