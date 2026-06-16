-- Contract offer safety hardening
-- - Public website offer codes are generated/normalized uniquely per tenant.
-- - Delete flows must preserve signed/customer history by archiving records that are already referenced.

create extension if not exists pgcrypto;

create or replace function public.gridex_normalize_public_offer_code(p_value text)
returns text
language sql
immutable
as $$
  select nullif(left(regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9_-]', '', 'g'), 80), '');
$$;

create or replace function public.gridex_assign_public_offer_code()
returns trigger
language plpgsql
as $$
declare
  base_code text;
  candidate text;
  suffix integer := 1;
begin
  base_code := coalesce(
    public.gridex_normalize_public_offer_code(new.offer_code),
    public.gridex_normalize_public_offer_code(new.public_name),
    'AVTAL'
  );
  base_code := left(base_code, 70);
  candidate := base_code;

  while exists (
    select 1
    from public.public_contract_offers existing
    where existing.company_id = new.company_id
      and existing.offer_code = candidate
      and existing.id is distinct from new.id
  ) loop
    suffix := suffix + 1;
    candidate := left(base_code, greatest(1, 80 - length(suffix::text) - 1)) || '-' || suffix::text;

    if suffix > 999 then
      candidate := left(base_code, 62) || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      exit;
    end if;
  end loop;

  new.offer_code := candidate;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.public_contract_offers') is not null then
    drop trigger if exists trg_gridex_assign_public_offer_code on public.public_contract_offers;
    create trigger trg_gridex_assign_public_offer_code
      before insert or update of offer_code, public_name, company_id
      on public.public_contract_offers
      for each row
      execute function public.gridex_assign_public_offer_code();

    update public.public_contract_offers o
    set offer_code = public.gridex_normalize_public_offer_code(coalesce(o.offer_code, o.public_name, 'AVTAL'))
    where o.offer_code is null or o.offer_code <> public.gridex_normalize_public_offer_code(o.offer_code);
  end if;
end $$;

comment on function public.gridex_assign_public_offer_code() is
  'Normalizes and auto-suffixes public_contract_offers.offer_code so duplicate tenant offer codes do not break contract creation.';

do $$
begin
  if to_regclass('public.public_contract_offers_company_offer_code_uidx') is not null then
    comment on index public.public_contract_offers_company_offer_code_uidx is
      'Unique public offer code per tenant. Application and DB trigger auto-generate safe suffixes before insert/update.';
  end if;
end $$;
