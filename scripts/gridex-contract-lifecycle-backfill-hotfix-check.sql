-- Run after 20260721130000_contract_lifecycle_pgcrypto_search_path_hotfix.sql.

select
  p.oid::regprocedure::text as function_signature,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in (
    'gridex_sync_internal_offer_to_canonical',
    'gridex_publish_contract_channel',
    'gridex_backfill_contract_lifecycle'
  )
order by p.proname;

select public.gridex_backfill_contract_lifecycle(null) as backfill_result;
select public.gridex_verify_contract_lifecycle_backfill(null) as verification_result;

select
  issue_code,
  count(*) as issue_count,
  jsonb_agg(
    jsonb_build_object(
      'company_id',company_id,
      'contract_offer_id',contract_offer_id,
      'public_contract_offer_id',public_contract_offer_id,
      'detail',issue_detail
    ) order by contract_offer_id,public_contract_offer_id
  ) as issues
from public.contract_lifecycle_backfill_issues
where status='open'
group by issue_code
order by issue_code;
