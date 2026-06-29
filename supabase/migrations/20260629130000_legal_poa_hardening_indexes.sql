-- Legal + power-of-attorney pipeline hardening: query-matched indexes only.
-- Forward-only, idempotent, tenant-safe. No destructive operations.
--
-- Most hot-path indexes already exist (powers_of_attorney company/customer/
-- status/scope, customer_documents, domain_events, website_customer_applications
-- status/error_stage, legal_text_versions company/type/status). This migration
-- only adds the small set that matches access patterns introduced or reinforced
-- by this change and is not already covered.

-- 1) Customer legal acceptances: tenant card and portal frequently read all
--    acceptances for a customer, by legal type, newest first. Existing indexes
--    cover (customer_id) and (acceptance_type) separately; this composite makes
--    the per-customer, per-type, newest-first read index-only.
do $$
begin
  if to_regclass('public.customer_legal_acceptances') is not null then
    create index if not exists customer_legal_acceptances_company_customer_type_idx
      on public.customer_legal_acceptances (company_id, customer_id, acceptance_type, accepted_at desc);
  end if;
end $$;

-- 2) Public legal document lookup: /legal/{slug}/{type}/{versionId} resolves the
--    tenant by slug, then a single published version by (company_id, id, type,
--    status). The id is the primary key, so the lookup is already index-backed;
--    this partial index speeds tenant-wide "published versions by type" reads
--    used by the legal bundle and readiness overview.
do $$
begin
  if to_regclass('public.legal_text_versions') is not null then
    create index if not exists legal_text_versions_company_type_published_idx
      on public.legal_text_versions (company_id, type, published_at desc)
      where status = 'published';
  end if;
end $$;
