-- GRIDEX-AUD-003 derived interleaved bootstrap prerequisite.
-- Source: supabase/migrations/20260716183000_contract_canonical_finalization.sql
-- Source checksum is pinned by scripts/migration-history-manifest.json.
-- The exact pre-hardening body is corroborated by the preserved
-- public.gridex_contract_platform_readiness_internal_v1(uuid) definition in
-- gridex-ops-dev. This artifact restores only that historical RPC so tracked
-- 20260803131558 can rename and wrap it; no product or tenant data is seeded.

begin;

-- Some historical dependency objects are themselves outside the official dev
-- ledger. Preserve the exact function body while deferring parse-time relation
-- validation; the clean-replay tail explicitly executes internal_v1 after the
-- complete ledger to prove every runtime dependency resolves.
set local check_function_bodies = off;

create or replace function public.gridex_contract_platform_readiness(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
with tenant as (
  select * from public.gridex_tenant_contract_readiness_v where company_id=p_company_id
), email_status as (
  select
    case
      when not exists(select 1 from public.company_email_settings s where s.company_id=p_company_id) then 'unknown'
      when exists(select 1 from public.company_email_settings s where s.company_id=p_company_id and coalesce(s.is_active,false)=true and nullif(s.sender_email,'') is not null) then 'ready'
      else 'blocked'
    end as status,
    array_remove(array[
      case when not exists(select 1 from public.company_email_settings s where s.company_id=p_company_id) then 'email_settings_missing' end,
      case when exists(select 1 from public.company_email_settings s where s.company_id=p_company_id) and not exists(select 1 from public.company_email_settings s where s.company_id=p_company_id and coalesce(s.is_active,false)=true and nullif(s.sender_email,'') is not null) then 'email_sender_not_ready' end,
      case when not exists(select 1 from public.company_email_templates t where t.company_id=p_company_id and t.is_active=true) then 'active_email_templates_missing' end
    ],null) blockers
), docs as (
  select
    case when exists(
      select 1 from public.customer_contracts c
      where c.company_id=p_company_id and c.signed_at is not null
        and not exists(
          select 1 from public.customer_contract_documents d
          where d.customer_contract_id=c.id and d.document_type='signed_contract_pdf'
            and d.storage_bucket='customer-contract-documents' and nullif(d.storage_path,'') is not null
        )
    ) then 'blocked' else 'ready' end status,
    coalesce(array(
      select 'signed_contract_pdf_missing:'||c.id::text
      from public.customer_contracts c
      where c.company_id=p_company_id and c.signed_at is not null
        and not exists(
          select 1 from public.customer_contract_documents d
          where d.customer_contract_id=c.id and d.document_type='signed_contract_pdf'
            and d.storage_bucket='customer-contract-documents' and nullif(d.storage_path,'') is not null
        )
      order by c.created_at desc limit 25
    ),'{}') blockers
), operations as (
  select
    case when exists(
      select 1 from public.customer_contracts c
      where c.company_id=p_company_id and c.status in('signed','active')
        and (c.contract_publication_version_id is null or c.price_plan_version_id is null or c.legal_bundle_version_id is null)
    ) then 'blocked' else 'ready' end status,
    coalesce(array(
      select 'customer_contract_version_binding_missing:'||c.id::text
      from public.customer_contracts c
      where c.company_id=p_company_id and c.status in('signed','active')
        and (c.contract_publication_version_id is null or c.price_plan_version_id is null or c.legal_bundle_version_id is null)
      order by c.created_at desc limit 25
    ),'{}') blockers
)
select jsonb_build_object(
  'company_id',p_company_id,
  'legal_profile',jsonb_build_object(
    'status',coalesce(t.legal_profile_status,'unknown'),
    'missing_fields',coalesce(t.legal_profile_missing_fields,'{}'),
    'review_required',coalesce(t.legal_profile_review_required,false)
  ),
  'publication',jsonb_build_object(
    'status',coalesce(t.overall_status,'unknown'),
    'blockers',coalesce(t.publication_blockers,'{}'),
    'published_versions',coalesce(t.published_publication_versions,0)
  ),
  'website',jsonb_build_object(
    'can_display',coalesce(t.can_display,false),
    'blockers',case when coalesce(t.can_display,false) then '[]'::jsonb else to_jsonb(coalesce(t.publication_blockers,'{}')) end
  ),
  'applications',jsonb_build_object(
    'can_accept',coalesce(t.can_accept_applications,false),
    'blockers',case when coalesce(t.can_accept_applications,false) then '[]'::jsonb else to_jsonb(coalesce(t.publication_blockers,'{}')) end
  ),
  'email',jsonb_build_object('status',e.status,'blockers',e.blockers),
  'documents',jsonb_build_object('status',d.status,'blockers',d.blockers),
  'customer_operations',jsonb_build_object('status',o.status,'blockers',o.blockers),
  'evaluated_at',now()
)
from (select 1 as singleton) seed
left join tenant t on true
cross join email_status e
cross join docs d
cross join operations o;
$$;

revoke all on function public.gridex_contract_platform_readiness(uuid) from public,anon;
grant execute on function public.gridex_contract_platform_readiness(uuid) to authenticated,service_role;

comment on function public.gridex_contract_platform_readiness(uuid) is
  'Canonical tenant readiness object for legal profile, publication, website, applications, email, document archive and customer operations.';

commit;
