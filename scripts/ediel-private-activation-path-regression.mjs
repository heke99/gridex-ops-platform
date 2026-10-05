// Targeted execution/configuration mechanics of the actual moved activation
// body. This is not whole native activation, schema replay or acceptance proof.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite()
let checks = 0
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;
  CREATE TABLE public.supplier_switch_requests(id uuid);CREATE TABLE public.customer_application_workflows(id uuid);`)
  const source = readFileSync(new URL('../supabase/migrations/20260725120000_billing_readiness_and_supply_activation_v1.sql', import.meta.url), 'utf8')
  const start = source.indexOf('create or replace function public.activate_customer_supply_v1(')
  assert(start >= 0)
  await db.exec(source.slice(start, source.indexOf('$$;', start) + 3))
  await db.exec(`ALTER FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) SET SCHEMA gridex_received_sources;
  ALTER FUNCTION gridex_received_sources.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) RENAME TO activate_supply_before_source_guard_v1;
  REVOKE ALL ON FUNCTION gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text) FROM PUBLIC,anon,authenticated,service_role;`)
  const metadata = async () => (await db.query("SELECT oid::text,prosrc,proowner,proacl::text,prosecdef,proconfig FROM pg_proc WHERE oid='gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure")).rows[0]
  const before = await metadata()
  assert.deepEqual(before.proconfig, ['search_path=public']);checks++
  const migration = readFileSync(new URL('../supabase/migrations/20261001053742_ediel_private_supply_activation_search_path.sql', import.meta.url), 'utf8')
  await db.exec(migration)
  const after = await metadata()
  assert.deepEqual(after.proconfig, ['search_path=pg_catalog']);checks++
  for (const key of ['oid', 'prosrc', 'proowner', 'proacl', 'prosecdef']) { assert.deepEqual(after[key], before[key]);checks++ }
  await assert.rejects(db.query('SELECT * FROM gridex_received_sources.activate_supply_before_source_guard_v1(NULL,NULL,NULL,NULL,NULL,NULL)'), /supply_activation_company_required/);checks++
  await db.exec('SET ROLE service_role')
  await assert.rejects(db.query('SELECT * FROM gridex_received_sources.activate_supply_before_source_guard_v1(NULL,NULL,NULL,NULL,NULL,NULL)'), /permission denied/);checks++
  await db.exec('RESET ROLE')
  await db.exec(migration)
  assert.deepEqual(await metadata(), after);checks++
  // A changed/unqualified actual body cannot be silently relabelled as safe.
  await db.exec((await db.query("SELECT pg_get_functiondef('gridex_received_sources.activate_supply_before_source_guard_v1(uuid,uuid,uuid,date,uuid,text)'::regprocedure) f")).rows[0].f.replace('from public.supplier_switch_requests', 'from supplier_switch_requests'))
  await assert.rejects(db.exec(migration), /private_supply_activation_relation_qualification_changed:supplier_switch_requests/);checks++
  console.log(JSON.stringify({checks, status:'PASS', scope:'actual moved body, path/body/OID/ACL invariance; no whole native activation'}))
} finally { await db.close() }
