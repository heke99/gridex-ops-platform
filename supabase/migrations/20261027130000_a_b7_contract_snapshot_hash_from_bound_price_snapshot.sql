-- FINDINGS A-B7 (reality A5, batch 6). A website customer's switch confirmed by the grid owner with a start today was
-- never activated: gridex_process_ready_supplier_switch_activations sets the contract's billing_eligible_at, and
-- customer_contracts_billing_identity_check then requires snapshot_hash, which a website contract never has.
-- gridex_finalize_customer_contract_signature_v1 (staff/offer signing) copies the bound price snapshot's hash onto the
-- contract (snapshot_hash = contract_price_snapshots.snapshot_hash); both overloads of
-- gridex_finalize_website_contract_signature do not. The activation failed with 23514 on every customer-operations
-- cron, which also returned 500 for every tenant ("supplier_switch_activation_failed").
--
-- Rule: a signed or active contract carries the hash of its own bound price snapshot (same company, same contract,
-- contract_price_snapshot_id). A BEFORE trigger fills an empty snapshot_hash from exactly that row, on insert and on
-- every update, so both website signing overloads and every already signed website contract (on its next update, such
-- as its activation) get the value staff signing writes. A hash already present is never changed, a snapshot of another
-- contract or company is never used, and without a hashed bound snapshot nothing is filled (the check still refuses).
-- snapshot_hash is not among the columns customer_contracts_lock_signed freezes. No stored row is rewritten here.
begin;

create or replace function public.gridex_fill_contract_snapshot_hash_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- FINDINGS A-B7 (20261027130000): the bound price snapshot's hash, exactly as staff signing writes it.
  select nullif(s.snapshot_hash, '') into new.snapshot_hash
  from public.contract_price_snapshots s
  where s.id = new.contract_price_snapshot_id and s.company_id = new.company_id and s.contract_id = new.id;
  return new;
end
$function$;

revoke all on function public.gridex_fill_contract_snapshot_hash_v1() from public, anon, authenticated;

drop trigger if exists zy_customer_contracts_snapshot_hash_from_price_snapshot_v1 on public.customer_contracts;
create trigger zy_customer_contracts_snapshot_hash_from_price_snapshot_v1
  before insert or update on public.customer_contracts
  for each row
  when (new.contract_price_snapshot_id is not null and nullif(new.snapshot_hash, '') is null and new.status in ('signed', 'active'))
  execute function public.gridex_fill_contract_snapshot_hash_v1();

commit;
