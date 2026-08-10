begin;
set local search_path = public, pg_catalog;

alter table public.customer_invoices
  add column if not exists invoice_reference text;

update public.customer_invoices i
set invoice_reference = 'invoice_' || substr(
  translate(
    rtrim(encode(extensions.digest(convert_to(
      'gridex-public-reference:v1:' || i.company_id::text || ':invoice:' || i.id::text,
      'UTF8'
    ), 'sha256'::text), 'base64'), '='),
    '+/', '-_'
  ),
  1,
  32
)
where i.invoice_reference is null;

alter table public.customer_invoices
  alter column invoice_reference set not null;

create unique index if not exists customer_invoices_company_invoice_reference_uidx
  on public.customer_invoices (company_id, invoice_reference);

create or replace function public.ensure_customer_invoice_reference_v1()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and new.company_id is not distinct from old.company_id
     and new.id is not distinct from old.id then
    new.invoice_reference := old.invoice_reference;
    return new;
  end if;
  new.invoice_reference := 'invoice_' || substr(
    translate(
      rtrim(encode(extensions.digest(convert_to(
        'gridex-public-reference:v1:' || new.company_id::text || ':invoice:' || new.id::text,
        'UTF8'
      ), 'sha256'::text), 'base64'), '='),
      '+/', '-_'
    ),
    1,
    32
  );
  return new;
end;
$$;

drop trigger if exists customer_invoices_public_reference_trg on public.customer_invoices;
create trigger customer_invoices_public_reference_trg
before insert or update of id, company_id, invoice_reference on public.customer_invoices
for each row execute function public.ensure_customer_invoice_reference_v1();

commit;
