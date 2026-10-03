-- Legal archiving: anonymize a former customer once the retention period is over.
--
-- A customer who has moved, switched away or been archived stays as a record
-- because invoices, contracts, signatures and Ediel messages are accounting
-- and legal evidence. Bokföringslagen requires accounting records to be kept
-- until the end of the seventh year after the calendar year in which the
-- financial year ended. After that, personal data that is no longer needed
-- must be removed (GDPR art. 5.1 e).
--
-- gridex_anonymize_customer_v1 removes the personal data in the customer's
-- master data (customer, contacts, addresses, portal accounts, internal
-- notes) and keeps the record and all ids, so the anonymized customer still
-- links to its invoices and contracts. Accounting and evidence tables are not
-- modified. The command refuses while the customer is still supplied, has
-- unsettled invoices, is under legal hold or inside the retention period.

alter table public.customers add column if not exists legal_hold boolean not null default false;
alter table public.customers add column if not exists legal_hold_reason text;

comment on column public.customers.legal_hold is
  'Blocks anonymization while true (dispute, claim, authority request).';

create or replace function public.gridex_customer_retention_until_v1(p_customer_id uuid)
returns date
language sql
stable
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
  -- The last business event decides the retention year; records are kept to
  -- the end of the seventh year after it, so anonymization is allowed from
  -- 1 January of the eighth year.
  select make_date(extract(year from last_event)::int + 8, 1, 1)
  from (
    select greatest(
      (select max(coalesce(i.paid_at, i.issued_at, i.created_at)) from public.customer_invoices i where i.customer_id = c.id),
      (select max(coalesce(p.actual_end_date, p.end_date)::timestamptz) from public.customer_supply_periods p where p.customer_id = c.id),
      c.archived_at,
      c.lifecycle_closed_at,
      c.created_at
    ) as last_event
    from public.customers c
    where c.id = p_customer_id
  ) last_activity
$function$;

create or replace function public.gridex_anonymize_customer_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_customer public.customers%rowtype;
  v_retention_until date;
  v_label text := 'Anonymiserad kund';
  p_today date := current_date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'customer_anonymize_service_role_required';
  end if;
  if p_company_id is null or p_customer_id is null or p_actor_user_id is null then
    raise exception using errcode = '22023', message = 'customer_anonymize_payload_invalid';
  end if;

  select * into v_customer
  from public.customers
  where id = p_customer_id and company_id = p_company_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'customer_not_found_for_tenant';
  end if;

  if v_customer.anonymized_at is not null then
    return jsonb_build_object('already_anonymized', true, 'anonymized_at', v_customer.anonymized_at);
  end if;
  if v_customer.legal_hold then
    raise exception using errcode = '23514', message = 'customer_anonymize_legal_hold',
      detail = coalesce(v_customer.legal_hold_reason, '');
  end if;
  if v_customer.status not in ('archived', 'moved', 'inactive', 'terminated') then
    raise exception using errcode = '23514', message = 'customer_anonymize_customer_still_active';
  end if;
  if exists (
    select 1 from public.customer_supply_periods p
    where p.customer_id = p_customer_id
      and p.status in ('active', 'confirmed_by_grid_owner')
      and (coalesce(p.actual_end_date, p.end_date) is null or coalesce(p.actual_end_date, p.end_date) >= p_today)
  ) then
    raise exception using errcode = '23514', message = 'customer_anonymize_supply_ongoing';
  end if;
  if exists (
    select 1 from public.customer_invoices i
    where i.customer_id = p_customer_id
      and i.status in ('draft', 'issued', 'sent', 'overdue', 'failed')
  ) then
    raise exception using errcode = '23514', message = 'customer_anonymize_unsettled_invoices';
  end if;

  v_retention_until := public.gridex_customer_retention_until_v1(p_customer_id);
  if v_retention_until is not null and p_today < v_retention_until then
    raise exception using errcode = '23514', message = 'customer_anonymize_retention_period_active',
      detail = v_retention_until::text;
  end if;

  update public.customers
  set first_name = null,
      last_name = null,
      full_name = v_label,
      name = v_label,
      company_name = case when company_name is null then null else v_label end,
      personal_number = null,
      identity_number = null,
      org_number = null,
      organization_number = null,
      email = null,
      invoice_email = null,
      phone = null,
      apartment_number = null,
      billing_street = null,
      billing_postal_code = null,
      billing_city = null,
      anonymized_at = now(),
      anonymized_by = p_actor_user_id,
      data_retention_note = 'Personuppgifter anonymiserade efter utgången lagringstid (' || v_retention_until::text || ').',
      updated_at = now()
  where id = p_customer_id and company_id = p_company_id;

  update public.customer_contacts
  set name = null, email = null, phone = null, title = null,
      updated_at = now()
  where customer_id = p_customer_id and company_id = p_company_id;

  update public.customer_addresses
  set street_1 = null, street_2 = null, postal_code = null, city = null, is_active = false,
      updated_at = now()
  where customer_id = p_customer_id and company_id = p_company_id;

  update public.customer_portal_accounts
  set email = null, user_email = null, verified_identity_snapshot = null, is_active = false,
      updated_at = now()
  where customer_id = p_customer_id and company_id = p_company_id;

  update public.customer_internal_notes
  set body = '[Anteckning borttagen vid anonymisering]'
  where customer_id = p_customer_id and company_id = p_company_id;

  insert into public.audit_logs (actor_user_id, company_id, entity_type, entity_id, action, metadata)
  values (
    p_actor_user_id, p_company_id, 'customer', p_customer_id::text, 'customer.anonymized',
    jsonb_build_object(
      'label', 'Anonymiserade kund efter lagringstid',
      'retention_until', v_retention_until,
      'retained', 'Fakturor, avtal, signeringsbevis och Ediel-meddelanden behålls oförändrade.'
    )
  );

  return jsonb_build_object('already_anonymized', false, 'retention_until', v_retention_until);
end
$function$;

revoke all on function public.gridex_customer_retention_until_v1(uuid) from public, anon, authenticated;
grant execute on function public.gridex_customer_retention_until_v1(uuid) to service_role;
revoke all on function public.gridex_anonymize_customer_v1(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.gridex_anonymize_customer_v1(uuid, uuid, uuid) to service_role;
