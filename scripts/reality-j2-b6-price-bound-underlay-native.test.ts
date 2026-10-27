// reality-defects: J2-B6
// FINDINGS J2-B6 (reality J2-9, batch 5e): every ready underlay is bound to its exact source basis when stored, and the
// finance guard freezes its pricing_snapshot. gridex_persist_pricing_run wrote its run bookkeeping into that column, so
// a bound underlay could never be priced (billing_source_finalized_underlay_immutable) and a failed run left no trace.
//
// Native proof on the owned local Supabase. It uses an underlay the world bound (scenario J2) and calls the installed
// function inside ONE transaction that is always rolled back: while the installed body predates J2-B6 the refusal is
// shown first, then the migration body is applied inside the same transaction, so the world database never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-j2-b6-price-bound-underlay-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261027120000_j2_b6_price_bound_underlay.sql')
const FN = `'public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure`

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')

type Result = { apply: boolean; before: string | null; failed: Record<string, unknown>; success: Record<string, unknown> }

it('a bound underlay is priced: the run is recorded, the frozen pricing_snapshot stays, readiness and totals are written', () => {
  const result = psql<Result>(`BEGIN;
  CREATE TEMP TABLE j2b6(k text primary key, v jsonb) ON COMMIT DROP;
  SELECT position('J2-B6 (20261027120000)' in prosrc)=0 AS apply FROM pg_proc WHERE oid=${FN} \\gset
  DO $t$ DECLARE u record; before text; BEGIN
    SELECT b.underlay_id id, b.company_id, x.pricing_snapshot INTO STRICT u FROM gridex_billing_source.underlay_bindings b
      JOIN public.billing_underlays x ON x.id=b.underlay_id ORDER BY b.finalized_at LIMIT 1;
    IF (SELECT position('J2-B6 (20261027120000)' in prosrc)=0 FROM pg_proc WHERE oid=${FN}) THEN
      BEGIN PERFORM public.gridex_persist_pricing_run(u.company_id,u.id,'{"status":"failed","errors":["probe"]}'::jsonb,u.pricing_snapshot);
      EXCEPTION WHEN OTHERS THEN before := SQLERRM; END;
    END IF;
    INSERT INTO j2b6 VALUES('before',to_jsonb(before)),('underlay',to_jsonb(u.id::text));
  END $t$;
  \\if :apply
  ${migrationBody}
  \\endif
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
  SELECT jsonb_build_object('apply',:'apply'::boolean,'before',(SELECT v FROM j2b6 WHERE k='before'),
    'failed',(SELECT v FROM j2b6 WHERE k='failed'),'success',(SELECT v FROM j2b6 WHERE k='success'));
  ROLLBACK;`)
  // While the installed body predates J2-B6 it refuses the bound underlay (the defect).
  if (result.apply) expect(result.before).toBe('billing_source_finalized_underlay_immutable')
  expect(result.failed).toEqual({ run_status: 'failed', errors: ['probe'], snapshot_kept: true })
  expect(result.success).toEqual({ run_status: 'success', snapshot_kept: true, readiness: 'ready', invoice_readiness: 'ready_for_invoice', total_inc_vat: 125 })
})
