// reality-defects: H-B6b
// FINDINGS H-B6b (reality H11, batch 8): D11g1 qualified a break-fee credit underlay by its own credit row only in
// gridex_read_billing_underlay_source_basis_v1; gridex_create_billing_export_run (after H-B6) still required a metering
// source binding for a credit, so the credit invoice was refused (billing_finalized_source_basis_required).
// Native proof with the world's own credit underlay of scenario H11 (credit 'underlaid', pricing run locked), inside ONE
// transaction that is always rolled back: refused first, then the migration is applied in the same transaction and the
// same call creates the run; an unbound energy underlay is still refused. The world never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-h-b6b-break-fee-credit-export-run-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261027170000_h_b6b_break_fee_credit_invoice_export_run.sql')
const FN = `'public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure`

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')

type Result = { apply: boolean; before: string | null; run: Record<string, unknown> | null; energy: string | null }

it('an underlaid break-fee credit with a locked pricing run becomes an invoice export run; an unbound energy underlay is still refused', () => {
  const result = psql<Result>(`BEGIN;
  CREATE TEMP TABLE hb6b(k text primary key, v jsonb) ON COMMIT DROP;
  GRANT ALL ON hb6b TO service_role;
  SELECT position('H-B6b (20261027170000)' in prosrc)=0 AS apply FROM pg_proc WHERE oid=${FN} \\gset
  -- The world's break-fee underlay (scenario H11) and an item exactly as the invoice preparation sends it.
  INSERT INTO hb6b SELECT 'item', jsonb_build_object('billing_underlay_id',u.id,'contract_id',u.contract_id,'customer_id',u.customer_id,
      'status','ready','readiness_status','ready','payload_snapshot',jsonb_build_object('pricing',jsonb_build_object('pricingRunId',r.id)))
    FROM public.billing_underlays u JOIN public.break_fee_credits ch ON ch.credit_underlay_id=u.id AND ch.company_id=u.company_id
    JOIN public.pricing_runs r ON r.billing_underlay_id=u.id AND r.status='locked'
   WHERE u.payload->>'charge_kind'='break_fee_credit' AND ch.status='underlaid' ORDER BY u.created_at DESC LIMIT 1;
  INSERT INTO hb6b SELECT 'company', to_jsonb(u.company_id::text) FROM public.billing_underlays u WHERE u.id=(SELECT (v->>'billing_underlay_id')::uuid FROM hb6b WHERE k='item');
  -- An energy underlay of another company without a source binding.
  INSERT INTO hb6b SELECT 'energy', jsonb_build_object('company',u.company_id,'item',jsonb_build_object('billing_underlay_id',u.id,'contract_id',u.contract_id,'status','ready'))
    FROM public.billing_underlays u WHERE coalesce(u.payload->>'charge_kind','') NOT IN ('break_fee','break_fee_credit') AND u.contract_id IS NOT NULL
     AND NOT EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.underlay_id=u.id) ORDER BY u.created_at DESC LIMIT 1;
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE before text; BEGIN
    IF (SELECT position('H-B6b (20261027170000)' in prosrc)=0 FROM pg_proc WHERE oid=${FN}) THEN
      BEGIN PERFORM public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v#>>'{}' FROM hb6b WHERE k='company'),'period_month','2026-11','rows_total',1,'rows_ready',1,'status','ready','idempotency_key','hb6b-probe-before'),
        jsonb_build_array((SELECT v FROM hb6b WHERE k='item')));
      EXCEPTION WHEN OTHERS THEN before := SQLERRM; END;
    END IF;
    INSERT INTO hb6b VALUES('before', to_jsonb(before));
  END $t$;
  RESET ROLE;
  \\if :apply
  ${migrationBody}
  \\endif
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE r jsonb; e text; BEGIN
    r := public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v#>>'{}' FROM hb6b WHERE k='company'),'period_month','2026-11','rows_total',1,'rows_ready',1,'status','ready','idempotency_key','hb6b-probe'),
      jsonb_build_array((SELECT v FROM hb6b WHERE k='item')));
    INSERT INTO hb6b VALUES('run', jsonb_build_object('status',r->'status','rows_total',r->'rows_total','items',(SELECT count(*) FROM public.billing_export_run_items i WHERE i.billing_export_run_id=(r->>'id')::uuid)));
    BEGIN PERFORM public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v->>'company' FROM hb6b WHERE k='energy'),'period_month','2026-11','rows_total',1,'idempotency_key','hb6b-energy'),
      jsonb_build_array((SELECT v->'item' FROM hb6b WHERE k='energy')));
    EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
    INSERT INTO hb6b VALUES('energy_result', to_jsonb(e));
  END $t$;
  RESET ROLE;
  SELECT jsonb_build_object('apply',:'apply'::boolean,'before',(SELECT v FROM hb6b WHERE k='before'),'run',(SELECT v FROM hb6b WHERE k='run'),'energy',(SELECT v FROM hb6b WHERE k='energy_result'));
  ROLLBACK;`)
  // While the installed body predates H-B6 the break fee is refused (the defect).
  if (result.apply) expect(result.before).toBe('billing_finalized_source_basis_required')
  expect(result.run).toEqual({ status: 'ready', rows_total: 1, items: 1 })
  expect(result.energy).toBe('billing_finalized_source_basis_required')
})
