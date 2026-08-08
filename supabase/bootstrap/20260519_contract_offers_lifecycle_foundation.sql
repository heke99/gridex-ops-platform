-- Derived clean-replay prerequisite from checksum-pinned customer intake/contracts tenant hardening.
-- Restores only the source-defined contract_offers lifecycle metadata required by later
-- canonical contract/invoice completion. No offer rows are seeded or rewritten.
do $$
begin
  if to_regclass('public.contract_offers') is not null then
    alter table public.contract_offers
      add column if not exists version_number integer not null default 1,
      add column if not exists published_at timestamptz,
      add column if not exists archived_at timestamptz,
      add column if not exists last_price_change_at timestamptz;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='contract_offers' and column_name='is_active'
    ) then
      create index if not exists contract_offers_company_status_idx
        on public.contract_offers(company_id, status, is_active);
    else
      create index if not exists contract_offers_company_status_idx
        on public.contract_offers(company_id, status);
    end if;
  end if;
end $$;
