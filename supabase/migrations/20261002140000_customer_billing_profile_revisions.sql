-- Tenantservice P3: versioned customer billing profile.
--
-- The billing profile (invoice e-mail and billing address on customers) is written from several
-- paths (OPS, customer API, partner API, imports, website applications). Versioning therefore
-- lives in the database: any change to a billing field bumps customers.billing_profile_revision
-- and appends an immutable row to customer_billing_profile_revisions, whatever the writer.
-- Every billing export/review item records the revision current when it was created, so an
-- invoice always shows which profile version it used; the recorded revision cannot be changed.
-- Forward-only. Existing customers get revision 1 with their current values.
BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS billing_profile_revision integer NOT NULL DEFAULT 0;

CREATE TABLE public.customer_billing_profile_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  invoice_email text,
  billing_street text,
  billing_postal_code text,
  billing_city text,
  billing_country text,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_billing_profile_revisions_company_customer_fkey FOREIGN KEY (company_id, customer_id)
    REFERENCES public.customers(company_id, id) ON DELETE CASCADE,
  CONSTRAINT customer_billing_profile_revisions_revision_key UNIQUE (company_id, customer_id, revision)
);

COMMENT ON TABLE public.customer_billing_profile_revisions IS
  'P3: immutable history of the customer billing profile (invoice e-mail and billing address). One row per change, written by trigger.';

CREATE FUNCTION public.gridex_billing_profile_revisions_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  -- Rows disappear only together with their customer (ON DELETE CASCADE runs as a nested trigger);
  -- a direct UPDATE or DELETE is refused.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'customer_billing_profile_revisions_append_only' USING ERRCODE = '42501';
END $$;

CREATE TRIGGER customer_billing_profile_revisions_no_update
  BEFORE UPDATE OR DELETE ON public.customer_billing_profile_revisions
  FOR EACH ROW EXECUTE FUNCTION public.gridex_billing_profile_revisions_append_only();

-- BEFORE: bump the revision when any billing field changes (or on insert).
CREATE FUNCTION public.gridex_customer_billing_profile_bump()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.billing_profile_revision := 1;
  ELSIF NEW.invoice_email IS DISTINCT FROM OLD.invoice_email
     OR NEW.billing_street IS DISTINCT FROM OLD.billing_street
     OR NEW.billing_postal_code IS DISTINCT FROM OLD.billing_postal_code
     OR NEW.billing_city IS DISTINCT FROM OLD.billing_city
     OR NEW.billing_country IS DISTINCT FROM OLD.billing_country THEN
    NEW.billing_profile_revision := OLD.billing_profile_revision + 1;
  ELSE
    -- The revision is owned by this trigger; writers cannot move it.
    NEW.billing_profile_revision := OLD.billing_profile_revision;
  END IF;
  RETURN NEW;
END $$;

-- AFTER: record the new revision.
CREATE FUNCTION public.gridex_customer_billing_profile_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_changed text[] := '{}'::text[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.billing_profile_revision = OLD.billing_profile_revision THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_changed := ARRAY['created'];
  ELSE
    IF NEW.invoice_email IS DISTINCT FROM OLD.invoice_email THEN v_changed := array_append(v_changed, 'invoice_email'); END IF;
    IF NEW.billing_street IS DISTINCT FROM OLD.billing_street THEN v_changed := array_append(v_changed, 'billing_street'); END IF;
    IF NEW.billing_postal_code IS DISTINCT FROM OLD.billing_postal_code THEN v_changed := array_append(v_changed, 'billing_postal_code'); END IF;
    IF NEW.billing_city IS DISTINCT FROM OLD.billing_city THEN v_changed := array_append(v_changed, 'billing_city'); END IF;
    IF NEW.billing_country IS DISTINCT FROM OLD.billing_country THEN v_changed := array_append(v_changed, 'billing_country'); END IF;
  END IF;
  INSERT INTO public.customer_billing_profile_revisions
    (company_id, customer_id, revision, invoice_email, billing_street, billing_postal_code, billing_city, billing_country, changed_fields)
  VALUES
    (NEW.company_id, NEW.id, NEW.billing_profile_revision, NEW.invoice_email, NEW.billing_street, NEW.billing_postal_code,
     NEW.billing_city, NEW.billing_country, v_changed);
  RETURN NULL;
END $$;

-- Backfill before the triggers exist: revision 1 with the current values for every existing customer.
UPDATE public.customers SET billing_profile_revision = 1 WHERE billing_profile_revision = 0;
INSERT INTO public.customer_billing_profile_revisions
  (company_id, customer_id, revision, invoice_email, billing_street, billing_postal_code, billing_city, billing_country, changed_fields)
SELECT company_id, id, 1, invoice_email, billing_street, billing_postal_code, billing_city, billing_country, ARRAY['backfill']
  FROM public.customers
 WHERE company_id IS NOT NULL
ON CONFLICT (company_id, customer_id, revision) DO NOTHING;

CREATE TRIGGER customers_billing_profile_bump
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.gridex_customer_billing_profile_bump();
CREATE TRIGGER customers_billing_profile_record
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW WHEN (NEW.company_id IS NOT NULL)
  EXECUTE FUNCTION public.gridex_customer_billing_profile_record();

-- Every billing item records the profile revision current when it was created; it never changes.
ALTER TABLE public.billing_export_run_items
  ADD COLUMN IF NOT EXISTS customer_billing_profile_revision integer;

CREATE FUNCTION public.gridex_billing_item_lock_profile_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id IS NOT NULL THEN
      SELECT c.billing_profile_revision INTO NEW.customer_billing_profile_revision
        FROM public.customers c
       WHERE c.id = NEW.customer_id AND c.company_id = NEW.company_id;
    END IF;
  ELSIF NEW.customer_billing_profile_revision IS DISTINCT FROM OLD.customer_billing_profile_revision THEN
    RAISE EXCEPTION 'billing_item_profile_revision_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER billing_export_run_items_lock_profile_revision
  BEFORE INSERT OR UPDATE ON public.billing_export_run_items
  FOR EACH ROW EXECUTE FUNCTION public.gridex_billing_item_lock_profile_revision();

CREATE INDEX customer_billing_profile_revisions_customer_idx
  ON public.customer_billing_profile_revisions (company_id, customer_id, revision DESC);

ALTER TABLE public.customer_billing_profile_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_billing_profile_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.customer_billing_profile_revisions TO service_role;
REVOKE ALL ON FUNCTION public.gridex_billing_profile_revisions_append_only() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_customer_billing_profile_bump() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_customer_billing_profile_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gridex_billing_item_lock_profile_revision() FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_table_classification(table_name, kind, rationale, null_company_meaning, classified_by)
VALUES ('customer_billing_profile_revisions', 'tenant',
  'P3: immutable revisions of the customer billing profile, written by trigger. Service-role read only, RLS enabled.',
  NULL, 'migration:customer_billing_profile_revisions')
ON CONFLICT (table_name) DO UPDATE SET
  kind = EXCLUDED.kind, rationale = EXCLUDED.rationale, null_company_meaning = EXCLUDED.null_company_meaning,
  classified_by = EXCLUDED.classified_by, classified_at = now();

COMMIT;
