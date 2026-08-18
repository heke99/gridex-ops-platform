create or replace function public.gridex_customer_contracts_auto_renew_guard()
 returns trigger
 language plpgsql
 set search_path to 'public','auth','extensions'
as $function$
declare
  v_binding_months integer;
  v_notice_months integer;
  v_auto_renew_months integer;
  v_bound_until timestamptz;
  v_notice_until timestamptz;
begin
  v_binding_months := coalesce(new.binding_months, 0);
  v_notice_months := coalesce(new.notice_months, 0);
  v_auto_renew_months := coalesce(new.auto_renew_term_months, new.binding_months);

  if new.auto_renew_enabled and (v_auto_renew_months is null or v_auto_renew_months <= 0) then
    raise exception 'auto_renew_term_months or binding_months must be set when auto_renew_enabled=true';
  end if;

  if new.termination_reason is not null and new.termination_notice_date is null then
    raise exception 'termination_notice_date is required when termination_reason is set';
  end if;

  -- Agreement evidence and withdrawal/termination notice may legitimately be
  -- recorded before a future supply start date. starts_at is a delivery date,
  -- not an agreement timestamp.

  if new.status in ('signed', 'active', 'terminated') and new.starts_at is null then
    raise exception 'starts_at is required when status is signed, active, or terminated';
  end if;

  if new.green_fee_mode = 'none' and coalesce(new.green_fee_value, 0) <> 0 then
    raise exception 'green_fee_value must be null or 0 when green_fee_mode = none';
  end if;

  v_bound_until := public.gridex_add_months_timestamptz(new.starts_at, nullif(v_binding_months, 0));
  v_notice_until := public.gridex_add_months_timestamptz(new.termination_notice_date, nullif(v_notice_months, 0));

  if new.ends_at is null then
    new.ends_at := greatest(v_bound_until, v_notice_until);
  elsif new.termination_notice_date is not null then
    new.ends_at := greatest(new.ends_at, v_bound_until, v_notice_until);
  end if;

  if new.status in ('terminated', 'expired') and new.ends_at is null then
    new.ends_at := greatest(v_bound_until, v_notice_until, new.starts_at);
  end if;

  if new.starts_at is not null and new.ends_at is not null and new.ends_at < new.starts_at then
    raise exception 'ends_at cannot be earlier than starts_at';
  end if;

  return new;
end;
$function$;
