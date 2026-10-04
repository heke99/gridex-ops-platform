-- masterplan: DB-01 (PR 1 - Expand). Owner decision 2026-10-04, option (a):
-- platform routes live in public.communication_routes with company_id IS NULL
-- and route_scope='platform_actor'. This migration only ADDS nullable columns,
-- one optional route_scope value and a partial link index. No backfill, no
-- reader/writer switch and no change to existing rows or RLS semantics.
--
-- company_id is already nullable. Existing policies already hide NULL-company
-- rows from tenant roles: the permissive policies require
-- platform_admin OR (company_id IS NOT NULL AND gridex_can_*_company(company_id))
-- and the RESTRICTIVE tenant_lifecycle_*_guard policies require
-- company_id IN (gridex_user_company_ids()) / gridex_can_*_company(company_id),
-- which is never true for NULL. Only platform admins and service_role see them.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';

ALTER TABLE public.communication_routes
  ADD COLUMN IF NOT EXISTS market_actor_id uuid,
  ADD COLUMN IF NOT EXISTS ediel_party_id uuid,
  ADD COLUMN IF NOT EXISTS message_type text,
  ADD COLUMN IF NOT EXISTS business_code text,
  ADD COLUMN IF NOT EXISTS subaddress text,
  ADD COLUMN IF NOT EXISTS requires_subaddress boolean,
  ADD COLUMN IF NOT EXISTS qualifier text,
  ADD COLUMN IF NOT EXISTS interchange_party_id text,
  ADD COLUMN IF NOT EXISTS transport_security_mode text,
  ADD COLUMN IF NOT EXISTS receiver_certificate_id uuid,
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_to timestamptz,
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_row_id uuid;
-- metadata jsonb already exists on communication_routes.

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_market_actor_id_fkey' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_market_actor_id_fkey
      FOREIGN KEY (market_actor_id) REFERENCES public.platform_market_actors(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_ediel_party_id_fkey' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_ediel_party_id_fkey
      FOREIGN KEY (ediel_party_id) REFERENCES public.ediel_parties(id) ON DELETE SET NULL NOT VALID;
  END IF;
  -- Same target/semantics as ediel_party_addresses.receiver_certificate_id.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_receiver_certificate_id_fkey' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_receiver_certificate_id_fkey
      FOREIGN KEY (receiver_certificate_id) REFERENCES public.ediel_certificates(id) ON DELETE SET NULL NOT VALID;
  END IF;
  -- Same value set as ediel_party_addresses_security_chk.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_transport_security_mode_chk' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_transport_security_mode_chk
      CHECK (transport_security_mode IS NULL OR transport_security_mode = ANY (ARRAY['required_encrypted','encrypted','unencrypted','needs_verification'])) NOT VALID;
  END IF;
  -- Union of platform_actor_routes.status and ediel_party_addresses.status.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_verification_status_chk' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_verification_status_chk
      CHECK (verification_status IS NULL OR verification_status = ANY (ARRAY['active','inactive','needs_review','blocked','expired','needs_verification'])) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_source_table_chk' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_source_table_chk
      CHECK (source_table IS NULL OR source_table = ANY (ARRAY['platform_actor_routes','ediel_party_addresses'])) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='communication_routes_validity_window_chk' AND conrelid='public.communication_routes'::regclass) THEN
    ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_validity_window_chk
      CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to > valid_from) NOT VALID;
  END IF;
END;
$c$;

-- Superset of the previous value list: adds 'platform_actor' only.
ALTER TABLE public.communication_routes DROP CONSTRAINT IF EXISTS communication_routes_route_scope_check;
ALTER TABLE public.communication_routes ADD CONSTRAINT communication_routes_route_scope_check
  CHECK (route_scope = ANY (ARRAY['supplier_switch','customer_masterdata','meter_values','metering_values','billing_underlay','metering_access','ediel_ack','platform_actor'])) NOT VALID;
ALTER TABLE public.communication_routes VALIDATE CONSTRAINT communication_routes_route_scope_check;

CREATE UNIQUE INDEX IF NOT EXISTS communication_routes_source_link_uidx
  ON public.communication_routes (source_table, source_row_id)
  WHERE source_row_id IS NOT NULL;

COMMENT ON COLUMN public.communication_routes.source_table IS 'DB-01: legacy table this route was expanded from (platform_actor_routes | ediel_party_addresses).';
COMMENT ON COLUMN public.communication_routes.source_row_id IS 'DB-01: id of the legacy row; unique per source_table.';
COMMIT;
