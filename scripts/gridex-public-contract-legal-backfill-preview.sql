\set ON_ERROR_STOP on
\if :{?company_id}
\else
\echo 'company_id is required'
\quit 2
\endif

-- Read-only and idempotent. It uses only the exact immutable bundle relation
-- already stored on contract_publication_versions.
select *
from public.gridex_preview_public_contract_legal_backfill_v1(
  p_company_id := :'company_id'::uuid
)
order by company_id,publication_version_id;

select jsonb_pretty(
  public.gridex_apply_public_contract_legal_backfill_v1(
    p_company_id := :'company_id'::uuid,
    p_dry_run := true,
    p_actor_user_id := null
  )
) as dry_run_summary;
