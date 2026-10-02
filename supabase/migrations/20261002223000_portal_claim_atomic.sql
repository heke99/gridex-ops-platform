-- Approved customer-portal claim: account link, claim record and event in one write.
--
-- Before: an approved self-claim upserted customer_portal_accounts, then inserted
-- customer_portal_claims, then customer_portal_events as three calls. A failure
-- after the first left an active, verified portal account with no approved
-- claim evidence or event. After: gridex_approve_portal_claim_v1 writes all
-- three for the tenant that owns the customer, in one transaction.

-- Converge the canonical schema with the hosted one: the self-claim columns of
-- customer_portal_claims and the message columns of customer_portal_events came
-- from legacy migrations outside the clean replay, so a fresh environment could
-- not record a portal claim at all. Idempotent; the hosted database has them.
alter table public.customer_portal_claims add column if not exists user_email text;
alter table public.customer_portal_claims add column if not exists match_method text not null default 'self_claim';
alter table public.customer_portal_claims add column if not exists personal_number_last4 text;
alter table public.customer_portal_claims add column if not exists email_matched boolean not null default false;
alter table public.customer_portal_claims add column if not exists name_matched boolean not null default false;
alter table public.customer_portal_claims add column if not exists personal_number_matched boolean not null default false;
alter table public.customer_portal_claims add column if not exists installation_matched boolean not null default false;
alter table public.customer_portal_claims add column if not exists matched_site_id uuid;
alter table public.customer_portal_claims add column if not exists matched_metering_point_id uuid;
alter table public.customer_portal_claims add column if not exists failure_reason text;
alter table public.customer_portal_claims add column if not exists input_snapshot jsonb not null default '{}'::jsonb;
alter table public.customer_portal_claims add column if not exists match_snapshot jsonb not null default '{}'::jsonb;
alter table public.customer_portal_claims add column if not exists reviewed_by uuid;
alter table public.customer_portal_claims add column if not exists reviewed_at timestamptz;
alter table public.customer_portal_events add column if not exists actor_user_id uuid;
alter table public.customer_portal_events add column if not exists event_status text not null default 'info';
alter table public.customer_portal_events add column if not exists message text;

create or replace function public.gridex_approve_portal_claim_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_user_id uuid,
  p_account jsonb,
  p_claim jsonb,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_now timestamptz := now();
  v_account_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'portal_claim_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_user_id is null then
    raise exception using errcode = '22023', message = 'portal_claim_payload_invalid';
  end if;

  perform 1 from public.customers
  where id = p_customer_id and company_id = p_company_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;

  insert into public.customer_portal_accounts (
    company_id, user_id, user_email, customer_id, role, is_active, activated_at, verified_at,
    match_method, verified_identity_snapshot, updated_at
  ) values (
    p_company_id, p_user_id, p_account->>'user_email', p_customer_id, 'owner', true, v_now, v_now,
    coalesce(p_account->>'match_method', 'self_claim_strict_identity'),
    coalesce(p_account->'verified_identity_snapshot', '{}'::jsonb), v_now
  )
  on conflict (user_id, customer_id) where user_id is not null and customer_id is not null
  do update set
    company_id = excluded.company_id,
    user_email = excluded.user_email,
    role = excluded.role,
    is_active = true,
    activated_at = excluded.activated_at,
    verified_at = excluded.verified_at,
    match_method = excluded.match_method,
    verified_identity_snapshot = excluded.verified_identity_snapshot,
    updated_at = excluded.updated_at
  where public.customer_portal_accounts.company_id is not distinct from excluded.company_id
     or public.customer_portal_accounts.company_id is null
  returning id into v_account_id;
  if v_account_id is null then
    -- An existing link for this user/customer belongs to another tenant.
    raise exception using errcode = '42501', message = 'portal_claim_account_tenant_mismatch';
  end if;

  insert into public.customer_portal_claims (
    user_id, company_id, user_email, customer_id, status, match_method, personal_number_last4,
    email_matched, name_matched, personal_number_matched, installation_matched,
    matched_site_id, matched_metering_point_id, input_snapshot, match_snapshot, reviewed_at
  ) values (
    p_user_id, p_company_id, p_account->>'user_email', p_customer_id, 'approved',
    coalesce(p_claim->>'match_method', 'self_claim_strict_identity'),
    p_claim->>'personal_number_last4',
    true, true, true, true,
    nullif(p_claim->>'matched_site_id', '')::uuid,
    nullif(p_claim->>'matched_metering_point_id', '')::uuid,
    coalesce(p_claim->'input_snapshot', '{}'::jsonb),
    coalesce(p_claim->'match_snapshot', '{}'::jsonb),
    v_now
  );

  insert into public.customer_portal_events (company_id, customer_id, user_id, event_type, message, metadata)
  values (
    p_company_id, p_customer_id, p_user_id,
    coalesce(p_event->>'event_type', 'portal_account_verified'),
    p_event->>'message',
    coalesce(p_event->'metadata', '{}'::jsonb)
  );

  return jsonb_build_object('account_id', v_account_id);
end
$function$;

revoke all on function public.gridex_approve_portal_claim_v1(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.gridex_approve_portal_claim_v1(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;
