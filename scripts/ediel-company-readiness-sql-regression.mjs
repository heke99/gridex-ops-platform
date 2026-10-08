// Bounded PostgreSQL compatibility regression; not native/full-card or market proof.
// The actual captured readiness, activation and lifecycle functions execute here.
// External evidence/contract producers are isolated, explicit non-authority stubs.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const modulePath = process.env.EDIEL_PGLITE_MODULE
if (!modulePath) throw new Error('EDIEL_PGLITE_MODULE required: pinned @electric-sql/pglite@0.3.14 temporary tooling')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const { evaluateCanonicalActorTestReadiness } = await import(new URL('../lib/ediel/productionReadinessTestAuthority.ts', import.meta.url))
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const db = new PGlite()
const own = '00000000-0000-0000-0000-000000000001'
const foreign = '00000000-0000-0000-0000-000000000002'
const actor = '00000000-0000-0000-0000-000000000003'
const esettBlocker = 'eSett-status är inte klar'
const migrationName = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .find(name => /^\d{14}_company_readiness_optional_esett\.sql$/.test(name))
const skipForward = process.env.EDIEL_READINESS_SKIP_FORWARD === '1'

function capturedFunction(name) {
  const match = schema.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))
  assert.ok(match, `captured function ${name} is required`)
  return match[0]
}

function capturedTableColumns(name) {
  const match = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\(([\\s\\S]*?)\\n\\);`))
  assert.ok(match, `captured table ${name} is required`)
  // Keep actual column names/types. Unrelated constraints/default producers are
  // excluded to isolate this read path; no company eSett column is invented.
  return match[1].split('\n').map(line => line.trim().replace(/,$/, ''))
    .filter(line => line && !line.startsWith('CONSTRAINT '))
    .map(line => line.split(/ DEFAULT | GENERATED /)[0].replace(/ NOT NULL$/, '')
      .replace('public.ediel_environment_type', 'text')).join(',')
}

const previousMigration = readFileSync(new URL('../supabase/migrations/20260815162500_tenant_readiness_truth_convergence.sql', import.meta.url), 'utf8')
const original = previousMigration.slice(0, previousMigration.indexOf('create or replace function public.gridex_tenant_activation_readiness'))
const read = async (company = own) => (await db.query(
  'select public.gridex_company_go_live_readiness($1::uuid) result', [company],
)).rows[0].result
const catalog = async () => (await db.query(`select proowner,proacl::text,prosecdef,provolatile,proconfig,
  pg_get_function_identity_arguments(oid) args from pg_proc
  where oid='public.gridex_company_go_live_readiness(uuid)'::regprocedure`)).rows[0]
let originalCatalog

try {
  await db.exec('create schema auth;create schema extensions;create role anon;create role authenticated;create role service_role;')
  for (const name of ['companies', 'ediel_actor_settings', 'ediel_route_profiles', 'ediel_brp_settings', 'ediel_mailboxes', 'actor_test_results']) {
    await db.exec(`create table public.${name} (${capturedTableColumns(name)});`)
  }
  // Explicit absent-column fixture: the final capture may include the later actor-profile restoration.
  await db.exec('alter table public.companies drop column if exists esett_status;')
  await db.exec(`create table public.company_memberships(company_id uuid,status text,membership_role text);
    create table public.integration_api_clients(company_id uuid,status text,scopes text[],deleted_at timestamptz);
    create table public.tenant_contract_assignments(id uuid,company_id uuid);
    create table public.tenant_contract_channels(assignment_id uuid,channel text);
    create table public.company_onboarding_tasks(company_id uuid,status text);
    create table public.canonical_command_results(company_id uuid,command_type text,idempotency_key text,result_payload jsonb);
    create table public.customer_portal_identities(company_id uuid,status text);
    create table public.regression_evidence(company_id uuid,ready boolean);
    create function public.canonical_ediel_production_evidence_readiness(uuid) returns jsonb
      language sql stable as $$select jsonb_build_object('ready',coalesce((select ready from public.regression_evidence where company_id=$1),false))$$;
    create function public.gridex_contract_platform_readiness_internal_v1(uuid) returns jsonb
      language sql stable as $$select '{}'::jsonb$$;
    create function public.canonical_actor_is_authorized(uuid,uuid,text,boolean) returns boolean
      language sql stable as $$select $1='${own}'::uuid and $2='${actor}'::uuid$$;`)
  await db.exec(original)
  await db.exec(`revoke all on function public.gridex_company_go_live_readiness(uuid) from public,anon,authenticated;
    grant execute on function public.gridex_company_go_live_readiness(uuid) to service_role;`)
  originalCatalog = await catalog()
  await db.query('insert into public.companies(id,status,name,lifecycle_status,lifecycle_state_version) values($1,\'active\',\'synthetic readiness regression\',\'suspended\',7),($2,\'active\',\'synthetic foreign tenant\',\'suspended\',9)', [own, foreign])
  await db.exec(capturedFunction('gridex_tenant_activation_readiness'))
  await db.exec(capturedFunction('canonical_transition_tenant_lifecycle_v4_pre_replay_guard'))
  await db.exec(capturedFunction('canonical_transition_tenant_lifecycle'))

  await test('original captured RPC reproduces missing company field 42703', async () => {
    await assert.rejects(read(), error => error.code === '42703' && error.message === 'record "c" has no field "esett_status"')
  })
  if (!skipForward) {
    assert.ok(migrationName, 'CLI-created forward migration is required')
    await db.exec(readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'))
  }
  await test('missing optional company status returns blocked instead of a SQL exception', async () => {
    const result = await read()
    assert.equal(result.status, 'blocked')
    assert.ok(result.blockers.includes(esettBlocker))
    assert.equal(result.evidence_ready, false)
    assert.equal(result.company_id, own)
    const evaluated = evaluateCanonicalActorTestReadiness(result, 6, 5)
    assert.equal(evaluated.ready, false)
    assert.ok(evaluated.reason.includes(esettBlocker))
  })
  await test('actor eSett ready cannot substitute for missing company authority', async () => {
    await db.query('insert into public.ediel_actor_settings(id,company_id,environment,is_active,actor_role,esett_status) values($1,$2,\'production\',true,\'supplier\',\'ready\')', [actor, own])
    assert.ok((await read()).blockers.includes(esettBlocker))
  })
  await test('actual tenant activation propagates Ediel blockers', async () => {
    const result = (await db.query('select public.gridex_tenant_activation_readiness($1::uuid) result', [own])).rows[0].result
    assert.equal(result.ready, false)
    const blocker = result.blocking_reasons.find(row => row.code === 'tenant_ediel_go_live_not_ready')
    assert.ok(blocker.details.includes(esettBlocker))
    assert.equal(result.ediel.status, 'blocked')
  })
  await test('actual lifecycle activation remains blocked with no company mutation', async () => {
    const before = (await db.query('select to_jsonb(c) row from public.companies c order by id')).rows
    const result = (await db.query('select public.canonical_transition_tenant_lifecycle($1::uuid,\'active\',7,\'synthetic regression\',$2::uuid,\'synthetic-readiness\') result', [own, actor])).rows[0].result
    assert.equal(result.changed, false)
    assert.equal(result.code, 'tenant_not_operationally_ready')
    assert.ok(result.readiness.ediel.blockers.includes(esettBlocker))
    assert.deepEqual((await db.query('select to_jsonb(c) row from public.companies c order by id')).rows, before)
  })
  await test('existing lifecycle actor denial remains enforced', async () => {
    await assert.rejects(db.query('select public.canonical_transition_tenant_lifecycle($1::uuid,\'active\',7,\'synthetic regression\',$2::uuid,\'synthetic-denied\')', [own, foreign]), error => error.code === '42501')
  })
  await test('function ownership, permissions and execution attributes are unchanged', async () => {
    assert.deepEqual(await catalog(), originalCatalog)
    assert.equal((await catalog()).prosecdef, true)
    assert.equal((await catalog()).provolatile, 's')
    const access = (await db.query(`select has_function_privilege('anon','public.gridex_company_go_live_readiness(uuid)','execute') anon,
      has_function_privilege('authenticated','public.gridex_company_go_live_readiness(uuid)','execute') authenticated,
      has_function_privilege('service_role','public.gridex_company_go_live_readiness(uuid)','execute') service`)).rows[0]
    assert.deepEqual(access, { anon: false, authenticated: false, service: true })
  })
  await test('unknown company still returns missing_company', async () => {
    assert.equal((await read('00000000-0000-0000-0000-000000000099')).status, 'missing_company')
  })

  // Historical schemas can still have this column. Compare complete old/new
  // RPC results, not just the changed expression, for independently chosen values.
  await db.exec('alter table public.companies add column esett_status text;')
  for (const [value, blocked] of [[null, true], ['', true], ['pending', true], ['ready', false], ['READY', false], [' ready ', true]]) {
    await test(`historical company status ${JSON.stringify(value)} preserves all original readiness effects`, async () => {
      await db.query('update public.companies set esett_status=$1 where id=$2', [value, own])
      await db.exec(original)
      const before = await read()
      if (!skipForward) await db.exec(readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'))
      const after = await read()
      assert.deepEqual(after, before)
      assert.equal(after.blockers.includes(esettBlocker), blocked)
      assert.equal(after.status, 'blocked') // other real prerequisites remain absent
    })
  }
  await test('another tenant ready status cannot remove the selected tenant blocker', async () => {
    await db.query('update public.companies set esett_status=case when id=$1 then \'ready\' else null end', [foreign])
    assert.ok((await read(own)).blockers.includes(esettBlocker))
    assert.equal((await read(foreign)).blockers.includes(esettBlocker), false)
    assert.equal((await read(foreign)).status, 'blocked')
  })
  // Explicit synthetic external evidence isolates the compatibility check.
  // These rows are never native certification or authorization evidence.
  await db.query(`update public.companies set org_number='synthetic-org',production_ediel_id='synthetic-ediel',
    production_mailbox='synthetic-mailbox',production_application_reference='synthetic-application',esett_status='ready'
    where id=$1`, [own])
  await db.query(`insert into public.ediel_actor_settings(id,company_id,environment,is_active,actor_role)
    values('00000000-0000-0000-0000-000000000004',$1,'test',true,'supplier');
    `, [own])
  await db.query(`insert into public.ediel_route_profiles(id,company_id,actor_setting_id,environment,is_enabled,is_active,message_family,receiver_source)
    values('00000000-0000-0000-0000-000000000005',$1,$2,'production',true,true,'PRODAT','selected_customer_site_grid_owner'),
    ('00000000-0000-0000-0000-000000000006',$1,'00000000-0000-0000-0000-000000000004','test',true,true,'PRODAT','selected_customer_site_grid_owner')`, [own, actor])
  await db.query("insert into public.ediel_brp_settings(company_id,environment,is_active,brp_ediel_id) values($1,'production',true,'synthetic-brp')", [own])
  await db.query('insert into public.regression_evidence(company_id,ready) values($1,true)', [own])
  await test('complete synthetic historical prerequisites retain original ready result and production consumer', async () => {
    await db.exec(original)
    const before = await read()
    if (!skipForward) await db.exec(readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'))
    const after = await read()
    assert.equal(before.status, 'ready')
    assert.deepEqual(after, before)
    assert.deepEqual(after.blockers, [])
    assert.equal(evaluateCanonicalActorTestReadiness(after, 6, 5).ready, true)
  })
  await test('complete evidence and profiles cannot waive missing company eSett status', async () => {
    await db.query('update public.companies set esett_status=null where id=$1', [own])
    const result = await read()
    assert.equal(result.evidence_ready, true)
    assert.equal(result.status, 'blocked')
    assert.deepEqual(result.blockers, [esettBlocker])
    assert.equal(evaluateCanonicalActorTestReadiness(result, 6, 5).ready, false)
    await db.query("update public.companies set esett_status='ready' where id=$1", [own])
  })
  await test('ready company status cannot waive canonical external evidence', async () => {
    await db.query('update public.regression_evidence set ready=false where company_id=$1', [own])
    const result = await read()
    assert.equal(result.status, 'blocked')
    assert.equal(result.evidence_ready, false)
    assert.equal(result.blockers.includes(esettBlocker), false)
    assert.equal(evaluateCanonicalActorTestReadiness(result, 6, 5).ready, false)
    await db.query('update public.regression_evidence set ready=true where company_id=$1', [own])
  })
  await test('foreign tenant production route cannot fulfill the selected company requirement', async () => {
    await db.query("update public.ediel_route_profiles set company_id=$1 where environment='production'", [foreign])
    const result = await read()
    assert.equal(result.has_production_route, false)
    assert.equal(result.status, 'blocked')
    assert.ok(result.blockers.includes('Supplier-bunden PRODAT-produktionsroute saknas'))
    await db.query("update public.ediel_route_profiles set company_id=$1 where environment='production'", [own])
  })
  await test('foreign tenant evidence cannot fulfill the selected company requirement', async () => {
    await db.query('update public.regression_evidence set company_id=$1', [foreign])
    const result = await read()
    assert.equal(result.evidence_ready, false)
    assert.equal(result.status, 'blocked')
    assert.equal(evaluateCanonicalActorTestReadiness(result, 6, 5).ready, false)
  })
  await test('reapplying forward preserves ACLs and all company rows', async () => {
    const before = (await db.query('select to_jsonb(c) row from public.companies c order by id')).rows
    if (!skipForward) await db.exec(readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8'))
    assert.deepEqual(await catalog(), originalCatalog)
    assert.deepEqual((await db.query('select to_jsonb(c) row from public.companies c order by id')).rows, before)
  })
} finally {
  await db.close()
}
