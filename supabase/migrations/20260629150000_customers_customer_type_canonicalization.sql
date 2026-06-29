-- Canonicalize customers.customer_type and enforce it with a CHECK.
--
-- Customer identity must be one of 'private' | 'business' | 'association'.
-- Historically the column was free text with no constraint, so aliases such as
-- 'company', 'consumer', 'organisation' or 'förening' could be stored directly.
-- This migration first normalizes existing values to the canonical set, then
-- adds the CHECK constraint. It is non-destructive for already-canonical rows.

-- 1) Normalize any non-canonical / aliased values in place.
update public.customers
set customer_type = case
  when lower(btrim(coalesce(customer_type, ''))) = any (array[
    'private','privat','consumer','person','privatperson','individual'
  ]) then 'private'
  when lower(btrim(coalesce(customer_type, ''))) = any (array[
    'business','company','foretag','företag','corporate','organization',
    'organisation','enterprise','b2b','juridisk_person','juridisk person'
  ]) then 'business'
  when lower(btrim(coalesce(customer_type, ''))) = any (array[
    'association','förening','forening','brf','bostadsrättsförening',
    'bostadsrattsforening','samfällighet','samfallighet','ideell förening','ideell_förening'
  ]) then 'association'
  else 'private'
end
where customer_type is null
   or customer_type not in ('private','business','association');

-- 2) Enforce the canonical identity set going forward.
alter table public.customers drop constraint if exists customers_customer_type_check;
alter table public.customers
  add constraint customers_customer_type_check
  check (customer_type in ('private','business','association'));
