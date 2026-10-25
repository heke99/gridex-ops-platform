-- FINDINGS SEP-01 / owner decision 29 (quality/audits/live-chain-20261015/OWNER-DECISIONS.md; follows decision 20):
-- separately agreed services are registered per service or agreement item, never as a general customer marker, and
-- the marker alone never gives a right to keep billing.
--
-- public.contract_separate_services: content, price, agreement reference and version, the customer's acceptance, start,
-- termination terms, end, and whether the service depends on the electricity supply ('supply_dependent') or can continue
-- on its own ('independent'); provision evidence (provided_through + evidence) and, for an independent service billed
-- after the supply end, a documented continuation review. An electricity-trade fee can never be registered as a separate
-- service (service_code may not be any electricity price component: energy, markups, fixed/monthly/invoice/admin/green/
-- elcertificate/balancing/environmental/start/break fees). Read by tenant members; written only by the functions below.
--
-- Functions (caller = actor or service_role; billing_underlay.export in the company):
--   gridex_register_separate_service_v1(company, input, actor)
--   gridex_record_separate_service_provision_v1(company, service, provided_through, evidence, actor)
--   gridex_review_separate_service_continuation_v1(company, service, basis, actor) -- independent services only
--   gridex_separate_service_billable_v1(company, service, period_start, period_end) -> {billable, reasons}
-- Billable only when every rule holds: the service is active and its agreement covers the period; it was actually
-- provided through the period end; a supply-dependent service only while the linked contract's supply covers the period
-- (by default its fees stop at the supply end); an independent service after the supply end only with a documented
-- continuation review. Nothing here bills by itself.
begin;

create table public.contract_separate_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null,
  customer_contract_id uuid references public.customer_contracts(id),
  service_code text not null check (service_code ~ '^[a-z][a-z0-9_]{2,63}$' and service_code not in (
    'energy', 'markup_ore_per_kwh', 'fixed_monthly_fee', 'invoice_fee', 'elcertificate_fee', 'green_energy_fee', 'balancing_fee',
    'admin_fee', 'environmental_fee', 'spot_markup', 'fixed_markup', 'fixed_price', 'variable_fee', 'start_fee', 'break_fee',
    'discount_ore_per_kwh', 'discount_fixed_amount', 'campaign_discount', 'monthly_fee', 'electricity_trade_fee')),
  description text not null check (btrim(description) <> ''),
  price jsonb not null check (jsonb_typeof(price) = 'object' and (price ? 'amount') and (price ? 'unit') and (price ? 'vat_rate')),
  agreement_reference text not null check (btrim(agreement_reference) <> ''),
  agreement_version text not null check (btrim(agreement_version) <> ''),
  customer_acceptance jsonb not null check (jsonb_typeof(customer_acceptance) = 'object' and (customer_acceptance ? 'accepted_at') and (customer_acceptance ? 'method')),
  starts_on date not null,
  termination_terms jsonb not null check (jsonb_typeof(termination_terms) = 'object' and termination_terms <> '{}'::jsonb),
  ends_on date check (ends_on is null or ends_on >= starts_on),
  supply_dependency text not null check (supply_dependency in ('supply_dependent', 'independent')),
  provided_through date,
  provision_evidence jsonb not null default '{}'::jsonb,
  continuation_review jsonb,
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supply_dependency = 'independent' or continuation_review is null),
  check (supply_dependency = 'independent' or customer_contract_id is not null)
);
alter table public.contract_separate_services enable row level security;
revoke all on table public.contract_separate_services from public, anon, authenticated, service_role;
grant select on table public.contract_separate_services to authenticated, service_role;
create policy contract_separate_services_tenant_read on public.contract_separate_services for select to authenticated
  using (public.gridex_can_write_company(company_id));

create function public.gridex_separate_service_actor_v1(p_company_id uuid, p_actor_user_id uuid)
returns void language plpgsql security definer set search_path to public, extensions, pg_catalog, pg_temp as $fn$
begin
  if p_company_id is null or p_actor_user_id is null then raise exception using errcode = '22023', message = 'separate_service_input_required'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and auth.uid() is distinct from p_actor_user_id then
    raise exception using errcode = '42501', message = 'separate_service_actor_mismatch';
  end if;
  if not public.gridex_actor_has_company_permission(p_actor_user_id, p_company_id, 'billing_underlay.export') then
    raise exception using errcode = '42501', message = 'separate_service_not_allowed';
  end if;
end $fn$;
revoke all on function public.gridex_separate_service_actor_v1(uuid, uuid) from public, anon, authenticated, service_role;

create function public.gridex_register_separate_service_v1(p_company_id uuid, p_input jsonb, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path to public, extensions, pg_catalog, pg_temp as $fn$
declare v_contract uuid := nullif(p_input->>'customer_contract_id', '')::uuid; v_customer uuid := nullif(p_input->>'customer_id', '')::uuid; v_id uuid;
begin
  perform public.gridex_separate_service_actor_v1(p_company_id, p_actor_user_id);
  if v_customer is null or not exists (select from public.customers c where c.id = v_customer and c.company_id = p_company_id) then
    raise exception using errcode = '23514', message = 'separate_service_customer_not_found';
  end if;
  if v_contract is not null and not exists (select from public.customer_contracts c where c.id = v_contract and c.company_id = p_company_id and c.customer_id = v_customer) then
    raise exception using errcode = '23514', message = 'separate_service_contract_not_found';
  end if;
  insert into public.contract_separate_services (company_id, customer_id, customer_contract_id, service_code, description, price,
    agreement_reference, agreement_version, customer_acceptance, starts_on, termination_terms, ends_on, supply_dependency, created_by)
  values (p_company_id, v_customer, v_contract, p_input->>'service_code', p_input->>'description', p_input->'price',
    p_input->>'agreement_reference', p_input->>'agreement_version', p_input->'customer_acceptance', (p_input->>'starts_on')::date,
    p_input->'termination_terms', nullif(p_input->>'ends_on', '')::date, p_input->>'supply_dependency', p_actor_user_id)
  returning id into v_id;
  return jsonb_build_object('applied', true, 'serviceId', v_id);
end $fn$;

create function public.gridex_record_separate_service_provision_v1(p_company_id uuid, p_service_id uuid, p_provided_through date, p_evidence jsonb, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path to public, extensions, pg_catalog, pg_temp as $fn$
declare s public.contract_separate_services%rowtype;
begin
  perform public.gridex_separate_service_actor_v1(p_company_id, p_actor_user_id);
  select * into s from public.contract_separate_services where id = p_service_id and company_id = p_company_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'separate_service_not_found_for_tenant'; end if;
  if p_provided_through is null or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'separate_service_provision_evidence_required';
  end if;
  if p_provided_through < s.starts_on or (s.ends_on is not null and p_provided_through > s.ends_on) then
    raise exception using errcode = '23514', message = 'separate_service_provision_outside_agreement';
  end if;
  update public.contract_separate_services
     set provided_through = greatest(coalesce(provided_through, p_provided_through), p_provided_through),
         provision_evidence = provision_evidence || jsonb_build_object(p_provided_through::text, p_evidence || jsonb_build_object('recorded_by', p_actor_user_id, 'recorded_at', now())),
         updated_at = now()
   where id = s.id;
  return jsonb_build_object('applied', true);
end $fn$;

create function public.gridex_review_separate_service_continuation_v1(p_company_id uuid, p_service_id uuid, p_basis jsonb, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path to public, extensions, pg_catalog, pg_temp as $fn$
declare s public.contract_separate_services%rowtype;
begin
  perform public.gridex_separate_service_actor_v1(p_company_id, p_actor_user_id);
  select * into s from public.contract_separate_services where id = p_service_id and company_id = p_company_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'separate_service_not_found_for_tenant'; end if;
  if s.supply_dependency is distinct from 'independent' then
    raise exception using errcode = '23514', message = 'separate_service_depends_on_supply';
  end if;
  if jsonb_typeof(p_basis) is distinct from 'object' or nullif(btrim(p_basis->>'agreement_clause'), '') is null then
    raise exception using errcode = '22023', message = 'separate_service_continuation_basis_required';
  end if;
  update public.contract_separate_services
     set continuation_review = p_basis || jsonb_build_object('reviewed_by', p_actor_user_id, 'reviewed_at', now()), updated_at = now()
   where id = s.id;
  return jsonb_build_object('applied', true);
end $fn$;

create function public.gridex_separate_service_billable_v1(p_company_id uuid, p_service_id uuid, p_period_start date, p_period_end date)
returns jsonb language plpgsql stable security definer set search_path to public, extensions, pg_catalog, pg_temp as $fn$
declare s public.contract_separate_services%rowtype; reasons text[] := array[]::text[]; supplied boolean;
begin
  select * into s from public.contract_separate_services where id = p_service_id and company_id = p_company_id;
  if not found then return jsonb_build_object('billable', false, 'reasons', jsonb_build_array('service_not_found')); end if;
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    return jsonb_build_object('billable', false, 'reasons', jsonb_build_array('period_invalid'));
  end if;
  if s.status <> 'active' then reasons := array_append(reasons, ('service_' || s.status)); end if;
  if s.starts_on > p_period_start or (s.ends_on is not null and s.ends_on < p_period_end - 1) then reasons := array_append(reasons, 'outside_agreement'); end if;
  if s.provided_through is null or s.provided_through < p_period_end - 1 then reasons := array_append(reasons, 'not_provided'); end if;
  supplied := s.customer_contract_id is not null and exists (
    select from public.customer_supply_periods p
    where p.company_id = p_company_id and p.customer_contract_id = s.customer_contract_id
      and p.status in ('active', 'confirmed_by_grid_owner', 'ending', 'ended')
      and coalesce(p.actual_start_date, p.start_date) <= p_period_start
      and (coalesce(p.actual_end_date, p.end_date) is null or coalesce(p.actual_end_date, p.end_date) >= p_period_end));
  if s.supply_dependency = 'supply_dependent' and not supplied then reasons := array_append(reasons, 'supply_ended'); end if;
  if s.supply_dependency = 'independent' and not supplied and s.continuation_review is null then reasons := array_append(reasons, 'continuation_review_required'); end if;
  return jsonb_build_object('billable', cardinality(reasons) = 0, 'reasons', to_jsonb(reasons), 'supplied', supplied);
end $fn$;

revoke all on function public.gridex_register_separate_service_v1(uuid, jsonb, uuid) from public, anon;
revoke all on function public.gridex_record_separate_service_provision_v1(uuid, uuid, date, jsonb, uuid) from public, anon;
revoke all on function public.gridex_review_separate_service_continuation_v1(uuid, uuid, jsonb, uuid) from public, anon;
revoke all on function public.gridex_separate_service_billable_v1(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.gridex_register_separate_service_v1(uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.gridex_record_separate_service_provision_v1(uuid, uuid, date, jsonb, uuid) to authenticated, service_role;
grant execute on function public.gridex_review_separate_service_continuation_v1(uuid, uuid, jsonb, uuid) to authenticated, service_role;
grant execute on function public.gridex_separate_service_billable_v1(uuid, uuid, date, date) to service_role;

commit;
