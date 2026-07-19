-- Canonical customer number assignment for ALL intake channels.
--
-- Problem: only the website application saga reserved customer numbers via
-- gridex_next_customer_number. Admin intake (createCustomerGraph), the
-- external /teckna-avtal intake and Ediel inbound approval inserted customers
-- with customer_number = null, leaving parallel "numberless" customers that
-- later surfaced on customer cards, confirmations and invoices without a
-- permanent Gridex customer number.
--
-- This migration makes the database the single enforcement point:
--   1. A BEFORE INSERT trigger assigns a number from the canonical per-company
--      generator whenever a row is inserted without one. Paths that already
--      reserve a number (website saga) are unaffected because they insert a
--      non-null value.
--   2. A BEFORE UPDATE guard makes an assigned customer number permanent:
--      null -> value is allowed exactly once, value -> different value is
--      rejected (structured errcode 23514, message customer_number_is_permanent).
--   3. Existing numberless customers are backfilled per company in
--      created_at order using the same generator.
--
-- The migration is idempotent and only ever fills nulls; it never rewrites an
-- existing customer number.

-- 1) Insert-time assignment (canonical generator only).
create or replace function public.gridex_assign_customer_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_number is null or btrim(new.customer_number) = '' then
    new.customer_number := public.gridex_next_customer_number(new.company_id);
  end if;
  return new;
end;
$$;

drop trigger if exists customers_assign_customer_number on public.customers;
create trigger customers_assign_customer_number
before insert on public.customers
for each row execute function public.gridex_assign_customer_number();

-- 2) Permanence guard: an assigned number can never change or be cleared.
create or replace function public.gridex_protect_customer_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.customer_number is not null
     and btrim(old.customer_number) <> ''
     and new.customer_number is distinct from old.customer_number then
    raise exception using errcode = '23514', message = 'customer_number_is_permanent';
  end if;
  if (old.customer_number is null or btrim(old.customer_number) = '')
     and (new.customer_number is null or btrim(new.customer_number) = '')
     and new.customer_number is distinct from old.customer_number then
    -- normalize '' -> null noise writes without failing
    new.customer_number := old.customer_number;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_protect_customer_number on public.customers;
create trigger customers_protect_customer_number
before update of customer_number on public.customers
for each row execute function public.gridex_protect_customer_number();

-- 3) Backfill existing numberless customers with the canonical generator.
--    Ordered per company by created_at so older customers get lower numbers.
do $$
declare
  r record;
begin
  for r in
    select id, company_id
    from public.customers
    where customer_number is null or btrim(customer_number) = ''
    order by company_id, created_at, id
  loop
    update public.customers
       set customer_number = public.gridex_next_customer_number(r.company_id),
           updated_at = now()
     where id = r.id
       and (customer_number is null or btrim(customer_number) = '');
  end loop;
end;
$$;

-- 4) Uniqueness per company must exist for the chosen model
--    (tenant-bound series with tenant prefix). Recreated defensively in case
--    the earlier soft-fail dedupe pass skipped it.
create unique index if not exists ux_customers_company_customer_number
  on public.customers (company_id, customer_number)
  where customer_number is not null;
