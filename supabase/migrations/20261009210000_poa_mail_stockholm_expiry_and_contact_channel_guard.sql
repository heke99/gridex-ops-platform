-- POA mail review #13 and #15 (2026-10-09).
--
-- #13: power-of-attorney expiry compared valid_to with current_date, which is
-- the session (UTC) date. A POA valid through a Swedish calendar day was
-- expired up to two hours early/late around midnight. The sweep now compares
-- against the Europe/Stockholm calendar date. Same signature and ACL.
--
-- #15: tenant administrators could insert/update grid_owner_contact_channels
-- with is_verified=true directly through RLS, skipping e-mail validation, and
-- verified_at was never set. A BEFORE trigger now:
--   * validates the e-mail format;
--   * only lets service_role or a platform admin mark a channel verified (or
--     change the address of a verified channel);
--   * stamps verified_at when a channel becomes verified, clears it otherwise;
--   * refuses a verified manual channel whose address is a shared Ediel/EDIFACT
--     gateway (any grid_owners communication/contact/email address or an
--     ediel_mailboxes address), so a gateway used by many grid owners can never
--     become a manual recipient.
-- The admin UI writes with the service role and keeps working.

create or replace function public.gridex_expire_overdue_powers_of_attorney_v1(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_expired integer := 0;
  v_stockholm_today date := (now() at time zone 'Europe/Stockholm')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'poa_expiry_service_role_required';
  end if;

  with due as (
    select id
    from public.powers_of_attorney
    where status in ('signed', 'active', 'accepted', 'sent', 'draft')
      and valid_to is not null
      and valid_to < v_stockholm_today
    order by valid_to, id
    limit v_limit
    for update skip locked
  ),
  expired as (
    update public.powers_of_attorney poa
    set status = 'expired', updated_at = now()
    from due
    where poa.id = due.id
    returning poa.id, poa.company_id, poa.valid_to
  ),
  events as (
    insert into public.power_of_attorney_events (company_id, power_of_attorney_id, event_type, payload)
    select company_id, id, 'expired',
           jsonb_build_object('valid_to', valid_to, 'source', 'customer_operations_cron', 'calendar', 'Europe/Stockholm')
    from expired
    returning 1
  )
  select count(*) into v_expired from events;

  return jsonb_build_object('expired', v_expired);
end
$function$;

revoke all on function public.gridex_expire_overdue_powers_of_attorney_v1(integer) from public, anon, authenticated;
grant execute on function public.gridex_expire_overdue_powers_of_attorney_v1(integer) to service_role;

create or replace function public.gridex_guard_grid_owner_contact_channel_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $function$
declare
  v_email text;
  v_privileged boolean;
  v_verification_change boolean;
begin
  new.email := nullif(btrim(coalesce(new.email, '')), '');
  v_email := lower(new.email);

  if v_email is not null
     and v_email !~ '^[^[:space:]@<>(),;:"]+@[^[:space:]@<>(),;:"]+\.[^[:space:]@<>(),;:"]+$' then
    raise exception using
      errcode = '23514',
      message = 'grid_owner_contact_channel_invalid_email';
  end if;

  if coalesce(new.is_verified, false) is not true then
    new.verified_at := null;
    return new;
  end if;

  v_verification_change := tg_op = 'INSERT'
    or coalesce(old.is_verified, false) is not true
    or lower(coalesce(old.email, '')) is distinct from coalesce(v_email, '');

  if v_verification_change then
    v_privileged := coalesce(auth.role(), '') = 'service_role'
      or coalesce(public.gridex_user_is_platform_admin(), false);
    if not v_privileged then
      raise exception using
        errcode = '42501',
        message = 'grid_owner_contact_channel_verification_requires_platform_admin';
    end if;
    new.verified_at := now();
  elsif new.verified_at is null then
    new.verified_at := coalesce(old.verified_at, now());
  end if;

  if v_email is not null and coalesce(new.channel_type, '') <> 'ediel' then
    if exists (
      select 1
      from public.grid_owners g
      where lower(btrim(coalesce(g.communication_email, ''))) = v_email
         or lower(btrim(coalesce(g.contact_email, ''))) = v_email
         or lower(btrim(coalesce(g.email, ''))) = v_email
    ) or exists (
      select 1
      from public.ediel_mailboxes m
      where lower(btrim(coalesce(m.email_address, ''))) = v_email
    ) then
      raise exception using
        errcode = '23514',
        message = 'grid_owner_contact_channel_shared_ediel_gateway',
        detail = 'A verified manual grid-owner contact must not be an Ediel/EDIFACT gateway address shared through grid_owners or ediel_mailboxes.';
    end if;
  end if;

  return new;
end
$function$;

revoke all on function public.gridex_guard_grid_owner_contact_channel_v1() from public, anon, authenticated;

drop trigger if exists gridex_guard_grid_owner_contact_channel on public.grid_owner_contact_channels;
create trigger gridex_guard_grid_owner_contact_channel
  before insert or update on public.grid_owner_contact_channels
  for each row execute function public.gridex_guard_grid_owner_contact_channel_v1();
