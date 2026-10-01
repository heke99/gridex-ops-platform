// Exact prepared rollback proof only; no native restore or external Auth.
const assert = require('node:assert/strict')
const { spawnSync, execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { test } = require('node:test')
const { PGlite } = require('@electric-sql/pglite')
const pinned = 'ae56ee0a1e0e8adbce9d5f4d92da75cdcb8010c8'
const root = resolve(__dirname, '..')
const script = join(__dirname, 'tenantservice-baseline-rollback-20261001.sh')
const source = () => readFileSync(script, 'utf8')
const stages = ['IDENTITY', 'OWN_READ', 'FOREIGN_READ', 'RAW_WRITE_DENIAL', 'COMMAND_DENIAL']

function actualWrapper(log, status = 1) {
  const temporary = mkdtempSync(join(tmpdir(), 'baseline-authenticated-diagnostic.'))
  try {
    const helper = source().match(/  tenantservice_baseline_sql\(\)\{[\s\S]*?^  \}/m)?.[0]
    assert.ok(helper, 'actual private SQL wrapper missing')
    const payload = join(temporary, 'private-payload.log')
    writeFileSync(payload, log, { mode: 0o600 })
    return spawnSync('bash', ['-c', `set -euo pipefail
TENANTSERVICE_TEMP="$1"; PRIVATE_PAYLOAD="$2"; SYNTHETIC_STATUS="$3"
psql(){ cat "$PRIVATE_PAYLOAD"; return "$SYNTHETIC_STATUS"; }
${helper}
tenantservice_baseline_sql postgresql://PRIVATE_CANARY.invalid/private old-schema-proof.sql
`, 'diagnostic', temporary, payload, String(status)], { encoding: 'utf8', timeout: 5000 })
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}

for (const stage of stages) test('actual wrapper closes private P0001 to authenticated ' + stage, () => {
  const result = actualWrapper('TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED\n' +
    'TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED_' + stage + '\n' +
    'psql:/PRIVATE_CANARY.sql:47: ERROR:  P0001\nCONTEXT: PRIVATE_CANARY\n')
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, new RegExp('proof=old_schema stage=old_authenticated_' + stage.toLowerCase() + ' sqlstate=P0001'))
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CANARY|CONTEXT:|\.sql|postgresql:/)
})

test('unknown stage and free NOTICE text cannot become diagnostic labels', () => {
  const result = actualWrapper('TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED\n' +
    'TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED_PRIVATE_CANARY\n' +
    'NOTICE: PRIVATE_CANARY\nERROR:  P0001\n')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /proof=old_schema stage=old_authenticated sqlstate=P0001/)
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CANARY|NOTICE:/)
})

test('successful wrapper still suppresses every stage and returns only original fixed PASS', () => {
  const result = actualWrapper(stages.map(stage => 'TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED_' + stage).join('\n') +
    '\nPRIVATE_CANARY\nTENANTSERVICE_BASELINE_ROLLBACK_OLD_RLS_LOW_ROLE_DENIAL_PASS\n', 0)
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.equal(result.stdout, 'TENANTSERVICE_BASELINE_ROLLBACK_OLD_RLS_LOW_ROLE_DENIAL_PASS\n')
})

test('all five exact assertion blocks remain after the same request claims and installed role', () => {
  const current = source()
  const region = current.slice(current.indexOf("select set_config('request.jwt.claims',jsonb_build_object('role','authenticated'"),
    current.indexOf("select set_config('request.jwt.claims','{\"role\":\"anon\"}'"))
  assert.ok(region.indexOf('set local role authenticated;') < region.indexOf('STAGE_OLD_AUTHENTICATED_IDENTITY'))
  for (const stage of stages) assert.equal(region.split('\\echo TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED_' + stage + '\n').length, 2)
  assert.equal((region.match(/exception when insufficient_privilege then denied:=true; end;/g) || []).length, 2)
  for (const message of ['baseline_rollback_old_tenant_read_rls_failed', 'baseline_rollback_authenticated_raw_write_not_denied',
    'baseline_rollback_authenticated_command_not_denied']) assert.ok(region.includes(message))
  assert.match(region, /reset role;\n$/)
  assert.equal((current.match(/^begin;$/gm) || []).length, 1)
  assert.equal((current.match(/^rollback;$/gm) || []).length, 1)
  assert.doesNotMatch(region, /\b(?:grant|revoke|alter policy|disable trigger|commit|rollback)\b/i)
})

const old = path => execFileSync('git', ['show', pinned + ':' + path], { cwd: root, encoding: 'utf8', maxBuffer: 30_000_000 })
function exactFunction(text, name) {
  const escaped = name.replaceAll('.', '\\.')
  const start = new RegExp('(?:CREATE FUNCTION|create or replace function) ' + escaped + '\\(').exec(text)?.index
  assert.notEqual(start, undefined, 'pinned function missing: ' + name)
  const delimiter = /\b(?:AS|as) (\$\w*\$)/.exec(text.slice(start))
  assert.ok(delimiter, 'pinned function delimiter missing: ' + name)
  const body = start + delimiter.index + delimiter[0].length
  const stop = text.indexOf(delimiter[1] + ';', body)
  assert.ok(stop > body, 'pinned function end missing: ' + name)
  return text.slice(start, stop + delimiter[1].length + 1)
}
function exactTable(text, schema, name) {
  const statement = new RegExp('(?:CREATE TABLE|create table if not exists) ' + schema + '\\.' + name + ' \\([\\s\\S]*?\\n\\);').exec(text)?.[0]
  assert.ok(statement, 'pinned table missing: ' + schema + '.' + name)
  return statement
}
function authenticatedRegion() {
  const proof = source().match(/<<'OLD_SCHEMA_PROOF'\n([\s\S]*?)\nOLD_SCHEMA_PROOF/)?.[1]
  assert.ok(proof, 'exact embedded old proof missing')
  const start = proof.indexOf("select set_config('request.jwt.claims',jsonb_build_object('role','authenticated'")
  const stop = proof.indexOf('reset role;', start)
  assert.ok(start > 0 && stop > start)
  return proof.slice(start, stop).replace(/ as jwt_claims \\gset/g, ';')
}
async function executeRegion(db, region) {
  let stage = 'request_setup'
  const passed = []
  for (const part of region.split(/^\\echo /m)) {
    const split = part.indexOf('\n')
    let sql = part
    if (part.startsWith('TENANTSERVICE_BASELINE_ROLLBACK_STAGE_')) {
      stage = part.slice(0, split).replace('TENANTSERVICE_BASELINE_ROLLBACK_STAGE_', '')
      sql = part.slice(split + 1)
    }
    try { if (sql.trim()) await db.exec(sql); passed.push(stage) }
    catch (error) { return { stage, code: error.code, message: error.message, passed } }
  }
  return { stage, code: null, passed }
}

// Uses exact pinned public DDL, helpers, grants/RLS, customer UPDATE trigger,
// and the actual prepared fixture rows. Auth request helpers/users/sessions are
// exact checked-in compatible bootstrap fragments, not native GoTrue evidence.
async function pinnedFixture() {
  const db = new PGlite()
  let setupStage = 'schemas'
  try {
    const schema = old('supabase/schema.sql')
    const bootstrap = old('scripts/sql/gridex-supabase-compatible-bootstrap.sql')
    await db.exec('create role authenticated; create role anon; create role service_role; create schema auth; create schema private; create schema extensions;')
    for (const name of ['auth.uid', 'auth.role', 'auth.jwt']) { setupStage = name; await db.exec(exactFunction(bootstrap, name)) }
    for (const name of ['users', 'sessions']) { setupStage = 'auth_' + name; await db.exec(exactTable(bootstrap, 'auth', name)) }
    // The genuine prepared old fixture inserts this native GoTrue column; the
    // pinned compatible bootstrap deliberately guarantees a smaller surface.
    // This typed outer field is unused by the pinned tenant/identity helpers.
    await db.exec('alter table auth.users add column is_sso_user boolean not null default false;')
    for (const name of ['gridex_normalize_email', 'gridex_normalize_phone', 'gridex_normalize_org_number',
      'gridex_normalize_personal_number', 'gridex_new_public_resource_reference', 'gridex_new_external_tenant_reference']) {
      setupStage = name; await db.exec(exactFunction(schema, 'public.' + name))
    }
    for (const name of ['companies', 'customers', 'company_memberships', 'user_profiles', 'admin_users', 'user_roles',
      'roles', 'customer_contacts', 'canonical_command_results', 'customer_portal_completions']) {
      setupStage = name; await db.exec(exactTable(schema, 'public', name))
    }
    // Required for the exact compatible sessions FK, and canonical customer RLS.
    // These primary keys are the actual pinned/bootstrap schema declarations.
    const primary = schema.match(/ALTER TABLE ONLY public\.customers\n\s+ADD CONSTRAINT customers_pkey PRIMARY KEY \(id\);/)?.[0]
    assert.ok(primary, 'actual pinned customer primary key missing')
    await db.exec(primary)
    for (const name of ['gridex_normalize_platform_role', 'gridex_is_current_session_allowed', 'gridex_user_is_platform_admin',
      'gridex_user_company_ids', 'gridex_can_read_company', 'gridex_can_write_company']) {
      setupStage = name; await db.exec(exactFunction(schema, 'public.' + name))
    }
    const fixture = readFileSync(join(__dirname, 'sql/tenantservice-upgrade-fixture.sql'), 'utf8')
    for (const name of ['public.companies', 'auth.users', 'public.user_profiles', 'auth.sessions', 'public.company_memberships', 'public.customers']) {
      const statement = fixture.match(new RegExp('insert into ' + name.replaceAll('.', '\\.') + '\\([\\s\\S]*?;'))?.[0]
      assert.ok(statement, 'actual prepared fixture INSERT missing: ' + name)
      setupStage = 'seed_' + name.replaceAll('.', '_'); await db.exec(statement)
    }
    // Only this customer trigger fires for the exact email-only UPDATE. Its
    // retained metadata source predicate returns before partner dispatch.
    const event = old('supabase/migrations/20260816170000_partner_api_v1_canonical_surface_events.sql')
    setupStage = 'partner_trigger'; await db.exec(exactFunction(event, 'private.gridex_partner_customer_event_v2'))
    const trigger = schema.match(/CREATE TRIGGER customers_partner_api_events_v2[^;]+;/)?.[0]
    assert.ok(trigger, 'actual email UPDATE trigger missing')
    await db.exec(trigger)
    setupStage = 'customer_policies'
    const policies = schema.match(/CREATE POLICY [^;]+ ON public\.customers [^;]+;/g) || []
    assert.equal(policies.length, 10, 'pinned customer policy inventory changed')
    for (const policy of policies) await db.exec(policy)
    const rls = schema.match(/ALTER TABLE (?:ONLY )?public\.customers (?:ENABLE|FORCE) ROW LEVEL SECURITY;/g) || []
    assert.ok(rls.length, 'pinned customer RLS missing')
    for (const statement of rls) await db.exec(statement)
    const tableGrants = schema.match(/(?:GRANT|REVOKE) [^;]+ ON TABLE public\.customers [^;]+;/g) || []
    assert.ok(tableGrants.length, 'pinned customer ACL missing')
    for (const statement of tableGrants) await db.exec(statement)
    const authUsage = bootstrap.match(/grant usage on schema auth[^;]+;/i)?.[0]
    assert.ok(authUsage, 'pinned compatible auth schema usage missing')
    await db.exec(authUsage)
    const contact = old('supabase/migrations/20260928213000_secondary_contact_atomic_command.sql')
    await db.exec(contact)
    return db
  } catch (error) {
    await db.close()
    // Fixture construction is not a raw-error logging proof or product RED.
    throw new Error('pinned_authenticated_fixture_setup_failed stage=' + setupStage + ' code=' + (error.code || 'unknown'))
  }
}

async function fixtureHashes(db) {
  const hashes = {}
  for (const table of ['auth.users', 'auth.sessions', 'public.companies', 'public.customers', 'public.company_memberships',
    'public.user_profiles', 'public.admin_users', 'public.user_roles', 'public.roles', 'public.customer_contacts',
    'public.canonical_command_results', 'public.customer_portal_completions']) {
    hashes[table] = (await db.query(`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text,'UTF8')),'hex') hash from ${table} t`)).rows[0].hash
  }
  return hashes
}

test('exact authenticated prepared corridor locates a bounded old-schema raw-write assertion failure and rolls back', async () => {
  const db = await pinnedFixture()
  try {
    const before = await fixtureHashes(db)
    await db.exec('begin;')
    const outcome = await executeRegion(db, authenticatedRegion())
    assert.equal(outcome.stage, 'OLD_AUTHENTICATED_RAW_WRITE_DENIAL')
    assert.equal(outcome.code, 'P0001')
    assert.equal(outcome.message, 'baseline_rollback_authenticated_raw_write_not_denied')
    for (const stage of ['OLD_AUTHENTICATED_IDENTITY', 'OLD_AUTHENTICATED_OWN_READ', 'OLD_AUTHENTICATED_FOREIGN_READ']) {
      assert.ok(outcome.passed.includes(stage))
    }
    await db.exec('rollback;')
    assert.deepEqual(await fixtureHashes(db), before)
    assert.equal((await db.query('select current_user role')).rows[0].role, 'postgres')
  } finally { await db.close() }
})

test('same exact prepared command-denial assertion separately passes the pinned service-only RPC ACL', async () => {
  const db = await pinnedFixture()
  try {
    const before = await fixtureHashes(db)
    await db.exec('begin;')
    const region = authenticatedRegion()
    const setup = region.slice(0, region.indexOf('\\echo '))
    await db.exec(setup)
    const command = region.slice(region.indexOf('\\echo TENANTSERVICE_BASELINE_ROLLBACK_STAGE_OLD_AUTHENTICATED_COMMAND_DENIAL'))
    const outcome = await executeRegion(db, command)
    assert.equal(outcome.code, null)
    assert.equal(outcome.stage, 'OLD_AUTHENTICATED_COMMAND_DENIAL')
    await db.exec('rollback;')
    assert.deepEqual(await fixtureHashes(db), before)
    assert.equal((await db.query('select current_user role')).rows[0].role, 'postgres')
  } finally { await db.close() }
})
