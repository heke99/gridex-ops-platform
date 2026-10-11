// Actual captured snapshot/auth functions over declared host rows and captured
// tables. PGlite's SHA256 adapter computes real bytes; this is not native
// pgcrypto, concurrent locking, external authorization or full-stack proof.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, afterEach, beforeAll, beforeEach, expect, it} from 'vitest'

const sourceCommit = '56e58b95518ec4d5eef210ba16ba46228afb40ac'
const schema = execFileSync('git', ['show', `${sourceCommit}:supabase/schema.sql`], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024})
const forwardPath = 'supabase/migrations/20261006231122_ediel_test_configuration_route_environment_source.sql'
const signature = 'public.canonical_capture_ediel_test_configuration_snapshot(uuid,uuid,uuid,uuid,text)'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const db = new PGlite()
type Snapshot = {id: string; snapshot_version: number; payload: {test_context: Record<string, unknown>; routes: Array<Record<string, unknown>>}; configuration_hash: string}
let originalMetadata: Record<string, unknown>
let historicalBefore: unknown
let definitionAfterFirst: unknown

function table(name: string) {
  const start = schema.indexOf(`CREATE TABLE public.${name} (`), end = schema.indexOf('\n);', start)
  if (start < 0 || end <= start) throw new Error(`captured_table_missing:${name}`)
  return schema.slice(start, end + 3)
}
function fn(name: string) {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`), end = schema.indexOf('\n--\n', start)
  if (start < 0 || end <= start) throw new Error(`captured_function_missing:${name}`)
  return schema.slice(start, end).trim()
}
async function one<T>(sql: string, params: unknown[] = []) {return (await db.query<T>(sql, params)).rows[0]}
const metadata = () => one<Record<string, unknown>>(`SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid='${signature}'::regprocedure`)
async function capture(company = uid(1), actor = uid(3), profile = uid(11), reason = 'declared unit capture') {
  const row = await one<{snapshot: Snapshot}>(`SELECT to_jsonb(public.canonical_capture_ediel_test_configuration_snapshot($1,$2,$3,$4,$5)) snapshot`,
    [company, actor, uid(10), profile, reason])
  return row.snapshot
}
const effects = () => one(`SELECT jsonb_build_object(
  'snapshots',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.ediel_configuration_snapshots t),
  'runs',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.ediel_test_runs t),
  'results',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.actor_test_results t)) state`)
async function refused(message: string, call = () => capture()) {
  const before = await effects()
  await db.exec('SAVEPOINT refused_capture')
  let error: unknown
  try {await call()} catch (caught) {error = caught}
  await db.exec('ROLLBACK TO SAVEPOINT refused_capture; RELEASE SAVEPOINT refused_capture')
  expect(await effects()).toEqual(before)
  expect(error).toMatchObject({message})
}

beforeAll(async () => {
  expect(createHash('sha256').update(schema).digest('hex')).toBe('8dc63eaab63bae12a267e3e2a45c16c6bdb8d729b26e8e454791b66fcd08f38f')
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE ROLE snapshot_fixture_owner NOLOGIN; CREATE SCHEMA auth; CREATE SCHEMA extensions;
    -- Only this genuine SHA256 specialization is supplied: no fabricated hash.
    CREATE FUNCTION extensions.digest(bytes bytea,algorithm text) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT AS $$
      BEGIN IF algorithm<>'sha256' THEN RAISE EXCEPTION 'unit_sha256_only'; END IF; RETURN pg_catalog.sha256(bytes); END $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
    CREATE TABLE public.user_profiles(id uuid,user_status text);
    CREATE TABLE public.admin_users(user_id uuid,is_active boolean,role text);
    CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean);
    CREATE TABLE public.user_roles(user_id uuid,role_id uuid,company_id uuid,is_active boolean,status text,role text);
    CREATE TABLE public.roles(id uuid,is_active boolean,key text,name text);
    CREATE TABLE public.role_permissions(role_id uuid,permission_id uuid);
    CREATE TABLE public.permissions(id uuid,key text);`)
  const enumStart = schema.indexOf('CREATE TYPE public.ediel_environment_type AS ENUM ('), enumEnd = schema.indexOf('\n);', enumStart)
  await db.exec(schema.slice(enumStart, enumEnd + 3))
  for (const name of ['gridex_normalize_org_number', 'gridex_new_external_tenant_reference', 'gridex_normalize_platform_role',
    'canonical_actor_is_platform_admin', 'canonical_actor_is_authorized']) await db.exec(fn(name))
  const names = ['companies', 'communication_routes', 'ediel_actor_settings', 'ediel_route_profiles', 'ediel_mailboxes',
    'ediel_certificates', 'ediel_rule_versions', 'ediel_configuration_snapshots', 'ediel_test_runs', 'actor_test_results']
  for (const name of names) {
    await db.exec(table(name))
    const primary = schema.match(new RegExp(`ALTER TABLE ONLY public\\.${name}\\s+ADD CONSTRAINT ${name}_pkey PRIMARY KEY \\(id\\);`))
    if (!primary) throw new Error(`captured_primary_key_missing:${name}`)
    await db.exec(primary[0])
  }
  for (const sql of schema.match(/ALTER TABLE ONLY public\.ediel_configuration_snapshots\s+ADD CONSTRAINT ediel_configuration_snapshots_company_(?:hash|version)_key UNIQUE [^;]+;/g) ?? []) await db.exec(sql)
  await db.exec(fn('canonical_capture_ediel_test_configuration_snapshot'))
  for (const sql of schema.split('\n').filter(line => /^(GRANT|REVOKE) /.test(line) && line.includes('FUNCTION public.canonical_capture_ediel_test_configuration_snapshot('))) await db.exec(sql)
  // Distinct declared owner makes metadata preservation nontrivial. Captured
  // authorization predicates still decide from actual tenant permission rows.
  await db.exec(`GRANT USAGE ON SCHEMA public,extensions TO snapshot_fixture_owner;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO snapshot_fixture_owner;
    ALTER FUNCTION ${signature} OWNER TO snapshot_fixture_owner;`)
  // Explicit stored history predates the forward. It supplies no active
  // configuration or approval; whole original row/hash parity is the oracle.
  await db.exec(`INSERT INTO companies(id,name) VALUES('${uid(100)}','Declared historical tenant');
    INSERT INTO ediel_configuration_snapshots(id,company_id,snapshot_version,payload,configuration_hash,reason,created_at)
    SELECT '${uid(101)}','${uid(100)}',7,'{"declaredHistoricalOriginal":{"version":1}}'::jsonb,
      encode(pg_catalog.sha256(convert_to('{"declaredHistoricalOriginal":{"version":1}}'::jsonb::text,'UTF8')),'hex'),
      'declared pre-forward history','2026-01-01';`)
  historicalBefore = await one('SELECT to_jsonb(t) original FROM ediel_configuration_snapshots t WHERE id=$1', [uid(101)])
  originalMetadata = await metadata()
  if (existsSync(forwardPath)) await db.exec(readFileSync(forwardPath, 'utf8'))
  definitionAfterFirst = await one('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])
  // Full migration transactions must finish before per-case rollback scopes.
  if (existsSync(forwardPath)) await db.exec(readFileSync(forwardPath, 'utf8'))
})
afterAll(async () => {await db.close()})
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,name) VALUES('${uid(1)}','Declared own tenant'),('${uid(2)}','Declared foreign tenant');
    INSERT INTO auth.users VALUES('${uid(3)}',NULL,NULL,'2026-01-01'),('${uid(4)}',NULL,NULL,'2026-01-01');
    INSERT INTO user_profiles VALUES('${uid(3)}','active'),('${uid(4)}','active');
    INSERT INTO company_memberships VALUES('${uid(1)}','${uid(3)}','active',true),('${uid(2)}','${uid(4)}','active',true);
    INSERT INTO roles VALUES('${uid(20)}',true,'declared_tenant_role','Declared tenant role');
    INSERT INTO permissions VALUES('${uid(21)}','ediel.profile.write');
    INSERT INTO role_permissions VALUES('${uid(20)}','${uid(21)}');
    INSERT INTO user_roles VALUES('${uid(3)}','${uid(20)}','${uid(1)}',true,'active',NULL),('${uid(4)}','${uid(20)}','${uid(2)}',true,'active',NULL);
    INSERT INTO ediel_actor_settings(id,company_id,actor_name,environment,actor_role,actor_ediel_id,is_active)
      VALUES('${uid(10)}','${uid(1)}','Declared unit supplier','test','electricity_supplier','12345',true);
    INSERT INTO communication_routes(id,company_id,route_name,environment_type)
      VALUES('${uid(12)}','${uid(1)}','Declared selected test source','agt_test');
    INSERT INTO ediel_route_profiles(id,company_id,communication_route_id,environment,sender_ediel_id,receiver_ediel_id,application_reference,message_family,is_active,actor_setting_id)
      VALUES('${uid(11)}','${uid(1)}','${uid(12)}','test','12345','54321','23-DDQ-PRODAT','PRODAT',true,'${uid(10)}');
    INSERT INTO ediel_test_runs(id,company_id,role_code,test_suite,test_case_code,actor_role,message_family,completed_at)
      VALUES('${uid(70)}','${uid(1)}','esco','UTILTS','declared_historical_control','esco','UTILTS','2026-01-01');
    INSERT INTO actor_test_results(id,company_id,test_key,ediel_test_run_id)
      VALUES('${uid(80)}','${uid(1)}','declared_historical_control','${uid(70)}');`)
})
afterEach(async () => {await db.exec('ROLLBACK')})

it.each(['agt_test', 'tgt_test', 'bilateral_test'])('captures the actual same-tenant %s communication route, with the full real hash', async environment => {
  await db.query('UPDATE communication_routes SET environment_type=$1 WHERE id=$2', [environment, uid(12)])
  const result = await capture()
  expect(result.payload.test_context).toMatchObject({environment_type: environment, actor_profile_id: uid(10), route_profile_id: uid(11),
    actor_role: 'supplier', test_ediel_id: '12345', counterparty_ediel_id: '54321', message_family: 'PRODAT', application_reference: '23-DDQ-PRODAT'})
  expect(result.payload.routes).toHaveLength(1)
  expect(result.payload.routes[0]).toMatchObject({id: uid(11), environment: 'test', environment_type: environment})
  const body = await one<{body: string}>('SELECT payload::text body FROM ediel_configuration_snapshots WHERE id=$1', [result.id])
  expect(result.configuration_hash).toBe(createHash('sha256').update(body.body, 'utf8').digest('hex'))
})

it('preserves function OID, owner, ACL, security mode, search path and all other metadata; reapplication is inert', async () => {
  expect(await metadata()).toEqual(originalMetadata)
  const historic = await one('SELECT to_jsonb(t) original FROM ediel_configuration_snapshots t WHERE id=$1', [uid(101)])
  expect(historic).toEqual(historicalBefore)
  expect(await one('SELECT pg_get_functiondef($1::regprocedure) definition', [signature])).toEqual(definitionAfterFirst)
  expect(await one('SELECT to_jsonb(t) original FROM ediel_configuration_snapshots t WHERE id=$1', [uid(101)])).toEqual(historic)
})

it('reuses an identical full snapshot, versions changed source environment and never rewrites historical rows', async () => {
  const first = await capture()
  const before = await effects()
  expect(await capture(uid(1), uid(3), uid(11), 'different caller reason')).toEqual(first)
  expect(await effects()).toEqual(before)
  await db.query("UPDATE communication_routes SET environment_type='tgt_test' WHERE id=$1", [uid(12)])
  const next = await capture()
  expect(next.id).not.toBe(first.id)
  expect(next.snapshot_version).toBe(Number(first.snapshot_version) + 1)
  expect(next.configuration_hash).not.toBe(first.configuration_hash)
  expect(await one('SELECT to_jsonb(t) snapshot FROM ediel_configuration_snapshots t WHERE id=$1', [first.id])).toEqual({snapshot: first})
})

it('retains every own profile and never borrows a foreign/global communication-route environment', async () => {
  await db.exec(`INSERT INTO communication_routes(id,company_id,route_name,environment_type) VALUES
    ('${uid(13)}','${uid(2)}','Declared foreign source','tgt_test'),('${uid(14)}',NULL,'Declared global source','bilateral_test'),
    ('${uid(19)}','${uid(1)}','Declared own production source','production');
    INSERT INTO ediel_route_profiles(id,company_id,communication_route_id,environment,is_active) VALUES
    ('${uid(15)}','${uid(1)}','${uid(13)}','test',false),('${uid(16)}','${uid(1)}','${uid(14)}','test',false),
    ('${uid(17)}','${uid(1)}',NULL,'test',false),('${uid(18)}','${uid(2)}','${uid(13)}','test',true),
    ('${uid(22)}','${uid(1)}','${uid(19)}','production',true);`)
  const result = await capture()
  expect(result.payload.routes.map(row => row.id).sort()).toEqual([uid(11), uid(15), uid(16), uid(17), uid(22)].sort())
  for (const id of [uid(15), uid(16), uid(17)]) expect(result.payload.routes.find(row => row.id === id)).toMatchObject({environment_type: null})
  expect(result.payload.routes.find(row => row.id === uid(22))).toMatchObject({environment: 'production', environment_type: 'production'})
})

it.each([
  ['null linkage', `UPDATE ediel_route_profiles SET communication_route_id=NULL`],
  ['missing physical row', `UPDATE ediel_route_profiles SET communication_route_id='${uid(99)}'`],
  ['foreign tenant', `UPDATE communication_routes SET company_id='${uid(2)}'`],
  ['global route', 'UPDATE communication_routes SET company_id=NULL'],
  ['inactive route', 'UPDATE communication_routes SET is_active=false'],
  ['null environment', 'UPDATE communication_routes SET environment_type=NULL'],
  ['production environment', "UPDATE communication_routes SET environment_type='production'"],
])('refuses selected %s without snapshot or stale-result effects', async (_name, sql) => {
  await db.exec(sql)
  await refused('test_route_communication_source_required')
})

it.each([
  ['disabled profile', 'UPDATE ediel_route_profiles SET is_enabled=false', 'test_route_profile_must_be_active_test_route'],
  ['inactive profile', 'UPDATE ediel_route_profiles SET is_active=false', 'test_route_profile_must_be_active_test_route'],
  ['production profile', "UPDATE ediel_route_profiles SET environment='production'", 'test_route_profile_must_be_active_test_route'],
  ['wrong sender', "UPDATE ediel_route_profiles SET sender_ediel_id='99999'", 'test_route_sender_must_match_actor_profile'],
  ['missing receiver', 'UPDATE ediel_route_profiles SET receiver_ediel_id=NULL', 'test_route_receiver_required'],
  ['foreign actor binding', `UPDATE ediel_route_profiles SET actor_setting_id='${uid(99)}'`, 'test_route_actor_binding_mismatch'],
  ['foreign actor binding and absent source', `UPDATE ediel_route_profiles SET actor_setting_id='${uid(99)}',communication_route_id=NULL`, 'test_route_actor_binding_mismatch'],
])('retains the existing %s refusal with zero effects', async (_name, sql, message) => {
  await db.exec(sql)
  await refused(message)
})

it('refuses a genuine foreign actor and revoked tenant permission through the unchanged authorization predicate', async () => {
  await refused('actor_not_authorized_for_test_configuration_snapshot', () => capture(uid(1), uid(4)))
  await db.exec('UPDATE role_permissions SET permission_id=NULL')
  await refused('actor_not_authorized_for_test_configuration_snapshot')
})

it('refuses a foreign selected profile even when the requested tenant has a genuine permission', async () => {
  await db.query('UPDATE ediel_route_profiles SET company_id=$1 WHERE id=$2', [uid(2), uid(11)])
  await refused('tenant_scoped_test_route_profile_not_found')
})

it('stales only the existing matching role/family scope when a new source snapshot is captured', async () => {
  const first = await capture()
  const controls = [
    [30, uid(1), 'supplier', 'PRODAT', true], [31, uid(1), 'esco', 'PRODAT', true],
    [32, uid(1), 'supplier', 'UTILTS', true], [33, uid(2), 'supplier', 'PRODAT', true],
    [34, uid(1), 'supplier', 'PRODAT', false],
  ] as const
  for (const [id, company, role, family, completed] of controls) {
    await db.query(`INSERT INTO ediel_test_runs(id,company_id,role_code,test_suite,test_case_code,actor_role,message_family,completed_at,configuration_snapshot_id)
      VALUES($1,$2,$3,$4,'declared_unit_run',$3,$4,$5,$6)`, [uid(id), company, role, family, completed ? '2026-01-01' : null, first.id])
    await db.query('INSERT INTO actor_test_results(id,company_id,test_key,ediel_test_run_id) VALUES($1,$2,$3,$4)', [uid(id + 10), company, `declared-${id}`, uid(id)])
  }
  await db.query("UPDATE communication_routes SET environment_type='bilateral_test' WHERE id=$1", [uid(12)])
  await capture()
  const runs = (await db.query<{id: string; is_stale: boolean}>('SELECT id,is_stale FROM ediel_test_runs ORDER BY id')).rows
  expect(runs).toEqual([...controls.map(([id]) => ({id: uid(id), is_stale: id === 30})), {id: uid(70), is_stale: false}])
  const results = (await db.query<{id: string; is_stale: boolean}>('SELECT id,is_stale FROM actor_test_results ORDER BY id')).rows
  // Existing result staleness intentionally includes an unfinished matching
  // run; the original SQL has no completed_at condition in this second update.
  expect(results).toEqual([...controls.map(([id]) => ({id: uid(id + 10), is_stale: id === 30 || id === 34})), {id: uid(80), is_stale: false}])
})
