-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260716183000_contract_canonical_finalization.sql
-- The source migration checksum is pinned by scripts/migration-history-manifest.json.
-- The exact pre-hardening implementation is corroborated by the preserved
-- gridex_contract_platform_readiness_internal_v1(uuid) definition in gridex-ops-dev.
-- This restores only the historical readiness RPC required by
-- 20260803131558_external_api_contract_database_hardening_v1.sql.

create or replace function public.gridex_contract_platform_readiness(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with base as (
    select * from public.gridex_tenant_contract_readiness_v
    where company_id = p_company_id
  ),
  open_offers as (
    select
      count(*) filter (where is_public and not is_archived and (valid_from is null or valid_from <= current_date) and (valid_to is null or valid_to >= current_date)) as open_public_offer_count,
      count(*) filter (
        where is_public and not is_archived
          and (valid_from is null or valid_from <= current_date)
          and (valid_to is null or valid_to >= current_date)
          and (
            readiness_status is distinct from 'ready'
            or jsonb_array_length(coalesce(readiness_blockers, '[]'::jsonb)) > 0
          )
      ) as open_public_offer_blocked_count
    from public.public_contract_offers
    where company_id = p_company_id
  ),
  invalid_snapshots as (
    select count(*) as invalid_snapshot_count
    from public.customer_contracts cc
    where cc.company_id = p_company_id
      and cc.status in ('active', 'pending_activation', 'started')
      and not exists (
        select 1
        from public.contract_price_snapshots cps
        join public.canonical_price_snapshot_validation_v validation
          on validation.contract_id = cps.contract_id
        where cps.contract_id = cc.id
          and validation.is_valid
      )
  ),
  invalid_signed_pdfs as (
    select count(*) as invalid_pdf_count
    from public.customer_contracts cc
    where cc.company_id = p_company_id
      and cc.status in ('active', 'pending_activation', 'started')
      and not exists (
        select 1 from public.customer_documents document
        where document.customer_id = cc.customer_id
          and document.document_type in ('complete_agreement', 'signed_contract', 'signed_contract_pdf')
      )
  )
  select
    jsonb_build_object(
      'company_id', p_company_id,
      'ready', (
        coalesce((select contract_ready from base), false)
        and coalesce((select price_ready from base), false)
        and coalesce((select legal_ready from base), false)
        and coalesce((select billing_ready from base), false)
        and coalesce((select public_contract_ready from base), false)
        and coalesce((select open_public_offer_blocked_count from open_offers), 0) = 0
        and coalesce((select invalid_snapshot_count from invalid_snapshots), 0) = 0
        and coalesce((select invalid_pdf_count from invalid_signed_pdfs), 0) = 0
      ),
      'contract_ready', coalesce((select contract_ready from base), false),
      'price_ready', coalesce((select price_ready from base), false),
      'legal_ready', coalesce((select legal_ready from base), false),
      'billing_ready', coalesce((select billing_ready from base), false),
      'public_contract_ready', coalesce((select public_contract_ready from base), false),
      'open_public_offer_count', coalesce((select open_public_offer_count from open_offers), 0),
      'open_public_offer_blocked_count', coalesce((select open_public_offer_blocked_count from open_offers), 0),
      'invalid_snapshot_count', coalesce((select invalid_snapshot_count from invalid_snapshots), 0),
      'invalid_signed_pdf_count', coalesce((select invalid_pdf_count from invalid_signed_pdfs), 0),
      'blockers', (
        select jsonb_agg(blocker)
        from (
          select unnest(array[
            case when not coalesce((select contract_ready from base), false) then 'contract_readiness_incomplete' end,
            case when not coalesce((select price_ready from base), false) then 'price_readiness_incomplete' end,
            case when not coalesce((select legal_ready from base), false) then 'legal_readiness_incomplete' end,
            case when not coalesce((select billing_ready from base), false) then 'billing_readiness_incomplete' end,
            case when not coalesce((select public_contract_ready from base), false) then 'public_contract_readiness_incomplete' end,
            case when coalesce((select open_public_offer_blocked_count from open_offers), 0) > 0 then 'public_offer_not_ready' end,
            case when coalesce((select invalid_snapshot_count from invalid_snapshots), 0) > 0 then 'contract_price_snapshot_invalid' end,
            case when coalesce((select invalid_pdf_count from invalid_signed_pdfs), 0) > 0 then 'signed_contract_pdf_missing' end
          ]) as blocker
        ) blockers
        where blocker is not null
      )
    );
$$;

revoke all on function public.gridex_contract_platform_readiness(uuid)
  from public, anon;
grant execute on function public.gridex_contract_platform_readiness(uuid)
  to authenticated, service_role;
