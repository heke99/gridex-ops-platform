create or replace function public.gridex_enforce_contract_price_snapshot_hash_v1()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_expected_hash text;
begin
  if new.snapshot_json is null then
    raise exception using
      errcode = '23502',
      message = 'contract_price_snapshot_json_required';
  end if;

  v_expected_hash := encode(
    extensions.digest(convert_to(new.snapshot_json::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if nullif(btrim(coalesce(new.snapshot_hash, '')), '') is not null
     and lower(btrim(new.snapshot_hash)) is distinct from v_expected_hash then
    raise exception using
      errcode = '23514',
      message = 'contract_price_snapshot_hash_mismatch';
  end if;

  new.snapshot_hash := v_expected_hash;
  return new;
end;
$$;

revoke all on function public.gridex_enforce_contract_price_snapshot_hash_v1()
  from public, anon, authenticated;
grant execute on function public.gridex_enforce_contract_price_snapshot_hash_v1()
  to service_role;

drop trigger if exists zzzz_contract_price_snapshots_hash_integrity_v1
  on public.contract_price_snapshots;
create trigger zzzz_contract_price_snapshots_hash_integrity_v1
before insert on public.contract_price_snapshots
for each row
execute function public.gridex_enforce_contract_price_snapshot_hash_v1();

set local app.gridex_pricing_maintenance = 'on';
update public.contract_price_snapshots
set snapshot_hash = encode(
  extensions.digest(convert_to(snapshot_json::text, 'UTF8'), 'sha256'),
  'hex'
)
where nullif(btrim(coalesce(snapshot_hash, '')), '') is null;

alter table public.contract_price_snapshots
  alter column snapshot_hash set not null;

alter table public.contract_price_snapshots
  drop constraint if exists contract_price_snapshots_snapshot_hash_sha256_check;
alter table public.contract_price_snapshots
  add constraint contract_price_snapshots_snapshot_hash_sha256_check
  check (snapshot_hash ~ '^[0-9a-f]{64}$');

comment on column public.contract_price_snapshots.snapshot_hash is
  'Canonical SHA-256 of snapshot_json::text after insert-time normalization. Required for immutable signing-chain integrity.';

comment on function public.gridex_enforce_contract_price_snapshot_hash_v1() is
  'Central contract-price snapshot integrity boundary: computes canonical SHA-256 after normalization and rejects caller-provided mismatches.';
