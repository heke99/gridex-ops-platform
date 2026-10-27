// reality-defects: H-B6
// FINDINGS H-B6 (reality H11, batch 6): D11 qualified a break-fee underlay by its own approved charge only in
// gridex_read_billing_underlay_source_basis_v1; gridex_create_billing_export_run still required a metering source
// binding (require_underlay_v1) for every ready item, so a break fee could never be invoiced
// (billing_finalized_source_basis_required).
//
// Native proof on the owned local Supabase with the world's own break-fee underlay of scenario H (approved charge
// 'underlaid', pricing run locked), inside ONE transaction that is always rolled back: the installed body refuses first,
// then the migration is applied in the same transaction and the same call creates the run. An energy underlay without
// a binding is still refused. The world never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-h-b6-break-fee-export-run-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261027160000_h_b6_break_fee_invoice_export_run.sql')
const FN = `'public.gridex_create_billing_export_run(jsonb,jsonb)'::regprocedure`

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')

type Result = { apply: boolean; before: string | null; run: Record<string, unknown> | null; energy: string | null }

it('an approved break fee with a locked pricing run becomes an invoice export run; an unbound energy underlay is still refused', () => {
  const result = psql<Result>(`BEGIN;
  CREATE TEMP TABLE hb6(k text primary key, v jsonb) ON COMMIT DROP;
  GRANT ALL ON hb6 TO service_role;
  SELECT position('H-B6 (20261027160000)' in prosrc)=0 AS apply FROM pg_proc WHERE oid=${FN} \\gset
  -- The world's break-fee underlay (scenario H11) and an item exactly as the invoice preparation sends it.
  INSERT INTO hb6 SELECT 'item', jsonb_build_object('billing_underlay_id',u.id,'contract_id',u.contract_id,'customer_id',u.customer_id,
      'status','ready','readiness_status','ready','payload_snapshot',jsonb_build_object('pricing',jsonb_build_object('pricingRunId',r.id)))
    FROM public.billing_underlays u JOIN public.break_fee_charges ch ON ch.billing_underlay_id=u.id AND ch.company_id=u.company_id
    JOIN public.pricing_runs r ON r.billing_underlay_id=u.id AND r.status='locked'
   WHERE u.payload->>'charge_kind'='break_fee' AND ch.status='underlaid' ORDER BY u.created_at DESC LIMIT 1;
  INSERT INTO hb6 SELECT 'company', to_jsonb(u.company_id::text) FROM public.billing_underlays u WHERE u.id=(SELECT (v->>'billing_underlay_id')::uuid FROM hb6 WHERE k='item');
  -- An energy underlay of another company without a source binding.
  INSERT INTO hb6 SELECT 'energy', jsonb_build_object('company',u.company_id,'item',jsonb_build_object('billing_underlay_id',u.id,'contract_id',u.contract_id,'status','ready'))
    FROM public.billing_underlays u WHERE coalesce(u.payload->>'charge_kind','') <> 'break_fee' AND u.contract_id IS NOT NULL
     AND NOT EXISTS(SELECT FROM gridex_billing_source.underlay_bindings b WHERE b.underlay_id=u.id) ORDER BY u.created_at DESC LIMIT 1;
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE before text; BEGIN
    IF (SELECT position('H-B6 (20261027160000)' in prosrc)=0 FROM pg_proc WHERE oid=${FN}) THEN
      BEGIN PERFORM public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v#>>'{}' FROM hb6 WHERE k='company'),'period_month','2026-11','rows_total',1,'rows_ready',1,'status','ready','idempotency_key','hb6-probe-before'),
        jsonb_build_array((SELECT v FROM hb6 WHERE k='item')));
      EXCEPTION WHEN OTHERS THEN before := SQLERRM; END;
    END IF;
    INSERT INTO hb6 VALUES('before', to_jsonb(before));
  END $t$;
  RESET ROLE;
  \\if :apply
  ${migrationBody}
  \\endif
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE r jsonb; e text; BEGIN
    r := public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v#>>'{}' FROM hb6 WHERE k='company'),'period_month','2026-11','rows_total',1,'rows_ready',1,'status','ready','idempotency_key','hb6-probe'),
      jsonb_build_array((SELECT v FROM hb6 WHERE k='item')));
    INSERT INTO hb6 VALUES('run', jsonb_build_object('status',r->'status','rows_total',r->'rows_total','items',(SELECT count(*) FROM public.billing_export_run_items i WHERE i.billing_export_run_id=(r->>'id')::uuid)));
    BEGIN PERFORM public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v->>'company' FROM hb6 WHERE k='energy'),'period_month','2026-11','rows_total',1,'idempotency_key','hb6-energy'),
      jsonb_build_array((SELECT v->'item' FROM hb6 WHERE k='energy')));
    EXCEPTION WHEN OTHERS THEN e := SQLERRM; END;
    INSERT INTO hb6 VALUES('energy_result', to_jsonb(e));
  END $t$;
  RESET ROLE;
  SELECT jsonb_build_object('apply',:'apply'::boolean,'before',(SELECT v FROM hb6 WHERE k='before'),'run',(SELECT v FROM hb6 WHERE k='run'),'energy',(SELECT v FROM hb6 WHERE k='energy_result'));
  ROLLBACK;`)
  // While the installed body predates H-B6 the break fee is refused (the defect).
  if (result.apply) expect(result.before).toBe('billing_finalized_source_basis_required')
  expect(result.run).toEqual({ status: 'ready', rows_total: 1, items: 1 })
  expect(result.energy).toBe('billing_finalized_source_basis_required')
})
