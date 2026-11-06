// local/047 component regression for EDIEL01.01–06 / EDIEL02.01–06 / EDIEL03.01–05 prerequisites.
// Executes actual reconstruction SQL in private in-memory PostgreSQL/PGlite, not native replay,
// PostgREST, managed Supabase, full trigger graph, readiness or original business acceptance.
import { readFileSync, existsSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const tables = ['ediel_agt_readiness', 'ediel_test_run_locks', 'ediel_unlinked_test_messages'] as const
const bootstrap = 'supabase/bootstrap/20260602_ediel_operations_tables_foundation.sql'
const forward = 'supabase/migrations/20261106184525_ediel_operations_tables_replay_completeness.sql'
const original = readFileSync('supabase/migrations/20260602143000_ediel_environment_business_action_locks.sql', 'utf8')
const hardening = readFileSync('supabase/migrations/20260602152000_ediel_operations_completion_hardening.sql', 'utf8')
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
let db: PGlite

// Extract immutable original statements for historical fixtures, never replacement SQL.
// Assertions below inspect PostgreSQL effects, not source string matches.
function between(sql: string, start: string, end: string) {
  const a = sql.indexOf(start), b = sql.indexOf(end, a + start.length)
  if (a < 0 || b < a) throw new Error('historical fixture statement boundary changed')
  return sql.slice(a, b)
}
const legacyTables = between(original, 'create table if not exists public.ediel_test_run_locks', 'alter table if exists public.ediel_exchange_logs')
const legacyOpenIndex = original.slice(original.indexOf('create index if not exists ediel_unlinked_test_messages_open_idx'))
const hardeningSQL = [
  between(hardening, 'alter table if exists public.ediel_agt_readiness', 'create table if not exists public.ediel_retest_invalidations'),
  between(hardening, 'alter table if exists public.ediel_unlinked_test_messages', 'alter table if exists public.communication_routes'),
  hardening.slice(hardening.indexOf('-- Add foreign keys only when both sides exist')),
].join('\n')
// Absence is the actual old replay behavior: do not synthesize the missing repair.
// PostgreSQL postconditions then fail on the old inputs, rather than import/ENOENT failure.
async function upgrade() { if (existsSync(forward)) await db.exec(readFileSync(forward, 'utf8')) }
async function clean() {
  const plan = JSON.parse(readFileSync('scripts/gridex-aud-003-foundation-order.json', 'utf8')) as { foundation: string[] }
  if (plan.foundation.includes(bootstrap.replace('supabase/', ''))) await db.exec(readFileSync(bootstrap, 'utf8'))
  await db.exec(hardeningSQL)
  await upgrade()
}
async function relations() {
  return (await db.query<{ name: string | null }>('select to_regclass($1)::text as name', ['public.' + tables[0]])).rows[0]
}
async function assertPresent() {
  for (const table of tables) expect((await db.query<{ present: boolean }>('select to_regclass($1) is not null as present', ['public.' + table])).rows[0].present, table).toBe(true)
}
type ReplayState = {
  locks: unknown
  readiness: Array<Record<string, unknown>> | null
  unlinked: Array<Record<string, unknown>> | null
  catalog: unknown
  constraints: unknown
  indexes: unknown
  policies: unknown
}
async function state() {
  return (await db.query<ReplayState>(`select
    (select jsonb_agg(to_jsonb(t) order by id) from public.ediel_test_run_locks t) locks,
    (select jsonb_agg(to_jsonb(t) order by id) from public.ediel_agt_readiness t) readiness,
    (select jsonb_agg(to_jsonb(t) order by id) from public.ediel_unlinked_test_messages t) unlinked,
    (select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relrowsecurity,c.relacl::text) order by c.relname)
      from pg_class c where c.oid in ('public.ediel_test_run_locks'::regclass,'public.ediel_agt_readiness'::regclass,'public.ediel_unlinked_test_messages'::regclass)) catalog,
    (select jsonb_agg(jsonb_build_array(oid,conname,pg_get_constraintdef(oid)) order by conname) from pg_constraint
      where conrelid in ('public.ediel_test_run_locks'::regclass,'public.ediel_agt_readiness'::regclass,'public.ediel_unlinked_test_messages'::regclass)) constraints,
    (select jsonb_agg(jsonb_build_array(indexrelid,pg_get_indexdef(indexrelid)) order by indexrelid) from pg_index
      where indrelid in ('public.ediel_test_run_locks'::regclass,'public.ediel_agt_readiness'::regclass,'public.ediel_unlinked_test_messages'::regclass)) indexes,
    (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where tablename in ('ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages')) policies`)).rows[0]
}
async function seed() {
  await db.exec(`insert into public.ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at,metadata)
    values('${A}','supplier','PRODAT','agt_test',now()+interval '1 hour','{"retained":true}');
    insert into public.ediel_agt_readiness(company_id,actor_role,message_family,test_resource_name) values('${A}','supplier','PRODAT','retained synthetic');
    insert into public.ediel_unlinked_test_messages(company_id,parsed_payload,raw_payload_ref) values('${A}','{"retained":true}','synthetic-ref'),(null,'{}','unattributed');`)
}
async function role<T>(name: 'service_role' | 'anon' | 'authenticated', fn: () => Promise<T>) {
  await db.exec(`set role ${name}`)
  try { return await fn() } finally { await db.exec('reset role') }
}
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin nobypassrls;
    create schema auth; create function auth.role() returns text language sql stable as 'select current_user::text';
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.companies(id uuid primary key);
    insert into public.companies values('${A}'),('${B}');`)
  await db.exec(readFileSync('supabase/bootstrap/20260602_ediel_environment_type_foundation.sql', 'utf8'))
}, 30_000)
afterEach(async () => { await db?.close() })

describe('three-table actual replay effects (component only)', () => {
  it('clean declared foundation plus canonical hardening yields three usable empty tables without readiness seeding', async () => {
    await clean(); await assertPresent()
    for (const table of tables) expect((await db.query(`select * from public.${table}`)).rows).toEqual([])
    await seed()
    const row = (await db.query(`select * from public.ediel_agt_readiness`)).rows[0]
    expect(row).toMatchObject({ test_resource_confirmed: false, ediel_portal_login_confirmed: false, application_system_selected: false, edi_system_selected: false, readiness_status: 'not_ready', needs_retest: false, blocking_issues: [], readiness_snapshot: {} })
    const unlinked = (await db.query(`select * from public.ediel_unlinked_test_messages where company_id is null`)).rows[0]
    expect(unlinked).toMatchObject({ environment_type: 'agt_test', parsed_payload: {}, candidate_test_run_ids: [], status: 'unlinked', linked_test_run_id: null, ediel_message_id: null, inbound_mail_item_id: null, resolution_notes: null })
    expect((await db.query(`select id,locked_at,created_at,updated_at,released_at,active_test_run_id from public.ediel_test_run_locks`)).rows[0]).toMatchObject({ released_at: null, active_test_run_id: null })
  }, 30_000)
  it('forward reconstructs the f23 missing-table shape after skipped hardening without any business rows', async () => {
    await db.exec(hardeningSQL); expect(await relations()).toEqual({ name: null })
    await upgrade(); await assertPresent()
    for (const table of tables) expect((await db.query<{ n: number }>(`select count(*)::int n from public.${table}`)).rows[0].n).toBe(0)
  }, 30_000)
  it('forward hardens original three-table shape and preserves rows including null-company unlinked evidence', async () => {
    await db.exec(legacyTables + legacyOpenIndex); await seed()
    const before = (await state())
    await upgrade(); await assertPresent()
    const after = await state()
    expect(after.locks).toEqual(before.locks)
    // New hardening columns are additive: compare complete old row projections in SQL.
    for (const table of ['ediel_agt_readiness','ediel_unlinked_test_messages']) {
      const oldRows = (before[table === 'ediel_agt_readiness' ? 'readiness' : 'unlinked'] as Array<Record<string, unknown>>)
      const rows = (await db.query<{ value: Record<string, unknown> }>(`select to_jsonb(t) value from public.${table} t order by id`)).rows.map(row => row.value)
      expect(rows).toHaveLength(oldRows.length)
      for (let i = 0; i < rows.length; i++) expect(rows[i]).toMatchObject(oldRows[i])
    }
    expect((await db.query(`select blocking_issues,readiness_snapshot,invalidated_at from public.ediel_agt_readiness`)).rows[0]).toEqual({ blocking_issues: [], readiness_snapshot: {}, invalidated_at: null })
  }, 30_000)
  it('repeated forward preserves row bytes, relation identity, constraints, index and ACL/RLS policy state', async () => {
    await upgrade(); await assertPresent(); await seed(); const before = await state()
    await upgrade(); expect(await state()).toEqual(before)
  }, 30_000)
  it('retains live-lock uniqueness across expiry while allowing released, foreign-company, role/family/environment scopes', async () => {
    await upgrade(); await assertPresent(); await seed()
    await db.exec(`update public.ediel_test_run_locks set expires_at=now()-interval '1 day'`)
    const insert = (company: string, roleCode: string, family: string, env: string) => db.query(`insert into public.ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at) values($1,$2,$3,$4,now()+interval '1 hour')`, [company,roleCode,family,env])
    await expect(insert(A,'supplier','PRODAT','agt_test')).rejects.toMatchObject({ code: '23505' })
    await insert(B,'supplier','PRODAT','agt_test'); await insert(A,'esco','PRODAT','agt_test'); await insert(A,'supplier','UTILTS','agt_test'); await insert(A,'supplier','PRODAT','tgt_test')
    await db.exec(`update public.ediel_test_run_locks set released_at=now() where company_id='${A}' and actor_role='supplier' and message_family='PRODAT' and environment_type='agt_test'`)
    await insert(A,'supplier','PRODAT','agt_test')
    await expect(db.exec(`insert into public.ediel_agt_readiness(company_id,actor_role,message_family) values('${A}','supplier','PRODAT')`)).rejects.toMatchObject({ code: '23505' })
    const index = (await db.query(`select indexdef from pg_indexes where schemaname='public' and indexname='ediel_unlinked_test_messages_open_idx'`)).rows
    expect(index).toHaveLength(1)
    // PostgreSQL planner must be able to use the original open partial index for the literal open query.
    await db.exec('set enable_seqscan=off')
    const plan = (await db.query(`explain select * from public.ediel_unlinked_test_messages where environment_type='agt_test' and message_family='PRODAT' and status='unlinked'`)).rows
    expect(JSON.stringify(plan)).toContain('ediel_unlinked_test_messages_open_idx')
  }, 30_000)
  it('enforces canonical company FKs/cascade without inventing a company FK for unlinked evidence', async () => {
    await upgrade(); await assertPresent(); await seed()
    await expect(db.exec(`insert into public.ediel_agt_readiness(company_id,actor_role,message_family) values('00000000-0000-4000-8000-000000000099','supplier','PRODAT')`)).rejects.toMatchObject({ code: '23503' })
    await expect(db.exec(`insert into public.ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at) values('00000000-0000-4000-8000-000000000099','supplier','PRODAT','agt_test',now())`)).rejects.toMatchObject({ code: '23503' })
    await db.exec(`delete from public.companies where id='${A}'`)
    expect((await db.query('select * from public.ediel_test_run_locks')).rows).toEqual([])
    expect((await db.query('select * from public.ediel_agt_readiness')).rows).toEqual([])
    expect((await db.query('select * from public.ediel_unlinked_test_messages')).rows).toHaveLength(2)
  }, 30_000)
  it('permits existing service operations without BYPASSRLS and denies anonymous/authenticated table privileges', async () => {
    await upgrade(); await assertPresent()
    for (const table of tables) {
      expect((await db.query<{ enabled: boolean }>(`select relrowsecurity enabled from pg_class where oid=$1::regclass`, ['public.'+table])).rows[0].enabled).toBe(true)
      for (const name of ['anon','authenticated'] as const) {
        await role(name, async () => { await expect(db.query(`select * from public.${table}`)).rejects.toMatchObject({ code:'42501' }) })
        for (const privilege of ['SELECT','INSERT','UPDATE','DELETE']) expect((await db.query<{ allowed: boolean }>(`select has_table_privilege($1,$2,$3) allowed`,[name,'public.'+table,privilege])).rows[0].allowed).toBe(false)
      }
    }
    await role('service_role', async () => { await seed(); expect((await db.query('select * from public.ediel_test_run_locks')).rows).toHaveLength(1); await db.exec("update public.ediel_test_run_locks set metadata='{\"service\":true}'"); await db.exec('delete from public.ediel_unlinked_test_messages where company_id is null') })
  }, 30_000)
  it('RLS still denies client rows/writes even when isolated fixture explicitly grants table DML', async () => {
    await upgrade(); await assertPresent(); await seed()
    for (const table of tables) {
      await db.exec(`grant select,insert,update,delete on public.${table} to authenticated`)
      await role('authenticated', async () => {
        expect((await db.query(`select * from public.${table}`)).rows).toEqual([])
        expect((await db.query(`delete from public.${table} returning id`)).rows).toEqual([])
        expect((await db.query(`update public.${table} set updated_at=now() returning id`)).rows).toEqual([])
      })
    }
    await role('authenticated', async () => { await expect(db.exec(`insert into public.ediel_unlinked_test_messages(company_id) values('${A}')`)).rejects.toMatchObject({code:'42501'}) })
    expect((await db.query('select * from public.ediel_unlinked_test_messages')).rows).toHaveLength(2)
  }, 30_000)
  it('refuses unknown partial shape without completing other tables or changing retained data', async () => {
    await db.exec(`create table public.ediel_test_run_locks(id text primary key, marker text); insert into public.ediel_test_run_locks values('retained','do-not-rewrite')`)
    await db.exec('begin')
    try { await expect(upgrade()).rejects.toThrow() } finally { await db.exec('rollback') }
    expect((await db.query('select * from public.ediel_test_run_locks')).rows).toEqual([{id:'retained',marker:'do-not-rewrite'}])
    for (const table of ['ediel_agt_readiness','ediel_unlinked_test_messages']) expect((await db.query<{ name: string | null }>('select to_regclass($1) name',['public.'+table])).rows[0].name).toBeNull()
  }, 30_000)
})

// Poincare P2: relation namespace collisions must not make IF NOT EXISTS skip a required index.
for (const indexName of ['ediel_test_run_locks_one_active_agt_uidx', 'ediel_unlinked_test_messages_open_idx']) {
  it.each(['table', 'view'] as const)(`rejects index-name collision ${indexName} as %s atomically`, async kind => {
    await db.exec(`create table public.p2_retained_evidence(id integer primary key, marker text);
      insert into public.p2_retained_evidence values(1,'retained-before-repair')`)
    if (kind === 'table') await db.exec(`create table public.${indexName}(id integer primary key, marker text);
      insert into public.${indexName} values(1,'unrelated-retained-row')`)
    else await db.exec(`create view public.${indexName} as select * from public.p2_retained_evidence`)
    const snapshot = async () => (await db.query(`select
      (select jsonb_agg(to_jsonb(t) order by id) from public.p2_retained_evidence t) retained,
      (select jsonb_agg(to_jsonb(t) order by id) from public.${indexName} t) collision_rows,
      (select jsonb_build_array(oid,relkind,relacl::text) from pg_class where oid='public.${indexName}'::regclass) collision_object,
      to_regclass('public.ediel_test_run_locks')::text locks,
      to_regclass('public.ediel_agt_readiness')::text readiness,
      to_regclass('public.ediel_unlinked_test_messages')::text unlinked`)).rows[0]
    const before = await snapshot()
    let rejected = false
    try { await upgrade() } catch { rejected = true }
    // Compare after the actual standalone DO, without test rollback concealing successful writes.
    const after = await snapshot()
    expect({ rejected, after }).toEqual({ rejected: true, after: before })
  }, 30_000)
}
