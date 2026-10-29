// reality-defects: J2-B6
// FINDINGS J2-B6 (reality J2-9, batch 5e): every ready underlay is bound to its exact source basis when stored, and the
// finance guard freezes its pricing_snapshot. gridex_persist_pricing_run wrote its run bookkeeping into that column, so
// a bound underlay could never be priced (billing_source_finalized_underlay_immutable) and a failed run left no trace.
//
// Delivered by main's 20261023232114_preserve_qualified_underlay_pricing_snapshot (the same rule, plus a refusal of a
// snapshot that differs from the bound underlay's); the branch's own 20261027120000 was dropped at the main integration.
// Native proof on the owned local Supabase. It uses an underlay the world bound (scenario J2) and calls the installed
// function inside ONE transaction that is always rolled back, so the world database never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-j2-b6-price-bound-underlay-native.config.ts
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const FN = `'public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure`

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
type Result = { mainRule: boolean; failed: Record<string, unknown>; success: Record<string, unknown> }

it('a bound underlay is priced: the run is recorded, the frozen pricing_snapshot stays, readiness and totals are written', () => {
  const result = psql<Result>(`BEGIN;
  CREATE TEMP TABLE j2b6(k text primary key, v jsonb) ON COMMIT DROP;
  DO $t$ DECLARE u record; BEGIN
    SELECT b.underlay_id id INTO STRICT u FROM gridex_billing_source.underlay_bindings b ORDER BY b.finalized_at LIMIT 1;
    INSERT INTO j2b6 VALUES('underlay',to_jsonb(u.id::text));
  END $t$;
  DO $t$ DECLARE u record; run uuid; BEGIN
    SELECT x.id, x.company_id, x.pricing_snapshot INTO STRICT u FROM public.billing_underlays x WHERE x.id=(SELECT (v#>>'{}')::uuid FROM j2b6 WHERE k='underlay');
    run := public.gridex_persist_pricing_run(u.company_id,u.id,'{"status":"failed","errors":["probe"]}'::jsonb,u.pricing_snapshot);
    INSERT INTO j2b6 SELECT 'failed', jsonb_build_object('run_status',r.status,'errors',r.errors,'snapshot_kept',x.pricing_snapshot=u.pricing_snapshot)
      FROM public.pricing_runs r, public.billing_underlays x WHERE r.id=run AND x.id=u.id;
    run := public.gridex_persist_pricing_run(u.company_id,u.id,'{"status":"success","total_ex_vat":100,"vat_amount":25,"total_inc_vat":125,"lines":[]}'::jsonb,u.pricing_snapshot);
    INSERT INTO j2b6 SELECT 'success', jsonb_build_object('run_status',r.status,'snapshot_kept',x.pricing_snapshot=u.pricing_snapshot,
      'readiness',x.readiness_status,'invoice_readiness',x.invoice_readiness_status,'total_inc_vat',x.calculated_total_sek_inc_vat)
      FROM public.pricing_runs r, public.billing_underlays x WHERE r.id=run AND x.id=u.id;
  END $t$;
  SELECT jsonb_build_object('mainRule',(SELECT position('v_source_bound' in prosrc)>0 FROM pg_proc WHERE oid=${FN}),'failed',(SELECT v FROM j2b6 WHERE k='failed'),'success',(SELECT v FROM j2b6 WHERE k='success'));
  ROLLBACK;`)
  // The installed body is main's 20261023232114 rule (v_source_bound), not the dropped branch migration.
  expect(result.mainRule).toBe(true)
  expect(result.failed).toEqual({ run_status: 'failed', errors: ['probe'], snapshot_kept: true })
  expect(result.success).toEqual({ run_status: 'success', snapshot_kept: true, readiness: 'ready', invoice_readiness: 'ready_for_invoice', total_inc_vat: 125 })
})
