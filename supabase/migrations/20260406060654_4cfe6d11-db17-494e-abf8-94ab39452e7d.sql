CREATE POLICY "Anon can read brand styles for active sites"
ON public.sites
FOR SELECT
TO anon
USING (is_active = true);