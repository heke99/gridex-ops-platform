\set ON_ERROR_STOP on
\if :{?company_id}
\else
\echo 'company_id is required'
\quit 2
\endif
\if :{?actor_id}
\else
\echo 'actor_id is required'
\quit 2
\endif

begin;

select *
from public.gridex_preview_public_contract_legal_backfill_v1(
  p_company_id := :'company_id'::uuid
)
order by company_id,publication_version_id;

select jsonb_pretty(
  public.gridex_apply_public_contract_legal_backfill_v1(
    p_company_id := :'company_id'::uuid,
    p_dry_run := false,
    p_actor_user_id := :'actor_id'::uuid
  )
) as apply_summary;

-- A second dry run proves idempotency. A successful apply must report
-- backfilled=0 on this pass.
select jsonb_pretty(
  public.gridex_apply_public_contract_legal_backfill_v1(
    p_company_id := :'company_id'::uuid,
    p_dry_run := true,
    p_actor_user_id := null
  )
) as second_run_summary;

commit;
