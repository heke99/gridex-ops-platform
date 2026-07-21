-- Run after 20260721131500_contract_lifecycle_valid_to_qualification_hotfix.sql.

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
    ) order by company_id,contract_offer_id,public_contract_offer_id
  ) as issues
from public.contract_lifecycle_backfill_issues
where status='open'
group by issue_code
order by issue_code;

-- These checks must all be true.
select
  position(
    'coalesce(ch.valid_to,now())'
    in pg_get_functiondef('public.gridex_sync_internal_offer_to_canonical(uuid)'::regprocedure)
  )>0 as canonical_sync_valid_to_is_qualified,
  position(
    'coalesce(old_channel.valid_to,now())'
    in pg_get_functiondef('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure)
  )>0 as publish_channel_valid_to_is_qualified,
  position(
    'coalesce(old_publication_version.valid_to,now())'
    in pg_get_functiondef('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure)
  )>0 as publish_version_valid_to_is_qualified,
  position(
    'coalesce(pv.valid_to,now())'
    in pg_get_functiondef('public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid)'::regprocedure)
  )>0 as unpublish_valid_to_is_qualified,
  position(
    'coalesce(pv.valid_to,now())'
    in pg_get_functiondef('public.gridex_pause_contract_channels(uuid,uuid,uuid)'::regprocedure)
  )>0 as pause_valid_to_is_qualified;
