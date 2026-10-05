-- DB-02: database prevention for the existing tenant Ediel profile intervals.
-- Keep retained rows intact. Ambiguous legacy data must be reconciled by its
-- source owner before this migration can install the write invariant.
BEGIN;

LOCK TABLE public.tenant_ediel_profiles IN ACCESS EXCLUSIVE MODE;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT FROM public.tenant_ediel_profiles
    WHERE valid_to < valid_from
  ) THEN
    RAISE EXCEPTION 'tenant_ediel_profile_existing_reversed_interval'
      USING ERRCODE = '23514',
        HINT = 'Reconcile retained profile intervals through their source owner; no automatic rewrite.';
  END IF;

  IF EXISTS (
    SELECT FROM public.tenant_ediel_profiles a
    JOIN public.tenant_ediel_profiles b
      ON a.company_id = b.company_id
      AND a.environment = b.environment
      AND a.market = b.market
      AND a.id < b.id
    WHERE a.is_enabled AND b.is_enabled
      AND tstzrange(a.valid_from, a.valid_to, '[)')
        && tstzrange(b.valid_from, b.valid_to, '[)')
  ) THEN
    RAISE EXCEPTION 'tenant_ediel_profile_existing_enabled_overlap'
      USING ERRCODE = '23514',
        HINT = 'Reconcile retained profile intervals through their source owner; no automatic rewrite.';
  END IF;
END
$preflight$;

-- GiST equality for the existing UUID/text scope keys, combined with the
-- built-in timestamp-with-time-zone range overlap operator. The exclusion
-- constraint handles competing transactions as well as ordinary writes.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
SET LOCAL search_path = pg_catalog, public, extensions;

ALTER TABLE public.tenant_ediel_profiles
  ADD CONSTRAINT tenant_ediel_profiles_validity_order
  CHECK (valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE public.tenant_ediel_profiles
  ADD CONSTRAINT tenant_ediel_profiles_enabled_period_excl
  EXCLUDE USING gist (
    company_id WITH =,
    environment WITH =,
    market WITH =,
    tstzrange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (is_enabled);

COMMIT;
