-- A provider may have received the request while its local item is still
-- pending/failed. Freeze that original financial decision before network I/O,
-- rather than waiting for the final sent projection. Existing payloads and
-- provider references remain byte/value-equivalent; there is no backfill.
create function private.gridex_invoice_provider_request_guard_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $guard$
declare v_key text;
begin
  if tg_op='DELETE' then
    if old.request_payload<>'{}'::jsonb or old.provider_invoice_guid is not null then
      raise exception 'invoice_provider_request_immutable' using errcode='55000';
    end if;
    return old;
  end if;
  if old.request_payload='{}'::jsonb and new.request_payload<>'{}'::jsonb
    and current_user<>'service_role' then
    raise exception 'invoice_provider_request_service_required' using errcode='42501';
  end if;
  if old.request_payload<>'{}'::jsonb then
    v_key:=coalesce(old.provider_request_id,old.provider_idempotency_key,old.idempotency_key);
    if new.request_payload is distinct from old.request_payload
      or new.company_id is distinct from old.company_id
      or new.export_run_id is distinct from old.export_run_id
      or new.provider is distinct from old.provider
      or new.environment is distinct from old.environment
      or new.financing_mode is distinct from old.financing_mode
      or new.customer_id is distinct from old.customer_id
      or new.customer_contract_id is distinct from old.customer_contract_id
      or new.billing_underlay_id is distinct from old.billing_underlay_id
      or new.pricing_run_id is distinct from old.pricing_run_id
      or new.idempotency_key is distinct from old.idempotency_key
      or (old.provider_request_id is not null and new.provider_request_id is distinct from old.provider_request_id)
      or (old.provider_idempotency_key is not null and new.provider_idempotency_key is distinct from old.provider_idempotency_key)
      or (new.provider_request_id is not null and new.provider_request_id is distinct from v_key)
      or (new.provider_idempotency_key is not null and new.provider_idempotency_key is distinct from v_key)
      or new.amount_ex_vat is distinct from old.amount_ex_vat
      or new.vat_amount is distinct from old.vat_amount
      or new.amount_inc_vat is distinct from old.amount_inc_vat
      or new.rounding_amount is distinct from old.rounding_amount
      or new.total_kwh is distinct from old.total_kwh
      or new.period_start is distinct from old.period_start
      or new.period_end is distinct from old.period_end
      or new.currency is distinct from old.currency then
      raise exception 'invoice_provider_request_immutable' using errcode='55000';
    end if;
  end if;
  if old.provider_invoice_guid is not null and new.provider_invoice_guid is distinct from old.provider_invoice_guid then
    raise exception 'invoice_provider_identity_immutable' using errcode='55000';
  end if;
  if old.provider_invoice_id is not null and new.provider_invoice_id is distinct from old.provider_invoice_id then
    raise exception 'invoice_provider_identity_immutable' using errcode='55000';
  end if;
  return new;
end;
$guard$;
revoke all on function private.gridex_invoice_provider_request_guard_v1() from public,anon,authenticated,service_role;
create trigger invoice_provider_request_capture_guard
  before update or delete on public.invoice_export_items
  for each row execute function private.gridex_invoice_provider_request_guard_v1();
