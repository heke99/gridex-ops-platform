-- Derived clean-replay prerequisite from checksum-pinned pre-ledger source.
-- Restores only powers_of_attorney.customer_contract_id before the canonical
-- 20260617183000 portal-document backfill reads that runtime relation.
do $$
begin
  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney
      add column if not exists customer_contract_id uuid;
  end if;
end $$;
