// reality-defects: A-B7
// FINDINGS A-B7 (reality A5, batch 6): website signing never set customer_contracts.snapshot_hash, so the activation of
// a confirmed switch (billing_eligible_at) violated customer_contracts_billing_identity_check and the move-in stayed
// confirmed_by_grid_owner. Staff signing copies the bound price snapshot's hash.
//
// Native proof on the owned local Supabase with the world's own website contract of scenario A: the real activation
// RPC runs inside ONE transaction that is always rolled back. While the trigger is missing it is refused first; then
// the migration is applied in the same transaction and the same RPC activates the switch. The world never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-a-b7-contract-snapshot-hash-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261027130000_a_b7_contract_snapshot_hash_from_bound_price_snapshot.sql')
const TRIGGER = 'zy_customer_contracts_snapshot_hash_from_price_snapshot_v1'

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

type Result = { missing: boolean; contract: string; before: string | null; activation: Record<string, unknown>; after: Record<string, unknown> }

it("a website customer's confirmed switch starting today is activated; the contract carries its bound price snapshot's hash", () => {
  const actor = process.env.GRIDEX_AUTOMATION_USER_ID
  expect(actor, 'GRIDEX_AUTOMATION_USER_ID').toBeTruthy()
  const result = psql<Result>(`BEGIN;
  CREATE TEMP TABLE ab7(k text primary key, v jsonb) ON COMMIT DROP;
  GRANT ALL ON ab7 TO service_role;
  SELECT NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='${TRIGGER}') AS missing \\gset
  -- A website contract whose switch the grid owner confirmed, start today, contract without snapshot_hash.
  INSERT INTO ab7 SELECT 'contract', to_jsonb(c.id::text) FROM public.supplier_switch_requests s
    JOIN public.customer_contracts c ON c.id=s.contract_id AND c.company_id=s.company_id
   WHERE s.status='accepted' AND s.inbound_z04_message_id IS NOT NULL AND s.confirmed_start_date<=(now() AT TIME ZONE 'Europe/Stockholm')::date
     AND nullif(c.snapshot_hash,'') IS NULL AND c.status='signed' ORDER BY s.updated_at DESC LIMIT 1;
  -- Only this switch is due in the sweep below: every other due switch is set aside inside the transaction.
  UPDATE public.supplier_switch_requests SET status='submitted' WHERE status='accepted' AND contract_id::text IS DISTINCT FROM (SELECT v#>>'{}' FROM ab7 WHERE k='contract');
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE before text; BEGIN
    IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='${TRIGGER}') THEN
      BEGIN
        INSERT INTO ab7 VALUES('probe', public.gridex_process_ready_supplier_switch_activations(${literal(actor ?? '')}::uuid, 5));
      EXCEPTION WHEN OTHERS THEN before := SQLERRM; END;
      INSERT INTO ab7 VALUES('before', to_jsonb(coalesce(before, (SELECT v#>>'{failures,0,message}' FROM ab7 WHERE k='probe'))));
    END IF;
  END $t$;
  RESET ROLE;
  \\if :missing
  ${migrationBody}
  \\endif
  SET LOCAL ROLE service_role;
  INSERT INTO ab7 VALUES('activation', public.gridex_process_ready_supplier_switch_activations(${literal(actor ?? '')}::uuid, 5));
  RESET ROLE;
  INSERT INTO ab7 SELECT 'after', jsonb_build_object('contract_status',c.status,'billing_eligible',c.billing_eligible_at IS NOT NULL,
      'hash_is_bound_snapshot',c.snapshot_hash=s.snapshot_hash,
      'periods',(SELECT jsonb_agg(p.status) FROM public.customer_supply_periods p WHERE p.contract_id=c.id))
    FROM public.customer_contracts c JOIN public.contract_price_snapshots s ON s.id=c.contract_price_snapshot_id
   WHERE c.id=(SELECT (v#>>'{}')::uuid FROM ab7 WHERE k='contract');
  SELECT jsonb_build_object('missing',:'missing'::boolean,'contract',(SELECT v FROM ab7 WHERE k='contract'),'before',(SELECT v FROM ab7 WHERE k='before'),
    'activation',(SELECT jsonb_build_object('activated',v->'activated','failed',v->'failed') FROM ab7 WHERE k='activation'),'after',(SELECT v FROM ab7 WHERE k='after'));
  ROLLBACK;`)
  expect(result.contract, 'the world has a confirmed website switch due today (scenario A)').toBeTruthy()
  // While the trigger is missing the activation is refused by the billing identity check (the defect).
  if (result.missing) expect(result.before).toContain('customer_contracts_billing_identity_check')
  expect(result.activation).toEqual({ activated: 1, failed: 0 })
  expect(result.after).toMatchObject({ billing_eligible: true, hash_is_bound_snapshot: true, periods: ['active'] })
})
