// Finite SQL boundary only: captured functions and real constraints consume
// explicitly declared relational hosts. Certification/readiness rows below
// are component inputs, never authentic external approvals or native evidence.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll, afterEach, beforeAll, beforeEach, expect, it} from 'vitest'

const schema = execFileSync('git', ['show', '56e58b95518ec4d5eef210ba16ba46228afb40ac:supabase/schema.sql'], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024})
const forwardPath = 'supabase/migrations/20261006235632_ediel_checked_production_capability_convergence.sql'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const db = new PGlite()
const signatures = ['public.canonical_transition_ediel_production(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text)',
  'public.canonical_transition_ediel_production_v1_unchecked(uuid,text,bigint,uuid,uuid,uuid,text,uuid,text)']
let metadataBefore: unknown
let definitionsAfterFirst: unknown
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
async function effectRows() {
  const result: Record<string, unknown> = {}
  for (const name of ['companies', 'company_capabilities', 'ediel_production_state', 'ediel_send_locks',
    'canonical_command_results', 'canonical_audit_events', 'canonical_domain_events', 'canonical_event_outbox', 'ediel_go_live_events']) {
    result[name] = (await db.query(`SELECT to_jsonb(t) row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows
  }
  return result
}
const capability = () => one<Record<string, unknown>>("SELECT to_jsonb(c) row FROM company_capabilities c WHERE company_id=$1 AND capability_code='ediel_production'", [uid(1)])
const operation = () => one<Record<string, unknown>>("SELECT * FROM canonical_tenant_operation_decision($1,'ediel.production.send')", [uid(1)])
const transition = (target: string, version: number, key: string) => one<{result: Record<string, unknown>}>(
  'SELECT canonical_transition_ediel_production($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
  [uid(1), target, version, uid(5), uid(6), uid(7), 'declared component transition', uid(3), key])
const lock = () => one<{row: Record<string, unknown>}>('SELECT to_jsonb(l) row FROM ediel_send_locks l WHERE company_id=$1 AND environment=\'production\'', [uid(1)])
const functionMetadata = () => db.query("SELECT to_jsonb(p)-'prosrc' metadata FROM pg_proc p WHERE oid=ANY($1::regprocedure[]) ORDER BY oid", [signatures])
const definitions = () => db.query('SELECT pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [signatures])

beforeAll(async () => {
  expect(createHash('sha256').update(schema).digest('hex')).toBe('8dc63eaab63bae12a267e3e2a45c16c6bdb8d729b26e8e454791b66fcd08f38f')
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA private;
    -- Genuine builtin SHA256 specialization; no constant/fabricated digest.
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
  for (const name of ['gridex_normalize_org_number', 'gridex_new_external_tenant_reference', 'gridex_normalize_platform_role',
    'canonical_actor_is_platform_admin', 'canonical_actor_is_authorized', 'canonical_json_sha256', 'canonical_current_ediel_engine_schema_version']) await db.exec(fn(name))
  const names = ['companies', 'company_capabilities', 'ediel_production_state', 'ediel_production_readiness_checks', 'ediel_go_live_events',
    'canonical_command_results', 'canonical_audit_events', 'canonical_domain_events', 'canonical_event_outbox',
    'ediel_certification_evidence', 'canonical_ediel_profile_identities', 'ediel_configuration_snapshots',
    'ediel_actor_settings', 'ediel_route_profiles', 'ediel_messages', 'ediel_send_locks', 'ediel_outbox']
  for (const name of names) {
    await db.exec(table(name))
    for (const sql of schema.match(new RegExp(`ALTER TABLE ONLY public\\.${name}\\s+ADD CONSTRAINT [^;]+(?:PRIMARY KEY|UNIQUE) [^;]+;`, 'g')) ?? []) await db.exec(sql)
  }
  const activeKeyIndex = schema.split('\n').find(line => line.startsWith('CREATE UNIQUE INDEX ediel_send_locks_active_key_uidx '))
  const unlockForeignKey = schema.match(/ALTER TABLE ONLY public\.ediel_send_locks\s+ADD CONSTRAINT ediel_send_locks_unlocked_by_fkey [^;]+;/)
  if (!activeKeyIndex || !unlockForeignKey) throw new Error('captured_lock_index_and_unlock_foreign_key_required')
  await db.exec(activeKeyIndex)
  await db.exec(unlockForeignKey[0])
  for (const name of ['canonical_seed_company_capabilities', 'canonical_company_capability_seed_trigger', 'canonical_command_request_hash_guard',
    'canonical_enforce_company_ediel_projection_v1', 'canonical_sync_company_ediel_projection_v1',
    'canonical_company_readiness', 'canonical_ediel_production_evidence_readiness', 'canonical_tenant_operation_decision',
    'canonical_transition_ediel_production_v1_unchecked', 'canonical_transition_ediel_production']) await db.exec(fn(name))
  for (const name of ['canonical_transition_ediel_production', 'canonical_transition_ediel_production_v1_unchecked']) {
    for (const sql of schema.split('\n').filter(line => /^(GRANT|REVOKE) /.test(line) && line.includes(`FUNCTION public.${name}(`))) await db.exec(sql)
  }
  for (const name of ['companies_canonical_capability_seed', 'canonical_command_results_request_hash_guard',
    'companies_enforce_canonical_ediel_projection', 'ediel_production_state_sync_company_projection']) {
    const sql = schema.split('\n').find(line => line.startsWith(`CREATE TRIGGER ${name} `))
    if (!sql) throw new Error(`captured_trigger_missing:${name}`)
    await db.exec(sql)
  }
  // Private bodies are excluded from the schema capture; install their whole
  // immutable definitions and existing trigger declarations without alteration.
  for (const path of ['supabase/migrations/20260903160000_ediel_send_lock_state_convergence.sql',
    'supabase/migrations/20260903161000_ediel_send_lock_release_requeues_outbox.sql']) {
    const source = readFileSync(path, 'utf8')
    const start = source.indexOf('create or replace function private.'), end = source.indexOf('\n$$;', start)
    if (start < 0 || end <= start) throw new Error(`captured_private_function_missing:${path}`)
    await db.exec(source.slice(start, end + 4))
  }
  for (const name of ['ediel_send_lock_state_convergence', 'ediel_requeue_outbox_after_send_lock_release']) {
    const sql = schema.split('\n').find(line => line.startsWith(`CREATE TRIGGER ${name} `))
    if (!sql) throw new Error(`captured_trigger_missing:${name}`)
    await db.exec(sql)
  }
  metadataBefore = (await functionMetadata()).rows
  if (existsSync(forwardPath)) await db.exec(readFileSync(forwardPath, 'utf8'))
  definitionsAfterFirst = (await definitions()).rows
  if (existsSync(forwardPath)) await db.exec(readFileSync(forwardPath, 'utf8'))
})
afterAll(async () => {await db.close()})
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO companies(id,name) VALUES('${uid(1)}','Declared own component tenant'),('${uid(2)}','Declared foreign component tenant');
    INSERT INTO auth.users VALUES('${uid(3)}',NULL,NULL,'2026-01-01');
    INSERT INTO user_profiles VALUES('${uid(3)}','active');
    INSERT INTO company_memberships VALUES('${uid(1)}','${uid(3)}','active',true);
    INSERT INTO roles VALUES('${uid(20)}',true,'declared_tenant_role','Declared tenant role');
    INSERT INTO permissions VALUES('${uid(21)}','ediel.production.activate'),('${uid(22)}','ediel.production.pause');
    INSERT INTO role_permissions VALUES('${uid(20)}','${uid(21)}'),('${uid(20)}','${uid(22)}');
    INSERT INTO user_roles VALUES('${uid(3)}','${uid(20)}','${uid(1)}',true,'active',NULL);
    INSERT INTO ediel_actor_settings(id,company_id,actor_name,environment,actor_role,actor_ediel_id,is_active)
      VALUES('${uid(10)}','${uid(1)}','Declared production supplier','production','supplier','12345',true);
    INSERT INTO canonical_ediel_profile_identities(company_id,environment,actor_role,profile_id)
      VALUES('${uid(1)}','production','supplier','${uid(10)}');
    INSERT INTO ediel_route_profiles(id,company_id,environment,is_active,is_enabled)
      VALUES('${uid(11)}','${uid(1)}','production',true,true);
    INSERT INTO ediel_configuration_snapshots(id,company_id,snapshot_version,payload,configuration_hash,reason)
      VALUES('${uid(5)}','${uid(1)}',1,'{"declaredComponentHost":true}',canonical_json_sha256('{"declaredComponentHost":true}'),'declared component snapshot');
    INSERT INTO ediel_production_readiness_checks(id,company_id,status,configuration_snapshot_id)
      VALUES('${uid(6)}','${uid(1)}','ready','${uid(5)}');
    INSERT INTO ediel_go_live_events(id,company_id,event_type,to_status,configuration_snapshot_id,expires_at)
      VALUES('${uid(7)}','${uid(1)}','production_dry_run','allowed','${uid(5)}',now()+interval '1 hour');
    INSERT INTO ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,valid_until,metadata)
      SELECT '${uid(1)}','production',kind,'passed',canonical_current_ediel_engine_schema_version(),
        'declared-component://not-external-approval/'||kind,'declared-component://document/'||kind,
        now()-interval '1 hour','${uid(3)}',now(),now()+interval '1 day','{"componentBoundaryOnly":true}'
      FROM unnest(ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY']) kind;`)
})
afterEach(async () => {await db.exec('ROLLBACK')})

it.each(['seeded default', 'missing row'])('successful checked prepared to LIVE converges the %s and allows its operation', async kind => {
  const initial = await capability()
  const isolated = (await db.query("SELECT to_jsonb(c) row FROM company_capabilities c WHERE company_id<>$1 OR capability_code<>'ediel_production' ORDER BY id", [uid(1)])).rows
  if (kind === 'missing row') await db.query("DELETE FROM company_capabilities WHERE company_id=$1 AND capability_code='ediel_production'", [uid(1)])
  expect(await one('SELECT canonical_company_readiness($1,$2,$3,$4,\'live\') readiness', [uid(1), uid(5), uid(6), uid(7)]))
    .toMatchObject({readiness: {ready: true, company_id: uid(1), configuration_snapshot_id: uid(5)}})
  expect(await one('SELECT canonical_ediel_production_evidence_readiness($1) evidence', [uid(1)]))
    .toMatchObject({evidence: {ready: true, pilot_required: false}})
  expect(await operation()).toMatchObject({allowed: false, reason_code: 'capability_not_ready'})
  expect((await transition('prepared', 0, 'declared-prepare')).result).toMatchObject({changed: true, state: 'prepared', state_version: 1})
  expect((await transition('live', 1, 'declared-live')).result).toMatchObject({changed: true, state: 'live', state_version: 2})
  expect(await one('SELECT state,state_version,configuration_snapshot_id,readiness_check_id,dry_run_id FROM ediel_production_state WHERE company_id=$1', [uid(1)]))
    .toMatchObject({state: 'live', state_version: 2, configuration_snapshot_id: uid(5), readiness_check_id: uid(6), dry_run_id: uid(7)})
  expect.soft(await capability()).toMatchObject({row: {enabled: true, readiness_status: 'ready', last_verified_by: uid(3), updated_by: uid(3)}})
  expect.soft(await operation()).toMatchObject({allowed: true, reason_code: 'allowed', production_status: 'live'})
  const promoted = (await capability()).row as Record<string, unknown>
  const instant = (await one<{instant: string}>('SELECT to_jsonb(now()) instant')).instant
  expect(promoted).toMatchObject({configuration: {}, blockers: [], last_verified_at: instant,
    created_by: kind === 'missing row' ? uid(3) : null, updated_at: instant})
  if (kind === 'seeded default') expect(promoted).toEqual({...initial.row as Record<string, unknown>,
    enabled: true, readiness_status: 'ready', last_verified_at: instant,
    last_verified_by: uid(3), updated_by: uid(3), updated_at: instant})
  expect((await db.query("SELECT to_jsonb(c) row FROM company_capabilities c WHERE company_id<>$1 OR capability_code<>'ediel_production' ORDER BY id", [uid(1)])).rows).toEqual(isolated)
  const command = await one<{payload: string, hash: string}>("SELECT request_payload::text payload,request_hash hash FROM canonical_command_results WHERE company_id=$1 AND idempotency_key='declared-live'", [uid(1)])
  expect(command.hash).toBe(createHash('sha256').update(command.payload).digest('hex'))
})

it('retains checked/unchecked full metadata and a second actual forward application is inert', async () => {
  expect((await functionMetadata()).rows).toEqual(metadataBefore)
  expect((await definitions()).rows).toEqual(definitionsAfterFirst)
})

it('creates only its own opaque production lock and replays the checked command without lock/history effects', async () => {
  await transition('prepared', 0, 'declared-prepare')
  const prepared = (await lock()).row
  expect(JSON.parse(String(prepared.lock_key))).toEqual([uid(1), 'production'])
  expect(prepared).toMatchObject({locked: true, status: 'active', company_id: uid(1), environment: 'production'})
  expect(prepared.locked_at).not.toBeNull()
  const result = await transition('live', 1, 'declared-live')
  const live = (await lock()).row
  expect(live).toMatchObject({locked: false, status: 'released', unlocked_by: uid(3)})
  expect(live.locked_at).toBe(prepared.locked_at)
  const before = await db.query('SELECT to_jsonb(t) row FROM canonical_audit_events t ORDER BY id')
  expect(await transition('live', 1, 'declared-live')).toEqual(result)
  expect((await lock()).row).toEqual(live)
  expect(await db.query('SELECT to_jsonb(t) row FROM canonical_audit_events t ORDER BY id')).toEqual(before)
  expect(await one('SELECT count(*)::integer count FROM ediel_send_locks WHERE company_id=$1', [uid(2)])).toEqual({count: 0})
})

it('preserves an existing legacy key/id/expiry/metadata/created timestamp on release and timestamps a real relock', async () => {
  await db.exec(`INSERT INTO ediel_send_locks(id,company_id,environment,lock_key,locked_at,expires_at,created_at,metadata)
    VALUES('${uid(30)}','${uid(1)}','production','legacy original opaque key','2026-01-01','2099-01-01','2025-01-01','{"historicalOriginal":1}');`)
  const historical = (await lock()).row
  await transition('prepared', 0, 'declared-prepare')
  const prepared = (await lock()).row
  expect(prepared.locked_at).not.toBe(historical.locked_at)
  await transition('live', 1, 'declared-live')
  const released = (await lock()).row
  for (const name of ['id', 'lock_key', 'expires_at', 'metadata', 'created_at']) expect(released[name]).toEqual(historical[name])
  expect(released.locked_at).toBe(prepared.locked_at)
  // Existing old lock clock is a physical host input, not a supplied clock to
  // the transition. Pausing must use its actual new transaction timestamp.
  await db.query("UPDATE ediel_send_locks SET locked_at='2026-01-01' WHERE id=$1", [uid(30)])
  await transition('paused', 2, 'declared-pause')
  const relocked = (await lock()).row
  expect(relocked).toMatchObject({locked: true, status: 'active', unlocked_by: null})
  expect(relocked.locked_at).toBe((await one<{instant: string}>('SELECT to_jsonb(now()) instant')).instant)
  for (const name of ['id', 'lock_key', 'expires_at', 'metadata', 'created_at']) expect(relocked[name]).toEqual(historical[name])
})

it('keeps the actual selective release hook and unlock-user SET NULL foreign key', async () => {
  await transition('prepared', 0, 'declared-prepare')
  const controls = [
    [40, uid(1), 'production', 'active_ediel_send_lock', false],
    [41, uid(2), 'production', 'active_ediel_send_lock', false],
    [42, uid(1), 'test', 'active_ediel_send_lock', false],
    [43, uid(1), 'production', 'different_error', false],
    [44, uid(1), 'production', 'active_ediel_send_lock', true],
  ] as const
  for (const [id, company, environment, error, sent] of controls) await db.query(`INSERT INTO ediel_outbox(
    id,company_id,ediel_message_id,lock_key,status,environment,last_error,sent_at)
    VALUES($1,$2,$3,$4,'blocked',$5,$6,$7)`, [uid(id), company, uid(id + 100), `declared-host-${id}`, environment, error, sent ? '2026-01-01' : null])
  const before = (await db.query<{row: Record<string, unknown>}>('SELECT to_jsonb(o) row FROM ediel_outbox o ORDER BY id')).rows
  await transition('live', 1, 'declared-live')
  const after = (await db.query<{row: Record<string, unknown>}>('SELECT to_jsonb(o) row FROM ediel_outbox o ORDER BY id')).rows
  expect(after[0].row).toMatchObject({status: 'queued', last_error: null})
  expect(after.slice(1)).toEqual(before.slice(1))
  const released = (await lock()).row
  expect(released.unlocked_by).toBe(uid(3))
  await db.query('DELETE FROM auth.users WHERE id=$1', [uid(3)])
  expect((await lock()).row).toEqual({...released, unlocked_by: null})
})

it.each([
  ['disabled', "readiness_status='disabled'"],
  ['blocked', "readiness_status='blocked'"],
  ['configuration', "configuration='{\"configuredByHost\":true}'"],
  ['blockers', "blockers=ARRAY['declared blocker']"],
  ['verification time', "last_verified_at='2026-01-01'"],
  ['verification actor', `last_verified_by='${uid(3)}'`],
  ['creation actor', `created_by='${uid(3)}'`],
  ['update actor', `updated_by='${uid(3)}'`],
  ['timestamp-only edit', "updated_at=created_at+interval '1 microsecond'"],
  ['already enabled', "enabled=true,readiness_status='ready'"],
  ['explicit ready but disabled', "readiness_status='ready'"],
])('preserves the entire explicitly edited capability: %s', async (_name, change) => {
  await db.exec(`UPDATE company_capabilities SET ${change} WHERE company_id='${uid(1)}' AND capability_code='ediel_production'`)
  const before = await capability()
  await transition('prepared', 0, 'declared-prepare')
  expect((await transition('live', 1, 'declared-live')).result).toMatchObject({changed: true, state: 'live'})
  expect(await capability()).toEqual(before)
})

it.each([
  ['missing', 'DELETE FROM ediel_certification_evidence WHERE evidence_type=\'TGT\''],
  ['foreign tenant', `UPDATE ediel_certification_evidence SET company_id='${uid(2)}' WHERE evidence_type='TGT'`],
  ['test environment', "UPDATE ediel_certification_evidence SET environment='test' WHERE evidence_type='TGT'"],
  ['revoked', "UPDATE ediel_certification_evidence SET status='revoked' WHERE evidence_type='TGT'"],
  ['expired', "UPDATE ediel_certification_evidence SET valid_until=now()-interval '1 minute' WHERE evidence_type='TGT'"],
  ['wrong engine', "UPDATE ediel_certification_evidence SET engine_schema_version='declared-old-engine' WHERE evidence_type='TGT'"],
  ['future tested clock', "UPDATE ediel_certification_evidence SET tested_at=now()+interval '1 hour',approved_at=now()+interval '2 hours' WHERE evidence_type='TGT'"],
])('retains accepted LIVE transition semantics but refuses default promotion with %s evidence', async (_name, change) => {
  await db.exec(change)
  expect(await one('SELECT canonical_ediel_production_evidence_readiness($1) evidence', [uid(1)]))
    .toMatchObject({evidence: {ready: false, missing: ['TGT']}})
  const before = await capability()
  await transition('prepared', 0, 'declared-prepare')
  expect((await transition('live', 1, 'declared-live')).result).toMatchObject({changed: true, state: 'live', state_version: 2})
  expect(await capability()).toEqual(before)
  expect(await operation()).toMatchObject({allowed: false, reason_code: 'capability_not_ready'})
})

it.each([false, true])('requires actual LIMITED_PILOT evidence after a production outbound sent row (supplied=%s)', async supplied => {
  await db.exec(`INSERT INTO ediel_messages(id,company_id,environment,direction,status,message_family)
    VALUES('${uid(50)}','${uid(1)}','production','outbound','sent','PRODAT');`)
  if (supplied) await db.exec(`INSERT INTO ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,
    external_reference,evidence_document_reference,tested_at,approved_by,approved_at,valid_until)
    SELECT company_id,environment,'LIMITED_PILOT',status,engine_schema_version,external_reference,evidence_document_reference,
      tested_at,approved_by,approved_at,valid_until FROM ediel_certification_evidence WHERE evidence_type='TGT';`)
  expect(await one('SELECT canonical_ediel_production_evidence_readiness($1) evidence', [uid(1)]))
    .toMatchObject({evidence: {ready: supplied, pilot_required: true, missing: supplied ? [] : ['LIMITED_PILOT']}})
  const before = await capability()
  await transition('prepared', 0, 'declared-prepare')
  await transition('live', 1, 'declared-live')
  if (supplied) expect(await capability()).toMatchObject({row: {enabled: true, readiness_status: 'ready'}})
  else expect(await capability()).toEqual(before)
})

it.each(['disabled', 'configuring', 'prepared', 'paused', 'blocked', 'retired'])('does not promote a fresh non-LIVE %s transition', async target => {
  const before = await capability()
  expect((await transition(target, 0, `declared-${target}`)).result).toMatchObject({state: target})
  expect(await capability()).toEqual(before)
})

it('does not rewrite capability on an actual replay or fresh no-change LIVE command', async () => {
  await transition('prepared', 0, 'declared-prepare')
  const first = await transition('live', 1, 'declared-live')
  // Physical post-transition default host makes forbidden replay/no-change
  // promotion observable; no privileged source or acceptance is fabricated.
  await db.query(`UPDATE company_capabilities SET enabled=false,readiness_status='not_configured',
    last_verified_at=NULL,last_verified_by=NULL,created_by=NULL,updated_by=NULL,updated_at=created_at
    WHERE company_id=$1 AND capability_code='ediel_production'`, [uid(1)])
  const before = await effectRows()
  expect(await transition('live', 1, 'declared-live')).toEqual(first)
  expect(await effectRows()).toEqual(before)
  const defaultRow = await capability()
  expect((await transition('live', 2, 'declared-live-nochange')).result).toMatchObject({changed: false, state: 'live', state_version: 2})
  expect(await capability()).toEqual(defaultRow)
  const after = await effectRows()
  expect({...after, canonical_command_results: before.canonical_command_results}).toEqual(before)
})

it('does not project capability through the existing unchecked compatibility entry point', async () => {
  await transition('prepared', 0, 'declared-prepare')
  const before = await capability()
  expect(await one(`SELECT canonical_transition_ediel_production_v1_unchecked($1,'live',1,$2,$3,$4,'declared component', $5,'declared-unchecked') result`,
    [uid(1), uid(5), uid(6), uid(7), uid(3)])).toMatchObject({result: {changed: true, state: 'live'}})
  expect(await capability()).toEqual(before)
})

it('does not create a missing capability when current evidence is incomplete', async () => {
  await db.query("DELETE FROM company_capabilities WHERE company_id=$1 AND capability_code='ediel_production'", [uid(1)])
  await db.exec("DELETE FROM ediel_certification_evidence WHERE evidence_type='RESTORE_REPLAY'")
  await transition('prepared', 0, 'declared-prepare')
  expect((await transition('live', 1, 'declared-live')).result).toMatchObject({changed: true, state: 'live'})
  expect(await capability()).toBeUndefined()
  expect(await operation()).toMatchObject({allowed: false, reason_code: 'capability_not_ready'})
})

it('preserves a legitimate replay refusal for a changed payload and another authorized actor', async () => {
  await transition('prepared', 0, 'declared-prepare')
  await transition('live', 1, 'declared-live')
  await db.exec(`INSERT INTO auth.users VALUES('${uid(4)}',NULL,NULL,'2026-01-01');
    INSERT INTO user_profiles VALUES('${uid(4)}','active');
    INSERT INTO company_memberships VALUES('${uid(1)}','${uid(4)}','active',true);
    INSERT INTO user_roles VALUES('${uid(4)}','${uid(20)}','${uid(1)}',true,'active',NULL);`)
  const before = await effectRows()
  for (const [target, actor, expected] of [['paused', uid(3), 'idempotency_key_payload_mismatch'],
    ['live', uid(4), 'idempotency_actor_mismatch']]) {
    await db.exec('SAVEPOINT refused_replay')
    try {
      await expect(one('SELECT canonical_transition_ediel_production($1,$2,1,$3,$4,$5,$6,$7,$8) result',
        [uid(1), target, uid(5), uid(6), uid(7), 'declared component transition', actor, 'declared-live']))
        .rejects.toThrow(expected)
    } finally {
      await db.exec('ROLLBACK TO SAVEPOINT refused_replay; RELEASE SAVEPOINT refused_replay')
    }
    expect(await effectRows()).toEqual(before)
  }
})

it.each([
  ['unauthorized actor', `DELETE FROM company_memberships WHERE user_id='${uid(3)}'`, 'actor_not_authorized_for_ediel_production_transition'],
  ['stale readiness', "UPDATE ediel_production_readiness_checks SET is_stale=true", 'canonical_readiness_blocked:'],
  ['foreign readiness', `UPDATE ediel_production_readiness_checks SET company_id='${uid(2)}'`, 'canonical_readiness_blocked:'],
  ['foreign dry run', `UPDATE ediel_go_live_events SET company_id='${uid(2)}' WHERE id='${uid(7)}'`, 'canonical_readiness_blocked:'],
  ['expired dry run', `UPDATE ediel_go_live_events SET expires_at=now()-interval '1 minute' WHERE id='${uid(7)}'`, 'canonical_readiness_blocked:'],
  ['foreign snapshot', `UPDATE ediel_configuration_snapshots SET company_id='${uid(2)}'`, 'canonical_readiness_blocked:'],
  ['readiness snapshot mismatch', `UPDATE ediel_production_readiness_checks SET configuration_snapshot_id='${uid(55)}'`, 'canonical_readiness_blocked:'],
  ['dry run snapshot mismatch', `UPDATE ediel_go_live_events SET configuration_snapshot_id='${uid(55)}' WHERE id='${uid(7)}'`, 'canonical_readiness_blocked:'],
  ['missing route', 'UPDATE ediel_route_profiles SET is_active=false', 'canonical_readiness_blocked:'],
  ['missing profile binding', 'DELETE FROM canonical_ediel_profile_identities', 'canonical_readiness_blocked:'],
  ['blocked tenant lifecycle', "UPDATE companies SET status='suspended'", 'canonical_readiness_blocked:'],
  ['wrong state version', '', 'ediel_production_state_version_conflict:'],
])('preserves %s refusal and zero transition effects', async (name, change, message) => {
  await transition('prepared', 0, 'declared-prepare')
  if (change) await db.exec(change)
  const before = await effectRows()
  await db.exec('SAVEPOINT refused_transition')
  try {
    await expect(transition('live', name === 'wrong state version' ? 99 : 1, 'declared-refused')).rejects.toThrow(message)
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT refused_transition; RELEASE SAVEPOINT refused_transition')
  }
  expect(await effectRows()).toEqual(before)
})
