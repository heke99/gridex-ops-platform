\set ON_ERROR_STOP on
\if :{?company_id}
\else
\echo 'company_id is required'
\quit 2
\endif

-- Read-only post-apply verification for one tenant.
with target as (
  select :'company_id'::uuid company_id
)
select
  diagnostic.company_id,
  diagnostic.source_contract_offer_id offer_id,
  diagnostic.offer_reference,
  diagnostic.channel,
  diagnostic.assignment_status,
  diagnostic.channel_status,
  diagnostic.publication_status,
  diagnostic.publication_version_status,
  diagnostic.locked_at,
  diagnostic.price_option_count,
  diagnostic.missing_area_count,
  diagnostic.legal_ready,
  diagnostic.invoice_fee_ready,
  diagnostic.channel_state,
  diagnostic.visible,
  diagnostic.blockers
from public.canonical_public_contract_diagnostics_v diagnostic
join target on target.company_id=diagnostic.company_id
order by diagnostic.source_contract_offer_id,diagnostic.channel;

with target as (
  select :'company_id'::uuid company_id
)
select revision.company_id,revision.channel,revision.revision,
  revision.revision_token,revision.updated_at
from public.contract_publication_revisions revision
join target on target.company_id=revision.company_id
where revision.channel in ('website','api')
order by revision.channel;
