begin;

-- Slug är ett presentations- och sökfält, inte canonical avtalsidentitet.
-- Avtal identifieras genom id, contract_product_id och version_series_id.
--
-- Den gamla globala UNIQUE-regeln blockerar nya avtal när ett tidigare
-- avtal med samma automatiskt genererade slug har arkiverats.

do $$
begin
  if to_regclass('public.contract_offers') is null then
    raise exception using
      errcode = '42P01',
      message = 'contract_offers_table_missing';
  end if;
end
$$;

lock table public.contract_offers in share row exclusive mode;

-- Constrainten i aktuell databas heter contract_offers_slug_key.
alter table public.contract_offers
  drop constraint if exists contract_offers_slug_key;

-- Hantera även miljöer där samma regel råkar finnas som ett fristående index.
drop index if exists public.contract_offers_slug_key;
drop index if exists public.ux_contract_offers_slug;
drop index if exists public.contract_offers_slug_uidx;

-- Behåll ett vanligt index för tenantbaserad sökning.
-- Det är medvetet inte UNIQUE.
create index if not exists contract_offers_company_slug_idx
  on public.contract_offers (
    company_id,
    lower(btrim(slug))
  )
  where nullif(btrim(slug), '') is not null;

comment on index public.contract_offers_company_slug_idx is
  'Non-unique tenant-scoped lookup index. contract_offers.slug is not canonical identity and may be reused by archived or separate contract products.';

commit;
