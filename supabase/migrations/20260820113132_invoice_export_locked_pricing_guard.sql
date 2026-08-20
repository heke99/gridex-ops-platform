-- Final database guard for the canonical invoice graph.
-- Application code already selects only locked pricing runs; this trigger is
-- the last line of defence for RPC, service-role and future caller drift.

create or replace function private.gridex_require_locked_pricing_run_for_invoice_export()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.pricing_runs pr
    where pr.id = new.pricing_run_id
      and pr.company_id = new.company_id
      and pr.status = 'locked'
  ) then
    raise exception using
      errcode = '23514',
      message = 'invoice_export_requires_locked_pricing_run';
  end if;

  return new;
end;
$$;

revoke all on function private.gridex_require_locked_pricing_run_for_invoice_export() from public;
revoke all on function private.gridex_require_locked_pricing_run_for_invoice_export() from anon;
revoke all on function private.gridex_require_locked_pricing_run_for_invoice_export() from authenticated;

drop trigger if exists invoice_export_items_require_locked_pricing_run
  on public.invoice_export_items;

create trigger invoice_export_items_require_locked_pricing_run
before insert or update of company_id, pricing_run_id
on public.invoice_export_items
for each row
execute function private.gridex_require_locked_pricing_run_for_invoice_export();
