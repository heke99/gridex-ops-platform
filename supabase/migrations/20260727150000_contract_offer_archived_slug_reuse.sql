begin;

do $$
begin
  if to_regclass('public.contract_offers') is null then
    raise exception using
      errcode = '42P01',
      message = 'contract_offers_table_missing';
  end if;
end
$$;

-- Förhindra samtidiga ändringar medan indexmodellen byts.
lock table public.contract_offers in share row exclusive mode;

-- Hantera miljöer där regeln finns som en tabellconstraint.
alter table public.contract_offers
  drop constraint if exists contract_offers_slug_key;

-- Hantera den aktuella miljön där den sannolikt är ett fristående index.
drop index if exists public.contract_offers_slug_key;

-- Ta bort eventuella äldre varianter av samma globala regel.
drop index if exists public.ux_contract_offers_slug;
drop index if exists public.contract_offers_slug_uidx;

-- Slug behöver vara unik endast bland icke-arkiverade avtal inom samma bolag.
create unique index contract_offers_company_live_slug_uidx
  on public.contract_offers (
    company_id,
    lower(btrim(slug))
  )
  where
    company_id is not null
    and slug is not null
    and btrim(slug) <> ''
    and lifecycle_status <> 'archived'
    and archived_at is null;

comment on index public.contract_offers_company_live_slug_uidx is
  'Slug is unique per company only for non-archived contract offers. Archived offers preserve history without blocking reuse of the slug.';

-- Vanligt index för historiska och arkiverade uppslag.
create index if not exists contract_offers_company_slug_lookup_idx
  on public.contract_offers (
    company_id,
    lower(btrim(slug))
  )
  where
    company_id is not null
    and slug is not null
    and btrim(slug) <> '';

commit;
