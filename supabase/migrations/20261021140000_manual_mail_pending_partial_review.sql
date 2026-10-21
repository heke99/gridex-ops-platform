-- Read-only computed field: filter before PostgREST count/range, including
-- registered child requests whose parent has already completed. The unnamed
-- table-row argument intentionally does not expose a standalone /rpc action.
-- Invoker privileges retain the caller's existing source/request RLS policies.
create or replace function public.gridex_manual_mail_has_pending_partial_v1(public.manual_inbound_messages)
returns boolean language sql stable security invoker set search_path=pg_catalog as $$
  with source as (
    select ($1).id, ($1).company_id, ($1).customer_id, ($1).customer_site_id, ($1).request_id,
      ($1).extracted_payload->'manual_automation' as automation
    where ($1).processing_state='applied' and ($1).resolution_status='matched'
      and ($1).extracted_payload->'sender_credible'='true'::jsonb
      and ($1).extracted_payload#>>'{sender_verification,status}'='verified'
      and ($1).extracted_payload#>>'{manual_automation,sourceHash}' ~ '^[a-f0-9]{64}$'
  ), candidates as (
    select s.*, s.request_id::text as candidate_request_id, s.customer_site_id::text as candidate_site_id,
      s.automation->'application' as application, null::jsonb as member, null::text as member_key
    from source s
    union all
    select s.*, entry.value->>'requestId', entry.value->>'siteId', entry.value->'application', entry.value, entry.key
    from source s cross join lateral jsonb_each(case when jsonb_typeof(s.automation->'site_applications')='object'
      then s.automation->'site_applications' else '{}'::jsonb end) entry
    where entry.value->'version'='1'::jsonb and entry.value->>'status'='applied'
      and entry.value->>'parentRequestId'=s.request_id::text
      and entry.value->>'requestId'=entry.key
      and entry.value->>'companyId'=s.company_id::text and entry.value->>'customerId'=s.customer_id::text
      and entry.value->>'sourceHash'=s.automation->>'sourceHash'
  )
  select exists (
    select 1 from candidates c
    join public.grid_owner_information_requests parent on parent.id=c.request_id and parent.company_id=c.company_id
      and parent.customer_id=c.customer_id and parent.customer_site_id=c.customer_site_id
      and parent.status not in ('cancelled','closed')
    join public.grid_owner_information_requests r
      on r.id=case when c.candidate_request_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        then c.candidate_request_id::uuid end
      and r.company_id=c.company_id and r.customer_id=c.customer_id
      and r.customer_site_id=case when c.candidate_site_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
        then c.candidate_site_id::uuid end
      and r.status not in ('completed','cancelled','closed')
      and r.request_type='current_supplier_contract_information_request'
    where c.application->'version'='1'::jsonb and c.application->'applied'='true'::jsonb
      and c.application->'complete'='false'::jsonb
      and c.application->>'sourceHash'=c.automation->>'sourceHash'
      and c.application->>'inboundId'=c.id::text and c.application->>'inbound_id'=c.id::text
      and c.application->>'companyId'=c.company_id::text and c.application->>'customerId'=c.customer_id::text
      and c.application->>'requestId'=r.id::text and c.application->>'siteId'=r.customer_site_id::text
      -- A newer canonical response supersedes this historical source even if
      -- the request is still partial. No old mail or applied facts are edited.
      and r.parsed_payload=c.application
      and (c.member is null or (c.member->>'powerOfAttorneyId'=r.poa_id::text
        and c.member->>'requestType'=r.request_type and r.request_type=parent.request_type))
  )
$$;
revoke all on function public.gridex_manual_mail_has_pending_partial_v1(public.manual_inbound_messages) from public,anon;
grant execute on function public.gridex_manual_mail_has_pending_partial_v1(public.manual_inbound_messages) to authenticated,service_role;
notify pgrst,'reload schema';
