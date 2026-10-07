// Captured public functions and tables over declared tenant/permission rows.
// PGlite supplies real SHA256 bytes, not native pgcrypto or whole-stack proof.
// These configuration-only tenants have no reviewed legal/business authority;
// this harness does not qualify the rich native fixture's legal triggers.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, beforeAll, expect, it} from 'vitest'

const source = 'c401ae989f8add2f73912746936ced6be2d02708'
const schema = execFileSync('git', ['show', `${source}:supabase/schema.sql`], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024})
const forward = 'supabase/migrations/20261007111843_ediel_actor_profile_current_authority.sql'
const fields = ['market_role', 'brp_name', 'brp_status', 'esett_status', 'technical_contact_name', 'technical_contact_email']
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const databases: PGlite[] = []
const functions = ['gridex_normalize_org_number', 'gridex_new_external_tenant_reference', 'gridex_normalize_platform_role',
  'canonical_actor_is_platform_admin', 'canonical_actor_is_authorized', 'canonical_json_sha256',
  'canonical_capture_ediel_configuration_snapshot_v1_unchecked', 'canonical_capture_ediel_configuration_snapshot',
  'canonical_save_ediel_actor_profile_v1_unchecked', 'canonical_save_ediel_actor_profile']
const tables = ['companies', 'ediel_actor_settings', 'canonical_ediel_profile_identities', 'canonical_command_results',
  'canonical_audit_events', 'ediel_configuration_snapshots', 'ediel_route_profiles', 'ediel_mailboxes', 'ediel_certificates',
  'ediel_active_test_configurations', 'ediel_rule_versions', 'ediel_rule_packs', 'ediel_message_profiles',
  'ediel_rule_profile_versions', 'company_provisioning_jobs', 'ediel_test_runs', 'actor_test_results', 'ediel_production_readiness_checks', 'ediel_go_live_events', 'ediel_production_state']
function declaration(prefix: string, name: string, end: string) {
  const start = schema.indexOf(`${prefix} public.${name}`), stop = schema.indexOf(end, start)
  if (start < 0 || stop <= start) throw new Error(`captured_declaration_missing:${name}`)
  return schema.slice(start, stop + (end === '\n);' ? 3 : 0)).trim()
}
async function one<T>(db: PGlite, sql: string, params: unknown[] = []) {return (await db.query<T>(sql, params)).rows[0]}
async function setup() {
  const db = new PGlite(); databases.push(db)
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE SCHEMA extensions;
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
  await db.exec(declaration('CREATE TYPE', 'ediel_environment_type AS ENUM (', '\n);'))
  for (const name of functions.slice(0, 5)) await db.exec(declaration('CREATE FUNCTION', `${name}(`, '\n--\n'))
  for (const name of tables) await db.exec(declaration('CREATE TABLE', `${name} (`, '\n);'))
  // Exact captured primary/unique constraints make the real ON CONFLICT paths
  // meaningful. No private command-result, identity or accepted evidence seeds.
  for (const sql of schema.match(/ALTER TABLE ONLY public\.[a-z_]+\s+ADD CONSTRAINT [^;]+(?:PRIMARY KEY|UNIQUE) [^;]+;/g) ?? []) {
    if (tables.some(name => sql.startsWith(`ALTER TABLE ONLY public.${name}\n`))) await db.exec(sql)
  }
  for (const name of functions.slice(5)) await db.exec(declaration('CREATE FUNCTION', `${name}(`, '\n--\n'))
  for (const sql of schema.split('\n').filter(line => /^(GRANT|REVOKE) /.test(line) && functions.some(name => line.includes(`FUNCTION public.${name}(`)))) await db.exec(sql)
  await db.exec(`INSERT INTO companies(id,name,actor_role,primary_contact_email) VALUES
    ('${uid(1)}','Declared configuration tenant','supplier','own@example.invalid'),
    ('${uid(2)}','Declared unrelated tenant','grid_owner','foreign@example.invalid');
    INSERT INTO auth.users VALUES('${uid(3)}',NULL,NULL,'2026-01-01'),('${uid(4)}',NULL,NULL,'2026-01-01');
    INSERT INTO user_profiles VALUES('${uid(3)}','active'),('${uid(4)}','active');
    INSERT INTO company_memberships VALUES('${uid(1)}','${uid(3)}','active',true),('${uid(2)}','${uid(4)}','active',true);
    INSERT INTO roles VALUES('${uid(20)}',true,'declared_tenant_role','Declared tenant role');
    INSERT INTO permissions VALUES('${uid(21)}','ediel.profile.write');
    INSERT INTO role_permissions VALUES('${uid(20)}','${uid(21)}');
    INSERT INTO user_roles VALUES('${uid(3)}','${uid(20)}','${uid(1)}',true,'active',NULL),('${uid(4)}','${uid(20)}','${uid(2)}',true,'active',NULL);`)
  return db
}
async function apply(db: PGlite) {if (existsSync(forward)) await db.exec(readFileSync(forward, 'utf8'))}
async function state(db: PGlite) {
  const rows: Record<string, unknown> = {}
  for (const name of [...tables, 'permissions', 'roles', 'role_permissions', 'user_roles', 'company_memberships']) {
    rows[name] = (await db.query(`SELECT to_jsonb(t) value FROM public.${name} t ORDER BY to_jsonb(t)::text`)).rows
  }
  return rows
}
const command = (extra: Record<string, unknown> = {}) => ({company_id: uid(1), actor_user_id: uid(3), idempotency_key: 'declared-profile-1',
  actor_role: 'supplier', company_name: 'Declared configuration tenant', test_ediel_id: '12345', production_ediel_id: '67890',
  test_application_reference: '23-DDQ-PRODAT', production_application_reference: 'APERAK',
  technical_contact_name: 'Declared contact', technical_contact_email: 'own@example.invalid', ...extra})
const save = (db: PGlite, payload = command()) => one<{result: Record<string, unknown>}>(db,
  'SELECT public.canonical_save_ediel_actor_profile($1::jsonb) result', [JSON.stringify(payload)])
async function refused(db: PGlite, payload: ReturnType<typeof command>, expected: Record<string, unknown>) {
  const before = await state(db)
  await db.exec('BEGIN')
  let error: unknown
  try {await save(db, payload)} catch (caught) {error = caught}
  await db.exec('ROLLBACK')
  expect(error).toMatchObject(expected)
  expect(await state(db)).toEqual(before)
}
beforeAll(() => {expect(createHash('sha256').update(schema).digest('hex')).toBe('e7b55509430bc0ab2416ffd65120299f74f27201bcd0b239012b2e1bfc85d852')})
afterAll(async () => {for (const db of databases) await db.close()})

it('reproduces the real unchanged public save 42703 before expansion, with actual authorized tenant input and no durable effects', async () => {
  const db = await setup()
  expect(await one(db, `SELECT public.canonical_actor_is_authorized($1,$2,'ediel.profile.write',false) authorized`, [uid(1), uid(3)])).toEqual({authorized: true})
  await refused(db, command(), {code: '42703', message: 'record "v_company" has no field "brp_name"'})
})
it('restores exactly the original six nullable text fields, keeps unknown statuses missing and does not infer identity/contact/evidence', async () => {
  const db = await setup(); await apply(db)
  const columns = (await db.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name=ANY($1) ORDER BY column_name`, [fields])).rows
  expect(columns).toHaveLength(6)
  for (const column of columns) expect(column).toMatchObject({data_type: 'text', is_nullable: 'YES',
    column_default: ['brp_status', 'esett_status'].includes(String(column.column_name)) ? "'missing'::text" : null})
  expect(await one(db, 'SELECT market_role,brp_name,brp_status,esett_status,technical_contact_name,technical_contact_email FROM companies WHERE id=$1', [uid(1)]))
    .toEqual({market_role: null, brp_name: null, brp_status: 'missing', esett_status: 'missing', technical_contact_name: null, technical_contact_email: null})
})
it('lets the unchanged public producer persist both independent environment identities, an actual snapshot hash, audit and command receipt', async () => {
  const db = await setup(); await apply(db)
  const result = (await save(db)).result
  expect(result).toMatchObject({changed: true, company_id: uid(1), actor_role: 'supplier'})
  const actors = (await db.query('SELECT environment,actor_ediel_id,application_reference,brp_status,esett_status FROM ediel_actor_settings ORDER BY environment')).rows
  expect(actors).toEqual([
    {environment: 'production', actor_ediel_id: '67890', application_reference: 'APERAK', brp_status: 'missing', esett_status: 'missing'},
    {environment: 'test', actor_ediel_id: '12345', application_reference: '23-DDQ-PRODAT', brp_status: 'missing', esett_status: 'missing'}])
  expect((await db.query('SELECT * FROM canonical_ediel_profile_identities')).rows).toHaveLength(2)
  const snapshot = await one<{body: string; configuration_hash: string}>(db, 'SELECT payload::text body,configuration_hash FROM ediel_configuration_snapshots WHERE id=$1', [result.configuration_snapshot_id])
  expect(snapshot.configuration_hash).toBe(createHash('sha256').update(snapshot.body).digest('hex'))
  expect(result.configuration_hash).toBe(snapshot.configuration_hash)
  expect((await db.query('SELECT * FROM canonical_command_results')).rows).toHaveLength(1)
  expect((await db.query('SELECT * FROM canonical_audit_events')).rows).toHaveLength(1)
  expect((await db.query('SELECT * FROM ediel_production_state')).rows).toEqual([])
})
it('does not change existing columns, data, authorization or public function metadata, and a second application is inert', async () => {
  const db = await setup(), before = await state(db)
  const metadata = async () => (await db.query(`SELECT to_jsonb(p) metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`)).rows
  const originalMetadata = await metadata()
  await apply(db)
  const after = await state(db)
  after.companies = (after.companies as Array<{value: Record<string, unknown>}>).map(row => ({value: Object.fromEntries(Object.entries(row.value).filter(([key]) => !fields.includes(key)))}))
  expect(after).toEqual(before); expect(await metadata()).toEqual(originalMetadata)
  const expanded = await state(db)
  await apply(db); expect(await state(db)).toEqual(expanded); expect(await metadata()).toEqual(originalMetadata)
})
it('preserves already expanded definitions, defaults, nulls and stored values rather than replacing upgrade authority', async () => {
  const db = await setup()
  for (const field of fields) await db.exec(`ALTER TABLE companies ADD COLUMN ${field} text DEFAULT 'declared_existing_default'`)
  await db.exec(`UPDATE companies SET brp_status=NULL,esett_status='declared_existing_status',market_role='declared_existing_role' WHERE id='${uid(1)}'`)
  const before = await state(db), metadata = (await db.query("SELECT to_jsonb(a) metadata FROM pg_attribute a WHERE attrelid='public.companies'::regclass ORDER BY attnum")).rows
  await apply(db); await apply(db)
  expect(await state(db)).toEqual(before)
  expect((await db.query("SELECT to_jsonb(a) metadata FROM pg_attribute a WHERE attrelid='public.companies'::regclass ORDER BY attnum")).rows).toEqual(metadata)
})
it('retains tenant authorization failures and rolls back all public-save effects on foreign-company refusal', async () => {
  const db = await setup(); await apply(db)
  await refused(db, command({company_id: uid(2)}), {message: 'actor_not_authorized_for_ediel_profile'})
  await db.exec('DELETE FROM role_permissions')
  await refused(db, command(), {message: 'actor_not_authorized_for_ediel_profile'})
})
it('keeps another tenant untouched and enforces the public identity/payload-bound idempotency contract', async () => {
  const db = await setup(); await apply(db)
  const foreign = await one(db, 'SELECT to_jsonb(c) company FROM companies c WHERE id=$1', [uid(2)])
  const first = await save(db), before = await state(db)
  expect(await save(db)).toEqual(first); expect(await state(db)).toEqual(before)
  expect(await one(db, 'SELECT to_jsonb(c) company FROM companies c WHERE id=$1', [uid(2)])).toEqual(foreign)
  await refused(db, command({production_application_reference: 'CONTRL'}), {message: 'idempotency_key_payload_mismatch'})
})
