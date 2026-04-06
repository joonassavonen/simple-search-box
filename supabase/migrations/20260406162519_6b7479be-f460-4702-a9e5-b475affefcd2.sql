ALTER TABLE public.site_contact_configs
ADD COLUMN IF NOT EXISTS cta_text_fi TEXT NOT NULL DEFAULT 'Etkö löytänyt etsimääsi? Ota yhteyttä!',
ADD COLUMN IF NOT EXISTS cta_text_en TEXT NOT NULL DEFAULT 'Didn''t find what you need? Contact us!';