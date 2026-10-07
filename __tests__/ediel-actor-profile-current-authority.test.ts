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
const producerForwards = ['supabase/migrations/20261007114453_ediel_actor_profile_immutable_replay.sql',
  'supabase/migrations/20261007114513_ediel_actor_profile_legal_noop_preservation.sql']
const fields = ['market_role', 'brp_name', 'brp_status', 'esett_status', 'technical_contact_name', 'technical_contact_email']
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const databases: PGlite[] = []
const functions = ['gridex_normalize_org_number', 'gridex_new_external_tenant_reference', 'gridex_normalize_platform_role',
  'canonical_actor_is_platform_admin', 'canonical_actor_is_authorized', 'canonical_json_sha256', 'canonical_command_request_hash_guard',
  'canonical_capture_ediel_configuration_snapshot_v1_unchecked', 'canonical_capture_ediel_configuration_snapshot',
  'canonical_save_ediel_actor_profile_v1_unchecked', 'canonical_save_ediel_actor_profile']
const tables = ['companies', 'ediel_actor_settings', 'canonical_ediel_profile_identities', 'canonical_command_results',
  'canonical_audit_events', 'ediel_configuration_snapshots', 'ediel_route_profiles', 'ediel_mailboxes', 'ediel_certificates',
  'ediel_active_test_configurations', 'ediel_rule_versions', 'ediel_rule_packs', 'ediel_message_profiles',
  'ediel_rule_profile_versions', 'company_provisioning_jobs', 'ediel_test_runs', 'actor_test_results', 'ediel_production_readiness_checks', 'ediel_go_live_events', 'ediel_production_state', 'ediel_send_locks']
function declaration(prefix: string, name: string, end: string) {
  const start = schema.indexOf(`${prefix} public.${name}`), stop = schema.indexOf(end, start)
  if (start < 0 || stop <= start) throw new Error(`captured_declaration_missing:${name}`)
  return schema.slice(start, stop + (end === '\n);' ? 3 : 0)).trim()
}
async function one<T>(db: PGlite, sql: string, params: unknown[] = []) {return (await db.query<T>(sql, params)).rows[0]}
async function setup(withLegalTrigger = false) {
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
  for (const name of ['gridex_luhn_valid', 'gridex_normalize_swedish_organization_number']) await db.exec(declaration('CREATE FUNCTION', `${name}(`, '\n--\n'))
  for (const name of tables) await db.exec(declaration('CREATE TABLE', `${name} (`, '\n);'))
  // Exact captured primary/unique constraints make the real ON CONFLICT paths
  // meaningful. No private command-result, identity or accepted evidence seeds.
  for (const sql of schema.match(/ALTER TABLE ONLY public\.[a-z_]+\s+ADD CONSTRAINT [^;]+(?:PRIMARY KEY|UNIQUE) [^;]+;/g) ?? []) {
    if (tables.some(name => sql.startsWith(`ALTER TABLE ONLY public.${name}\n`))) await db.exec(sql)
  }
  for (const name of functions.slice(5)) await db.exec(declaration('CREATE FUNCTION', `${name}(`, '\n--\n'))
  const hashTrigger = schema.match(/CREATE TRIGGER canonical_command_results_request_hash_guard [^;]+;/)
  if (!hashTrigger) throw new Error('captured_command_request_hash_trigger_missing')
  await db.exec(hashTrigger[0])
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
  if (withLegalTrigger) {
    await db.exec(declaration('CREATE TABLE', 'tenant_legal_profiles (', '\n);'))
    for (const sql of schema.match(/ALTER TABLE ONLY public\.tenant_legal_profiles\s+ADD CONSTRAINT [^;]+(?:PRIMARY KEY|UNIQUE) [^;]+;/g) ?? []) await db.exec(sql)
    await db.exec(declaration('CREATE FUNCTION', 'gridex_normalize_country_code(', '\n--\n'))
    await db.exec(declaration('CREATE FUNCTION', 'gridex_normalize_postal_code(p_value text, p_country_code text)', '\n--\n'))
    for (const name of ['gridex_normalize_postal_code', 'gridex_build_canonical_address', 'gridex_company_legal_profile_defaults',
      'gridex_tenant_legal_profile_readiness_status', 'gridex_legal_missing_field_details', 'gridex_rebuild_company_legal_profile',
      'gridex_sync_company_legal_profile_trigger']) await db.exec(declaration('CREATE FUNCTION', `${name}(`, '\n--\n'))
    for (const name of ['gridex_jsonb_valid_email', 'gridex_jsonb_valid_phone', 'gridex_contact_address',
      'gridex_address_complete', 'gridex_legal_contact_complete', 'gridex_billing_information_complete', 'gridex_dispute_information_complete',
      'gridex_tenant_legal_profile_missing_fields',
      'gridex_refresh_legal_profile_completeness']) await db.exec(declaration('CREATE FUNCTION', `${name}(`, '\n--\n'))
    const completeness = schema.match(/CREATE TRIGGER tenant_legal_profiles_completeness [^;]+;/)
    if (!completeness) throw new Error('captured_legal_profile_completeness_trigger_missing')
    await db.exec(completeness[0])
    await db.exec(declaration('CREATE FUNCTION', 'gridex_canonicalize_company_org_number(', '\n--\n'))
    const orgTrigger = schema.match(/CREATE TRIGGER companies_canonical_org_number [^;]+;/)
    if (!orgTrigger) throw new Error('captured_company_org_number_trigger_missing')
    await db.exec(orgTrigger[0])
    await db.exec(declaration('CREATE FUNCTION', 'gridex_validate_company_legal_fields_trigger(', '\n--\n'))
    const validation = schema.match(/CREATE TRIGGER gridex_companies_legal_field_validation [^;]+;/)
    if (!validation) throw new Error('captured_company_legal_validation_trigger_missing')
    await db.exec(validation[0])
    const trigger = schema.match(/CREATE TRIGGER gridex_companies_legal_profile_sync [^;]+;/)
    if (!trigger) throw new Error('captured_company_legal_profile_sync_trigger_missing')
    await db.exec(trigger[0])
    // Actual deterministic projection only: no manual legal override/review or
    // admission state. The genuine company trigger remains enabled throughout.
    await db.exec(`SELECT public.gridex_rebuild_company_legal_profile('${uid(1)}',NULL,false)`)
  }
  return db
}
async function apply(db: PGlite) {for (const path of [forward, ...producerForwards]) if (existsSync(path)) await db.exec(readFileSync(path, 'utf8'))}
async function state(db: PGlite) {
  const rows: Record<string, unknown> = {}
  for (const name of [...tables, 'permissions', 'roles', 'role_permissions', 'user_roles', 'company_memberships']) {
    rows[name] = (await db.query(`SELECT to_jsonb(t) value FROM public.${name} t ORDER BY to_jsonb(t)::text`)).rows
  }
  if ((await one<{present: boolean}>(db, "SELECT to_regclass('public.tenant_legal_profiles') IS NOT NULL present")).present) {
    rows.tenant_legal_profiles = (await db.query('SELECT to_jsonb(t) value FROM tenant_legal_profiles t ORDER BY id')).rows
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
const admission = (db: PGlite) => one(db, `SELECT jsonb_build_object('live',live_ediel_enabled,'status',production_status,
  'approvedBy',live_approved_by,'approvedAt',live_approved_at,'blocked',live_blocked_reason,
  'locks',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM ediel_send_locks l WHERE l.company_id=c.id))
  admission FROM companies c WHERE id=$1`, [uid(1)])
beforeAll(() => {expect(createHash('sha256').update(schema).digest('hex')).toBe('e7b55509430bc0ab2416ffd65120299f74f27201bcd0b239012b2e1bfc85d852')})
afterAll(async () => {for (const db of databases) await db.close()})

it('reproduces the real unchanged public save 42703 before expansion, with actual authorized tenant input and no durable effects', async () => {
  const db = await setup()
  expect(await one(db, `SELECT public.canonical_actor_is_authorized($1,$2,'ediel.profile.write',false) authorized`, [uid(1), uid(3)])).toEqual({authorized: true})
  await refused(db, command(), {code: '42703', message: 'record "v_company" has no field "brp_name"'})
})
it('restores exactly the original six nullable text fields, keeps unknown statuses missing and does not infer identity/contact/evidence', async () => {
  const db = await setup(); await apply(db)
  const columns = (await db.query<{column_name: string; data_type: string; is_nullable: string; column_default: string | null}>(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='companies' AND column_name=ANY($1) ORDER BY column_name`, [fields])).rows
  expect(columns).toHaveLength(6)
  for (const column of columns) expect(column).toMatchObject({data_type: 'text', is_nullable: 'YES',
    column_default: ['brp_status', 'esett_status'].includes(String(column.column_name)) ? "'missing'::text" : null})
  expect(await one(db, 'SELECT market_role,brp_name,brp_status,esett_status,technical_contact_name,technical_contact_email FROM companies WHERE id=$1', [uid(1)]))
    .toEqual({market_role: null, brp_name: null, brp_status: 'missing', esett_status: 'missing', technical_contact_name: null, technical_contact_email: null})
})
it('lets the unchanged public producer persist both independent environment identities, an actual snapshot hash, audit and command receipt', async () => {
  const db = await setup(); await apply(db)
  const admissionBefore = await admission(db)
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
  expect(await admission(db)).toEqual(admissionBefore)
})
it('does not change existing columns, data, authorization or public function metadata, and a second application is inert', async () => {
  const db = await setup(), before = await state(db)
  const metadata = async () => (await db.query(`SELECT CASE WHEN p.proname IN ('canonical_save_ediel_actor_profile','canonical_save_ediel_actor_profile_v1_unchecked')
    THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid`)).rows
  const originalMetadata = await metadata()
  await apply(db)
  const after = await state(db)
  after.companies = (after.companies as Array<{value: Record<string, unknown>}>).map(row => ({value: Object.fromEntries(Object.entries(row.value).filter(([key]) => !fields.includes(key)))}))
  expect(after).toEqual(before); expect(await metadata()).toEqual(originalMetadata)
  // Only the two declared source-slot transformations are allowed, byte for
  // byte. Their inverse restores each captured original function body.
  for (const [index, name] of ['canonical_save_ediel_actor_profile', 'canonical_save_ediel_actor_profile_v1_unchecked'].entries()) {
    const sql = readFileSync(producerForwards[index], 'utf8')
    const oldSlots = [...sql.matchAll(/\$oldslot\$([\s\S]*?)\$oldslot\$/g)].map(match => match[1])
    const newSlots = [...sql.matchAll(/\$newslot\$([\s\S]*?)\$newslot\$/g)].map(match => match[1])
    let expected = declaration('CREATE FUNCTION', `${name}(`, '\n--\n').split('AS $$')[1].split('$$;')[0]
    for (const [slot, old] of oldSlots.entries()) {expect(expected.split(old)).toHaveLength(2); expected = expected.replace(old, newSlots[slot])}
    expect(await one(db, 'SELECT prosrc body FROM pg_proc WHERE oid=$1::regprocedure', [`public.${name}(jsonb)`])).toEqual({body: expected})
  }
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
it('expands a partial old layout without filling existing nulls or replacing its custom defaults and contact', async () => {
  const db = await setup()
  await db.exec(`ALTER TABLE companies ADD COLUMN esett_status text DEFAULT 'declared_old_default';
    ALTER TABLE companies ADD COLUMN technical_contact_email text;
    UPDATE companies SET esett_status=NULL,technical_contact_email='existing@example.invalid' WHERE id='${uid(1)}'`)
  const attrs = async () => (await db.query(`SELECT to_jsonb(a) attribute,pg_get_expr(d.adbin,d.adrelid) default_expr
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid='public.companies'::regclass AND a.attname=ANY($1) ORDER BY a.attnum`, [['esett_status', 'technical_contact_email']])).rows
  const before = await attrs()
  await apply(db); await apply(db)
  expect(await attrs()).toEqual(before)
  expect(await one(db, 'SELECT esett_status,technical_contact_email,brp_status FROM companies WHERE id=$1', [uid(1)]))
    .toEqual({esett_status: null, technical_contact_email: 'existing@example.invalid', brp_status: 'missing'})
})
it('binds actual existing unique profiles and refuses an explicit foreign identity with no durable effects', async () => {
  const db = await setup(); await apply(db)
  await db.exec(`INSERT INTO ediel_actor_settings(id,company_id,environment,actor_name,actor_role,role,actor_ediel_id,is_active) VALUES
    ('${uid(30)}','${uid(1)}','test','Declared test identity','supplier','supplier','12345',true),
    ('${uid(31)}','${uid(1)}','production','Declared production identity','supplier','supplier','67890',true),
    ('${uid(32)}','${uid(2)}','production','Declared foreign identity','supplier','supplier','24680',true)`)
  await refused(db, command({test_profile_id: uid(30), production_profile_id: uid(32)}), {message: 'canonical_profile_identity_mismatch:production'})
  const payload = command({test_profile_id: uid(30), production_profile_id: uid(31)})
  const first = await save(db, payload), before = await state(db)
  expect(await save(db, payload)).toEqual(first); expect(await state(db)).toEqual(before)
  expect((await db.query('SELECT profile_id FROM canonical_ediel_profile_identities ORDER BY profile_id')).rows)
    .toEqual([{profile_id: uid(30)}, {profile_id: uid(31)}])
})
it('rolls back a genuine late public-save constraint failure after the unchecked producer staged its durable effects', async () => {
  const db = await setup(); await apply(db)
  await refused(db, command({production_default_charset: null}), {code: '23502'})
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
it('replays only the historical receipt after current defaults change, without current rebinding or new effects', async () => {
  const db = await setup(); await apply(db)
  const first = await save(db)
  await db.exec(`UPDATE companies SET test_mailbox='changed-current@example.invalid' WHERE id='${uid(1)}';
    UPDATE ediel_actor_settings SET actor_ediel_id='13579' WHERE company_id='${uid(1)}' AND environment='test';
    DELETE FROM canonical_ediel_profile_identities WHERE company_id='${uid(1)}'`)
  const before = await state(db)
  expect(await save(db)).toEqual(first); expect(await state(db)).toEqual(before)
  for (const extra of [{test_profile_id: uid(999)}, {production_primary_route_id: uid(999)}, {test_mailbox: 'changed-request@example.invalid'}]) {
    await refused(db, command(extra), {message: 'idempotency_key_payload_mismatch'})
  }
})
it('still requires current permission and the original actor before returning a historical result', async () => {
  const db = await setup(); await apply(db); await save(db)
  await db.exec(`INSERT INTO company_memberships VALUES('${uid(1)}','${uid(4)}','active',true);
    INSERT INTO user_roles VALUES('${uid(4)}','${uid(20)}','${uid(1)}',true,'active',NULL)`)
  await refused(db, command({actor_user_id: uid(4)}), {message: 'idempotency_actor_mismatch'})
  await db.exec('DELETE FROM role_permissions')
  await refused(db, command(), {message: 'actor_not_authorized_for_ediel_profile'})
})
it('preserves the actual legal projection on an Ediel-only public save with unchanged company legal fields', async () => {
  const db = await setup(true); await apply(db)
  const projection = () => one(db, 'SELECT to_jsonb(t) legal FROM tenant_legal_profiles t WHERE company_id=$1', [uid(1)])
  const before = await projection()
  await save(db)
  expect(await projection()).toEqual(before)
})
it('still invokes the enabled legal projection and completeness triggers on a real legal-field change', async () => {
  const db = await setup(true); await apply(db)
  const before = await one<{hash: string}>(db, 'SELECT source_company_snapshot_sha256 hash FROM tenant_legal_profiles WHERE company_id=$1', [uid(1)])
  await save(db, command({support_email: 'changed-legal@example.invalid'}))
  const row = await one<{email: string; hash: string; status: string; reviewed_at: unknown; review_required: boolean}>(db,
    'SELECT customer_service_email email,source_company_snapshot_sha256 hash,completeness_status status,reviewed_at,review_required FROM tenant_legal_profiles WHERE company_id=$1', [uid(1)])
  expect(row).toMatchObject({email: 'changed-legal@example.invalid', status: 'incomplete', reviewed_at: null, review_required: false})
  expect(row.hash).not.toBe(before.hash)
  expect(await one(db, 'SELECT org_number,organization_number,support_email FROM companies WHERE id=$1', [uid(1)]))
    .toEqual({org_number: null, organization_number: null, support_email: 'changed-legal@example.invalid'})
})
it('rolls back an actual changed legal projection together with profile/identity/snapshot/audit/receipt on late failure', async () => {
  const db = await setup(true); await apply(db)
  await refused(db, command({support_email: 'changed-legal@example.invalid', production_default_charset: null}), {code: '23502'})
})
it('preserves the full legal projection when the genuine validation trigger normalizes a format-only organization-number change', async () => {
  const db = await setup(true); await apply(db)
  await db.exec(`UPDATE companies SET org_number='5560160680' WHERE id='${uid(1)}'`)
  expect(await one(db, 'SELECT org_number FROM companies WHERE id=$1', [uid(1)])).toEqual({org_number: '556016-0680'})
  const projection = () => one(db, 'SELECT to_jsonb(t) legal FROM tenant_legal_profiles t WHERE company_id=$1', [uid(1)])
  const before = await projection()
  await save(db, command({organization_number: '5560160680'}))
  expect(await projection()).toEqual(before)
})
it('retains genuine organization validation and legal sync for changed or invalid organization input', async () => {
  const db = await setup(true); await apply(db)
  await refused(db, command({organization_number: '5560160681'}), {code: '23514', message: 'invalid_swedish_organization_number'})
  await save(db, command({organization_number: '5560160680'}))
  expect(await one(db, 'SELECT org_number FROM companies WHERE id=$1', [uid(1)])).toEqual({org_number: '556016-0680'})
  expect(await one(db, 'SELECT organization_number FROM tenant_legal_profiles WHERE company_id=$1', [uid(1)]))
    .toEqual({organization_number: '556016-0680'})
})
