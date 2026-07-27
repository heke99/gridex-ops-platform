-- Enforce the customer-contract lifecycle as a state machine and repair the
-- active-contract uniqueness invariant with energy direction in its identity.

begin;

-- This legacy trigger fabricated "server_verified" acceptance evidence from a
-- status value. Evidence must instead be created by the signature command.
drop trigger if exists customer_contracts_capture_signed_evidence
  on public.customer_contracts;

create or replace function public.gridex_enforce_customer_contract_state_v1()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_allowed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.status in ('signed', 'active')
       and (
         new.signed_at is null
         or new.locked_at is null
         or nullif(new.signature_snapshot_sha256, '') is null
         or new.contract_product_version_id is null
         or new.contract_publication_version_id is null
         or new.legal_bundle_version_id is null
         or new.contract_price_snapshot_id is null
       ) then
      raise exception using
        errcode = '23514',
        message = 'customer_contract_signed_insert_requires_import_command';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'draft' then new.status in ('pending_signature', 'cancelled')
    when 'pending_signature' then
      new.status in ('signature_failed', 'signed', 'cancelled')
    when 'signature_failed' then
      new.status in ('pending_signature', 'cancelled')
    when 'signed' then new.status in ('active', 'terminated', 'cancelled')
    when 'active' then new.status in ('terminated', 'cancelled', 'expired')
    else false
  end;
  if not v_allowed then
    raise exception using
      errcode = '23514',
      message = format(
        'customer_contract_transition_not_allowed:%s:%s',
        old.status,
        new.status
      );
  end if;

  if new.status = 'signed'
     and (
       new.signed_at is null
       or new.locked_at is null
       or nullif(new.signature_snapshot_sha256, '') is null
       or jsonb_typeof(coalesce(new.signature_snapshot, 'null'::jsonb))
         <> 'object'
       or new.signature_snapshot = '{}'::jsonb
       or new.contract_product_version_id is null
       or new.contract_publication_version_id is null
       or new.legal_bundle_version_id is null
       or new.contract_price_snapshot_id is null
     ) then
    raise exception using
      errcode = '23514',
      message = 'customer_contract_signature_evidence_incomplete';
  end if;

  if new.status = 'active'
     and (
       old.status <> 'signed'
       or new.signed_at is null
       or nullif(new.signature_snapshot_sha256, '') is null
       or new.actual_start_date is null
       or new.billing_eligible_at is null
       or new.lifecycle_stage <> 'active'
       or coalesce(new.billing_eligibility_source, '')
          <> 'activate_customer_supply_v1'
     ) then
    raise exception using
      errcode = '23514',
      message = 'customer_contract_activation_requires_supply_graph';
  end if;
  if new.status in ('terminated', 'cancelled', 'expired')
     and (
       new.ended_at is null
       or nullif(new.status_reason_code, '') is null
     ) then
    raise exception using
      errcode = '23514',
      message = 'customer_contract_terminal_evidence_required';
  end if;

  return new;
end
$$;

drop trigger if exists customer_contracts_state_machine_v1
  on public.customer_contracts;
create trigger customer_contracts_state_machine_v1
before insert or update of status on public.customer_contracts
for each row execute function public.gridex_enforce_customer_contract_state_v1();

create or replace function public.gridex_lock_signed_customer_contract()
returns trigger
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_immutable_keys text[] := array[
    'company_id', 'customer_id', 'contract_name', 'contract_type',
    'energy_direction', 'site_id', 'customer_site_id', 'metering_point_id',
    'contract_offer_id', 'public_contract_offer_id', 'offer_reference',
    'quote_reference', 'contract_product_id', 'contract_product_version_id',
    'contract_publication_version_id', 'price_plan_id',
    'price_plan_version_id', 'price_book_id', 'legal_bundle_version_id',
    'contract_price_snapshot_id', 'commercial_snapshot', 'legal_snapshot',
    'legal_versions_snapshot', 'tenant_communication_snapshot',
    'tenant_communication_snapshot_sha256', 'tenant_legal_party_snapshot',
    'signature_snapshot', 'signature_snapshot_sha256', 'document_sha256',
    'price_snapshot', 'campaign_snapshot', 'fixed_price_ore_per_kwh',
    'spot_markup_ore_per_kwh', 'variable_fee_ore_per_kwh',
    'markup_ore_per_kwh', 'monthly_fee_sek', 'invoice_fee_sek',
    'discount_value', 'discount_unit', 'start_fee_sek', 'admin_fee_sek',
    'break_fee_sek', 'vat_rate', 'green_fee_mode', 'green_fee_value',
    'binding_months', 'notice_months', 'optional_fee_lines', 'starts_at',
    'expected_start_at', 'ends_at', 'auto_renew_enabled',
    'auto_renew_term_months', 'terms_version', 'terms_signed_version',
    'signed_version', 'signed_at', 'signed_ip_hash', 'signed_user_agent'
  ];
  v_key text;
begin
  if tg_op = 'DELETE' then
    if old.status in ('signed', 'active', 'terminated', 'cancelled', 'expired')
       or old.signed_at is not null
       or old.locked_at is not null then
      raise exception using
        errcode = '55000',
        message = 'signed_customer_contract_delete_forbidden';
    end if;
    return old;
  end if;

  if old.status in ('signed', 'active', 'terminated', 'cancelled', 'expired')
     or old.signed_at is not null
     or old.locked_at is not null then
    foreach v_key in array v_immutable_keys loop
      if v_new->v_key is distinct from v_old->v_key then
        raise exception using
          errcode = '55000',
          message = 'signed_customer_contract_immutable:' || v_key;
      end if;
    end loop;
    new.locked_at := coalesce(old.locked_at, old.signed_at, now());
  elsif new.signed_at is not null or new.status in ('signed', 'active') then
    new.locked_at := coalesce(new.locked_at, new.signed_at, now());
  end if;
  return new;
end
$$;

drop trigger if exists customer_contracts_lock_signed
  on public.customer_contracts;
create trigger customer_contracts_lock_signed
before update or delete on public.customer_contracts
for each row execute function public.gridex_lock_signed_customer_contract();

do $$
declare
  v_duplicate record;
begin
  select
    contract.company_id,
    coalesce(
      contract.metering_point_id::text,
      'site:' || coalesce(
        contract.customer_site_id,
        contract.site_id
      )::text
    ) as supply_identity,
    coalesce(nullif(lower(contract.energy_direction), ''), 'consumption')
      as energy_direction,
    count(*) as total
  into v_duplicate
  from public.customer_contracts contract
  where contract.status = 'active'
    and contract.company_id is not null
    and (
      contract.metering_point_id is not null
      or coalesce(contract.customer_site_id, contract.site_id) is not null
    )
  group by
    contract.company_id,
    coalesce(
      contract.metering_point_id::text,
      'site:' || coalesce(
        contract.customer_site_id,
        contract.site_id
      )::text
    ),
    coalesce(nullif(lower(contract.energy_direction), ''), 'consumption')
  having count(*) > 1
  limit 1;

  if found then
    raise exception using
      errcode = '23505',
      message = 'active_customer_contract_duplicates_block_repair',
      detail = format(
        'company_id=%s supply_identity=%s energy_direction=%s total=%s',
        v_duplicate.company_id,
        v_duplicate.supply_identity,
        v_duplicate.energy_direction,
        v_duplicate.total
      );
  end if;
end
$$;

drop index if exists public.customer_contracts_single_active_per_site_uidx;
create unique index customer_contracts_single_active_supply_direction_uidx
on public.customer_contracts (
  company_id,
  (
    coalesce(
      metering_point_id::text,
      'site:' || coalesce(customer_site_id, site_id)::text
    )
  ),
  (coalesce(nullif(lower(energy_direction), ''), 'consumption'))
)
where status = 'active'
  and company_id is not null
  and (
    metering_point_id is not null
    or coalesce(customer_site_id, site_id) is not null
  );

comment on index public.customer_contracts_single_active_supply_direction_uidx
is
  'At most one active contract per tenant and physical supply identity for each energy direction. Consumption and production may coexist.';

commit;
