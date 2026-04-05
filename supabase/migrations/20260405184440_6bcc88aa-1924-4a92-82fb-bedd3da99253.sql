
CREATE POLICY "Users can update synonyms of their sites"
ON public.search_synonyms
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM sites
  WHERE sites.id = search_synonyms.site_id
    AND sites.user_id = auth.uid()
));

CREATE POLICY "Users can delete synonyms of their sites"
ON public.search_synonyms
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM sites
  WHERE sites.id = search_synonyms.site_id
    AND sites.user_id = auth.uid()
));
