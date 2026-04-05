
ALTER TABLE public.sites
  ADD COLUMN brand_color text DEFAULT NULL,
  ADD COLUMN brand_font text DEFAULT NULL,
  ADD COLUMN brand_bg_color text DEFAULT NULL;
