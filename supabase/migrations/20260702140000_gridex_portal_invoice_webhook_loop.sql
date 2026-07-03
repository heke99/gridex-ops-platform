-- Webhook loop closure: customer_invoices needs a tenant-scoped unique key on
-- the partner invoice reference so provider events can be idempotently mirrored
-- into the customer portal.

do $$
declare
  duplicate_groups integer;
begin
  if to_regclass('public.customer_invoices') is null then
    return;
  end if;

  select count(*) into duplicate_groups
  from (
    select company_id, partner_invoice_reference
    from public.customer_invoices
    where partner_invoice_reference is not null
    group by company_id, partner_invoice_reference
    having count(*) > 1
  ) dup;

  if duplicate_groups > 0 then
    raise notice 'customer_invoices_company_partner_ref_uidx NOT created: % duplicate group(s). Merge duplicate portal invoices manually and re-run.', duplicate_groups;
  else
    create unique index if not exists customer_invoices_company_partner_ref_uidx
      on public.customer_invoices(company_id, partner_invoice_reference)
      where partner_invoice_reference is not null;
  end if;

  create index if not exists customer_invoices_company_customer_period_idx
    on public.customer_invoices(company_id, customer_id, period_start desc);
end $$;

-- Processing hot path: pending provider events.
do $$
begin
  if to_regclass('public.invoice_provider_events') is not null then
    create index if not exists invoice_provider_events_pending_idx
      on public.invoice_provider_events(received_at)
      where status = 'received';
  end if;
end $$;
