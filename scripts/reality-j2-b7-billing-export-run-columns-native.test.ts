// reality-defects: J2-B7
// FINDINGS J2-B7 (reality J2-9, batch 5e): gridex_create_billing_export_run inserts billing_export_runs.adapter_key,
// payload_version and retry_policy, which the migration chain never created (20260522 added them only to an existing
// table), so every invoice draft failed with 42703.
//
// Native proof on the owned local Supabase, inside ONE transaction that is always rolled back: while the columns are
// missing the installed function's refusal is shown first, then the migration is applied in the same transaction and
// the same call stores the run with the function's own defaults. The world database never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-j2-b7-billing-export-run-columns-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261027121000_j2_b7_billing_export_run_columns.sql')

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')

it('an invoice draft run is stored with the adapter, payload version and retry policy the function writes', () => {
  const result = psql<{ missing: boolean; before: string | null; run: Record<string, unknown> }>(`BEGIN;
  CREATE TEMP TABLE j2b7(k text primary key, v jsonb) ON COMMIT DROP;
  GRANT ALL ON j2b7 TO service_role;
  SELECT NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_export_runs' AND column_name='adapter_key') AS missing \\gset
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE c uuid; before text; BEGIN
    SELECT id INTO STRICT c FROM public.companies ORDER BY created_at LIMIT 1;
    IF NOT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='billing_export_runs' AND column_name='adapter_key') THEN
      BEGIN PERFORM public.gridex_create_billing_export_run(jsonb_build_object('company_id',c,'period_month','2026-09','rows_total',0,'idempotency_key','j2b7-probe'),'[]'::jsonb);
      EXCEPTION WHEN OTHERS THEN before := SQLERRM; END;
    END IF;
    INSERT INTO j2b7 VALUES('before',to_jsonb(before)),('company',to_jsonb(c::text));
  END $t$;
  RESET ROLE;
  \\if :missing
  ${migrationBody}
  \\endif
  SET LOCAL ROLE service_role;
  DO $t$ DECLARE r jsonb; BEGIN
    r := public.gridex_create_billing_export_run(jsonb_build_object('company_id',(SELECT v#>>'{}' FROM j2b7 WHERE k='company'),'period_month','2026-09','rows_total',0,'idempotency_key','j2b7-probe'),'[]'::jsonb);
    INSERT INTO j2b7 VALUES('run',jsonb_build_object('adapter_key',r->'adapter_key','payload_version',r->'payload_version','retry_policy',r->'retry_policy','status',r->'status'));
  END $t$;
  SELECT jsonb_build_object('missing',:'missing'::boolean,'before',(SELECT v FROM j2b7 WHERE k='before'),'run',(SELECT v FROM j2b7 WHERE k='run'));
  ROLLBACK;`)
  // While the columns are missing the installed function refuses every run (the defect).
  if (result.missing) expect(result.before).toBe('column "adapter_key" of relation "billing_export_runs" does not exist')
  expect(result.run).toEqual({ adapter_key: 'gridex_billing_partner_v1', payload_version: 'billing_export_v4c', retry_policy: { maxAttempts: 3, strategy: 'manual_retry' }, status: 'blocked' })
})
