-- Environment-specific migration history repair.
-- Run only after the object checks below pass. This does not re-execute the
-- historical migrations; it records already-present, verified schema changes.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='customer_contracts'
      and column_name='invoice_fee_sek'
  ) or not exists (
    select 1 from pg_constraint
    where conname='customer_contracts_invoice_fee_nonnegative'
  ) or to_regprocedure('public.gridex_apply_contract_offer_standard_fees()') is null
  then raise exception 'history_repair_preflight_failed:20260804003000'; end if;

  if to_regprocedure('public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)') is null
     or not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='gridex_finalize_contract_publication_v1'
     )
  then raise exception 'history_repair_preflight_failed:20260804093500'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='companies'
      and column_name='customer_portal_url'
  ) or not exists (
    select 1 from pg_constraint where conname='companies_customer_portal_url_https_check'
  ) or to_regprocedure('public.gridex_project_terminal_application_continuation()') is null
  then raise exception 'history_repair_preflight_failed:20260804121000'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='website_customer_applications'
      and column_name='portal_identity_required'
  ) or to_regprocedure('public.gridex_validate_website_application_portal_identity()') is null
     or not exists (
       select 1 from pg_trigger
       where tgname='gridex_validate_website_application_portal_identity'
         and not tgisinternal
     )
  then raise exception 'history_repair_preflight_failed:20260804151500'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='customer_site_resolution'
      and column_name='price_area_assurance_status'
  ) or not exists (
    select 1 from pg_constraint
    where conname='customer_site_resolution_price_area_assurance_consistency_check'
  ) or to_regclass('public.customer_site_resolution_price_assurance_idx') is null
  then raise exception 'history_repair_preflight_failed:20260804173000'; end if;
end $$;

insert into supabase_migrations.schema_migrations(
  version, statements, name, created_by
)
select repair.version,
       array['-- verified live schema; migration history repaired without re-execution'],
       repair.name,
       'verified_history_repair_2026-08-05'
from (values
  ('20260804003000','customer_contract_fee_consistency'),
  ('20260804093500','contract_publication_two_step_invoice_fee_repair'),
  ('20260804121000','multitenant_website_application_flow_completion'),
  ('20260804151500','website_application_pre_auth_contract_alignment'),
  ('20260804173000','price_area_assurance_and_pricing_readiness')
) as repair(version,name)
where not exists (
  select 1 from supabase_migrations.schema_migrations existing
  where existing.version=repair.version
);

commit;
