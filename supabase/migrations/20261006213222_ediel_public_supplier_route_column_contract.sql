-- Restore source-defined columns required by the current public supplier writer
-- and catalog-qualified operational route materializer on canonical clean replay.
-- Historical Batch 1 / Batch 7A and environment-lock migrations remain immutable.
BEGIN;

ALTER TABLE public.electricity_suppliers
  ADD COLUMN IF NOT EXISTS customer_service_email text,
  ADD COLUMN IF NOT EXISTS switching_email text,
  ADD COLUMN IF NOT EXISTS contract_email text,
  ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE public.communication_routes
  ADD COLUMN IF NOT EXISTS route_group text,
  ADD COLUMN IF NOT EXISTS supported_message_families jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supported_message_codes jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.ediel_route_profiles
  ADD COLUMN IF NOT EXISTS environment_type public.ediel_environment_type;

COMMIT;
