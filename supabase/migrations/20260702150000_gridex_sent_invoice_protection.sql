-- Sent/credited invoice export items are financially binding: block deletes,
-- financial edits and silent re-send resets at the database level. Corrections
-- must go through an explicit credit/correction path.
--
-- Maintenance escape hatch (DBA only):
--   set local app.gridex_billing_maintenance = 'on';

create or replace function public.gridex_protect_sent_invoice_export_items()
returns trigger
language plpgsql
as $$
declare
  protected boolean;
begin
  if coalesce(current_setting('app.gridex_billing_maintenance', true), '') = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  protected := old.status in ('sent', 'credited');

  if tg_op = 'DELETE' then
    if protected then
      raise exception 'Skickade/krediterade fakturaexportposter kan inte raderas (item %). Skapa kredit eller korrigering i stället.', old.id
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if not protected then
    return new;
  end if;

  -- Block re-send: status must never go back to a sendable state.
  if new.status in ('pending', 'failed', 'failed_retryable') then
    raise exception 'Fakturaexportpost % är redan skickad och kan inte skickas om. Skapa kredit eller korrigering i stället.', old.id
      using errcode = 'P0001';
  end if;

  -- Block financial mutation of a sent invoice.
  if new.amount_ex_vat is distinct from old.amount_ex_vat
     or new.vat_amount is distinct from old.vat_amount
     or new.amount_inc_vat is distinct from old.amount_inc_vat
     or new.rounding_amount is distinct from old.rounding_amount
     or new.request_payload is distinct from old.request_payload
     or new.idempotency_key is distinct from old.idempotency_key
     or new.pricing_run_id is distinct from old.pricing_run_id
     or new.billing_underlay_id is distinct from old.billing_underlay_id
     or new.customer_id is distinct from old.customer_id
  then
    raise exception 'Fakturaexportpost % är skickad och får inte ändras finansiellt. Skapa kredit eller korrigering i stället.', old.id
      using errcode = 'P0001';
  end if;

  -- Provider invoice identity may be set once but never rewritten.
  if old.provider_invoice_guid is not null
     and new.provider_invoice_guid is distinct from old.provider_invoice_guid
  then
    raise exception 'Fakturaexportpost % har redan ett leverantörs-id och det får inte skrivas om.', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.invoice_export_items') is not null then
    drop trigger if exists gridex_invoice_export_items_sent_guard_tg on public.invoice_export_items;
    create trigger gridex_invoice_export_items_sent_guard_tg
      before update or delete on public.invoice_export_items
      for each row execute function public.gridex_protect_sent_invoice_export_items();
  end if;
end $$;
