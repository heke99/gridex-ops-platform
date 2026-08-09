-- Clean-replay prerequisite derived from 20260525_debug_fix_batch_1b_schema_code_alignment.sql.
-- Restore only the source-defined customer_invoice_lines runtime metadata required by later canonical invoice synchronization.
do $$
begin
  if to_regclass('public.customer_invoice_lines') is not null then
    alter table public.customer_invoice_lines add column if not exists line_type text not null default 'energy';
    alter table public.customer_invoice_lines add column if not exists unit text;
    alter table public.customer_invoice_lines add column if not exists vat_rate numeric;
    alter table public.customer_invoice_lines add column if not exists sort_order integer not null default 0;
  end if;
end $$;
