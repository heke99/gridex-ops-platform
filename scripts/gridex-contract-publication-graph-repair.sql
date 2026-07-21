\set ON_ERROR_STOP on
\if :{?company_id}
\else
  \echo 'company_id is required'
  \quit 2
\endif
\if :{?offer_id}
\else
  \echo 'offer_id is required'
  \quit 2
\endif
\if :{?actor_id}
\else
  \echo 'actor_id is required'
  \quit 2
\endif

-- Controlled, tenant-scoped repair entrypoint. The database function only
-- changes unambiguous compatibility pointers. Ambiguous/company-mismatched
-- rows are reported for manual review and are never guessed or deleted.
begin;

select jsonb_pretty(public.gridex_resolve_contract_lifecycle_graph(
  :'company_id'::uuid,
  :'offer_id'::uuid
)) as graph_before;

select jsonb_pretty(public.gridex_preview_delete_unused_contract(
  :'company_id'::uuid,
  :'offer_id'::uuid
)) as delete_preview_before;

select jsonb_pretty(public.gridex_repair_contract_publication_links(
  :'company_id'::uuid,
  :'offer_id'::uuid,
  :'actor_id'::uuid
)) as repair_result;

select jsonb_pretty(public.gridex_resolve_contract_lifecycle_graph(
  :'company_id'::uuid,
  :'offer_id'::uuid
)) as graph_after;

select
  id,
  issue_code,
  severity,
  status,
  public_contract_offer_id,
  contract_publication_version_id,
  details,
  created_at,
  resolved_at
from public.contract_publication_graph_issues
where company_id=:'company_id'::uuid
  and (
    public_contract_offer_id in (
      select value::text::uuid
      from jsonb_array_elements_text(
        coalesce(
          public.gridex_resolve_contract_lifecycle_graph(:'company_id'::uuid, :'offer_id'::uuid)
            ->'public_contract_offer_ids',
          '[]'::jsonb
        )
      ) value
    )
    or public_contract_offer_id is null
  )
order by created_at desc;

commit;
