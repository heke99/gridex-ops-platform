-- PRODAT 26.A supplier-switch activation invariant.
-- Business acceptance requires inbound Z04; completion additionally requires
-- an effective start date that has been reached in the Swedish market timezone.

begin;

create or replace function public.gridex_enforce_supplier_switch_z04_confirmation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  effective_start_date date;
  stockholm_market_date date := (now() at time zone 'Europe/Stockholm')::date;
begin
  if new.status = 'confirmed' then
    if new.inbound_z04_message_id is null then
      raise exception using
        errcode = '23514',
        message = 'supplier_switch_confirmed_requires_inbound_z04',
        detail = 'Legacy confirmed state may only be normalized when a correlated inbound PRODAT Z04 is linked.';
    end if;
    new.status := 'accepted';
  end if;

  if new.status = 'accepted' and new.inbound_z04_message_id is null then
    new.status := 'submitted';
    if new.submitted_at is null then new.submitted_at := now(); end if;
    new.completed_at := null;
  end if;

  if new.inbound_z04_message_id is not null and not exists (
    select 1
    from public.ediel_messages m
    where m.id = new.inbound_z04_message_id
      and m.company_id = new.company_id
      and m.direction = 'inbound'
      and upper(m.message_family) = 'PRODAT'
      and upper(coalesce(m.message_code,'')) = 'Z04'
  ) then
    raise exception using
      errcode = '23514',
      message = 'supplier_switch_inbound_z04_reference_invalid',
      detail = 'inbound_z04_message_id must reference an inbound PRODAT Z04 in the same tenant.';
  end if;

  if new.status = 'completed' then
    if new.inbound_z04_message_id is null then
      raise exception using
        errcode = '23514',
        message = 'supplier_switch_business_confirmation_requires_inbound_z04',
        detail = 'A supplier switch cannot be completed before a correlated inbound PRODAT Z04 has confirmed the market change.';
    end if;

    if tg_op = 'UPDATE' and old.status not in ('accepted','completed') then
      raise exception using
        errcode = '23514',
        message = 'supplier_switch_completion_requires_accepted_state',
        detail = 'Completion must follow the accepted state established by inbound PRODAT Z04.';
    end if;

    effective_start_date := coalesce(new.confirmed_start_date, new.requested_start_date)::date;
    if effective_start_date is null then
      raise exception using
        errcode = '23514',
        message = 'supplier_switch_effective_start_date_required',
        detail = 'A supplier switch cannot be completed without a confirmed or requested effective start date.';
    end if;

    if effective_start_date > stockholm_market_date then
      raise exception using
        errcode = '23514',
        message = 'supplier_switch_effective_date_not_reached',
        detail = format('Effective start date %s has not been reached in Europe/Stockholm (market date %s).', effective_start_date, stockholm_market_date);
    end if;
  end if;

  return new;
end;
$$;

comment on function public.gridex_enforce_supplier_switch_z04_confirmation_v1() is
  'PRODAT 26.A invariant: ACK remains submitted; accepted requires inbound Z04; completed requires prior accepted state and reached effective date in Europe/Stockholm.';

commit;
