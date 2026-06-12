-- Company-scoped customer number prefixes.
-- Purpose: make customer_number tenant-specific, configurable and safe for all electricity suppliers.
-- Existing customer_number values are preserved. New numbers use the company's configured prefix.

create extension if not exists pgcrypto;

alter table if exists public.companies
  add column if not exists customer_number_prefix text;

create table if not exists public.company_customer_number_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  prefix text not null default 'GDX',
  next_number bigint not null default 100001,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.company_customer_number_sequences
  add column if not exists prefix text not null default 'GDX';

alter table if exists public.company_customer_number_sequences
  add column if not exists next_number bigint not null default 100001;

create or replace function public.gridex_normalize_customer_number_prefix(
  p_value text,
  p_fallback_name text default null
)
returns text
language plpgsql
immutable
as $$
declare
  v_prefix text;
  v_words text[];
  v_word text;
  v_initials text := '';
begin
  v_prefix := upper(regexp_replace(coalesce(nullif(p_value, ''), ''), '[^A-Za-z0-9]', '', 'g'));

  if v_prefix = '' and coalesce(nullif(p_fallback_name, ''), '') <> '' then
    v_words := array(
      select word
      from regexp_split_to_table(
        upper(regexp_replace(p_fallback_name, '[^A-Za-z0-9ÅÄÖåäö]+', ' ', 'g')),
        '\s+'
      ) as word
      where word <> ''
        and word not in ('AB','HB','KB','EF','LTD','LLC','INC','OY','ASA','AS','ENERGI','ELHANDEL','EL','ENERGY','POWER')
      limit 6
    );

    if array_length(v_words, 1) >= 2 then
      foreach v_word in array v_words loop
        v_initials := v_initials || left(v_word, 1);
      end loop;
      v_prefix := v_initials;
    elsif array_length(v_words, 1) = 1 then
      v_prefix := left(regexp_replace(v_words[1], '[^A-Z0-9]', '', 'g'), 6);
    else
      v_prefix := left(upper(regexp_replace(p_fallback_name, '[^A-Za-z0-9]', '', 'g')), 6);
    end if;
  end if;

  v_prefix := coalesce(nullif(v_prefix, ''), 'GDX');
  if length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;

  return left(v_prefix, 12);
end;
$$;

create or replace function public.gridex_default_customer_number_prefix(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  select public.gridex_normalize_customer_number_prefix(
           coalesce(
             nullif(c.customer_number_prefix, ''),
             nullif(s.prefix, ''),
             c.metadata->>'customer_number_prefix'
           ),
           coalesce(nullif(c.slug, ''), nullif(c.name, ''), 'GDX')
         )
    into v_prefix
  from public.companies c
  left join public.company_customer_number_sequences s on s.company_id = c.id
  where c.id = p_company_id;

  return coalesce(v_prefix, 'GDX');
end;
$$;

-- Backfill companies from existing sequence first. If no sequence exists yet, infer a safe prefix from slug/name.
update public.companies c
   set customer_number_prefix = public.gridex_default_customer_number_prefix(c.id),
       updated_at = coalesce(c.updated_at, now())
 where c.customer_number_prefix is null
   and exists (select 1 from public.companies c2 where c2.id = c.id);

create or replace function public.gridex_next_customer_number(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_existing_next bigint;
  v_number bigint;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;

  v_prefix := public.gridex_default_customer_number_prefix(p_company_id);

  if v_prefix !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'invalid customer number prefix: %', v_prefix;
  end if;

  select coalesce(max(nullif(substring(customer_number from '([0-9]+)$'), '')::bigint) + 1, 100001)
    into v_existing_next
  from public.customers
  where company_id = p_company_id
    and customer_number is not null;

  insert into public.company_customer_number_sequences(company_id, prefix, next_number)
  values (p_company_id, v_prefix, v_existing_next)
  on conflict (company_id) do nothing;

  update public.company_customer_number_sequences
     set next_number = greatest(next_number, v_existing_next) + 1,
         prefix = v_prefix,
         updated_at = now()
   where company_id = p_company_id
   returning prefix, next_number - 1 into v_prefix, v_number;

  if v_number is null then
    raise exception 'customer number sequence could not be reserved';
  end if;

  return v_prefix || '-' || v_number::text;
end;
$$;

-- Keep sequence prefix aligned with the company setting for future reservations.
update public.company_customer_number_sequences s
   set prefix = public.gridex_default_customer_number_prefix(s.company_id),
       updated_at = now()
 where exists (select 1 from public.companies c where c.id = s.company_id);

-- Prevent obviously invalid values at DB level without blocking older null data during migration.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_customer_number_prefix_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_customer_number_prefix_check
      check (customer_number_prefix is null or customer_number_prefix ~ '^[A-Z0-9]{2,12}$');
  end if;
end $$;

comment on column public.companies.customer_number_prefix is
  'Tenant-specific customer number prefix, e.g. DX, GDX, NIB. New customer numbers are generated as PREFIX-100001 per company.';

comment on function public.gridex_next_customer_number(uuid) is
  'Atomically reserves a tenant-scoped customer number using companies.customer_number_prefix and company_customer_number_sequences.';
