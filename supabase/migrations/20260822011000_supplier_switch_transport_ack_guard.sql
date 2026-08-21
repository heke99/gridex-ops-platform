-- Defensive supplier-switch state invariant.
--
-- Legacy/admin code may still attempt to map an outbound transport/application
-- acknowledgement to `accepted`. Without an inbound PRODAT Z04 that is not a
-- business confirmation. Normalize that attempted transition to `submitted`
-- and retain the hard failure for `completed` or any invalid Z04 reference.
-- This is deliberately a DB invariant so every caller, including old jobs and
-- admin actions, gets the same market-safe result.

begin;

create or replace function public.gridex_enforce_supplier_switch_z04_confirmation_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'accepted' and new.inbound_z04_message_id is null then
    -- CONTRL/APERAK/outbound acknowledgement confirms transport/application
    -- handling only. It may advance a queued/draft switch to submitted, never
    -- to business acceptance.
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
  'PRODAT 26.A invariant: transport/application acknowledgements remain submitted; accepted/completed business state requires a correlated inbound Z04.';

commit;
