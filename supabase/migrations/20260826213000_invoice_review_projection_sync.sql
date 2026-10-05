-- Invoice review projection sync.
-- Canonical truth remains billing_underlays.readiness_status + locked pricing +
-- invoice_export_items + customer_invoices. This trigger only maintains the
-- compatibility invoice_readiness_status used by existing customer overview UI.

begin;

create or replace function public.gridex_sync_underlay_invoice_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_export_run_id uuid;
begin
  if new.company_id is null or new.customer_id is null or new.billing_underlay_id is null then
    return new;
  end if;

  if new.invoice_export_item_id is not null then
    select iei.export_run_id
      into v_export_run_id
      from public.invoice_export_items iei
     where iei.id = new.invoice_export_item_id
       and iei.company_id = new.company_id
       and iei.customer_id = new.customer_id;
  end if;

  update public.billing_underlays bu
     set invoice_readiness_status = case
           when new.status = 'draft' then 'ready_for_invoice'
           when new.status in ('issued', 'sent', 'paid', 'overdue') then 'invoiced'
           when new.status = 'credited' then 'credited'
           when new.status = 'cancelled' then 'cancelled'
           when new.status = 'failed' then 'needs_review'
           else coalesce(bu.invoice_readiness_status, 'pending')
         end,
         invoice_export_run_id = coalesce(v_export_run_id, bu.invoice_export_run_id),
         invoice_export_locked_at = case
           when new.status in ('issued', 'sent', 'paid', 'overdue', 'credited')
             then coalesce(bu.invoice_export_locked_at, now())
           else bu.invoice_export_locked_at
         end,
         updated_at = now()
   where bu.id = new.billing_underlay_id
     and bu.company_id = new.company_id
     and bu.customer_id = new.customer_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'invoice_projection_underlay_customer_mismatch';
  end if;

  return new;
end
$$;

revoke all on function public.gridex_sync_underlay_invoice_projection_v1() from public, anon, authenticated;
grant execute on function public.gridex_sync_underlay_invoice_projection_v1() to service_role;

drop trigger if exists customer_invoices_underlay_projection_v1 on public.customer_invoices;
create trigger customer_invoices_underlay_projection_v1
after insert or update of status, billing_underlay_id, invoice_export_item_id
on public.customer_invoices
for each row execute function public.gridex_sync_underlay_invoice_projection_v1();

comment on function public.gridex_sync_underlay_invoice_projection_v1() is
  'Maintains the customer-card invoice readiness projection from canonical customer_invoices. Does not decide billing readiness or provider send eligibility.';

commit;
