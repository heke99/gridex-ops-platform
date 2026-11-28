-- Register the existing billing-underlay write authority used by Staff and E66.
-- Preserve any existing catalogue row, including explicitly disabled keys.
INSERT INTO public.permissions (key, name, description, category, is_active)
VALUES ('billing_underlay.write', 'Ändra faktureringsunderlag',
  'Kan skapa, ändra och ompröva faktureringsunderlag.', 'Fakturering', true)
ON CONFLICT (key) DO NOTHING;
