\set ON_ERROR_STOP on
\if :{?company_id}
\else
\echo 'company_id is required'
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

-- Read-only dry run. Safe to execute repeatedly. Start with one tenant and
-- optionally narrow further to one offer, publication version or channel.
select *
from public.gridex_preview_public_contract_backfill_v1(
  p_company_id := :'company_id'::uuid,
  p_offer_id := nullif(:'offer_id','')::uuid,
  p_publication_version_id := nullif(:'publication_version_id','')::uuid,
  p_channel := nullif(:'channel','')
)
order by company_id,offer_id,channel,publication_version_id;
