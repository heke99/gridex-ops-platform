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
\if :{?offer_id}
\else
\set offer_id ''
\endif
\if :{?publication_version_id}
\else
\set publication_version_id ''
\endif
\if :{?channel}
\else
\set channel ''
\endif

-- Explicit scoped apply. The function mutates only safe_to_apply=true rows.
-- Each candidate uses a subtransaction; deterministic failures are reported
-- without allowing one bad legacy row to roll back unrelated safe repairs.
begin;

select *
from public.gridex_preview_public_contract_backfill_v1(
  p_company_id := :'company_id'::uuid,
  p_offer_id := nullif(:'offer_id','')::uuid,
  p_publication_version_id := nullif(:'publication_version_id','')::uuid,
  p_channel := nullif(:'channel','')
);

select *
from public.gridex_apply_public_contract_backfill_v1(
  p_company_id := :'company_id'::uuid,
  p_offer_id := nullif(:'offer_id','')::uuid,
  p_publication_version_id := nullif(:'publication_version_id','')::uuid,
  p_channel := nullif(:'channel',''),
  p_actor_user_id := :'actor_id'::uuid
);

-- A second preview in the same transaction shows unresolved/manual candidates
-- and proves that safely repaired candidates no longer propose another change.
select *
from public.gridex_preview_public_contract_backfill_v1(
  p_company_id := :'company_id'::uuid,
  p_offer_id := nullif(:'offer_id','')::uuid,
  p_publication_version_id := nullif(:'publication_version_id','')::uuid,
  p_channel := nullif(:'channel','')
);

commit;
