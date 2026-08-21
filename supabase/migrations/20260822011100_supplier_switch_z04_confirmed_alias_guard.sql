-- Normalize the legacy internal `confirmed` alias before the table CHECK runs.
-- Canonical persisted supplier-switch state remains `accepted` after inbound Z04.

begin;

create or replace function public.gridex_enforce_supplier_switch_z04_confirmation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
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
    if new.submitted_at is null then
      new.submitted_at := now();
    end if;
    new.completed_at := null;
  end if;

  if new.status = 'completed' and new.inbound_z04_message_id is null then
    raise exception using
      errcode = '23514',
      message = 'supplier_switch_business_confirmation_requires_inbound_z04',
      detail = 'A supplier switch cannot be completed before a correlated inbound PRODAT Z04 has confirmed the market change.';
  end if;

  if new.inbound_z04_message_id is not null then
    if not exists (
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
  end if;

  return new;
end;
$$;

comment on function public.gridex_enforce_supplier_switch_z04_confirmation_v1() is
  'PRODAT 26.A invariant: confirmed alias normalizes to accepted only with inbound Z04; transport/application acknowledgements remain submitted; completed requires Z04.';

commit;
