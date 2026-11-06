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
  await fullSourceFixture(false)
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

// Native6b9 regression: actual later generic SQL, scoped to its consumed relations.
// auth.uid/session/admin fixtures are deterministic ports, not managed SupabaseAuth.
const lifecycleSource = readFileSync('supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql', 'utf8')
const retentionSource = readFileSync('supabase/migrations/20261005130000_hard_delete_guard_companies_customers.sql', 'utf8')
const actualLifecycleHelpers = between(lifecycleSource, 'create or replace function public.gridex_can_read_company(', 'create or replace function public.gridex_user_can_manage_company(')
const actualLifecycleLoop = between(lifecycleSource, 'do $rls$', '-- companies uses its own id')
const actualTruncateFunction = between(retentionSource, 'create or replace function public.gridex_guard_history_truncate_v1()', 'revoke all on function public.gridex_guard_company_disposable_status_v1()')
const actualTruncateLoop = retentionSource.slice(retentionSource.indexOf('do $guard$'))
async function augustIntermediateFixture(existing: boolean, withRetention = true) {
  if (existing) {
    await db.exec(readFileSync(bootstrap, 'utf8'))
    await db.exec(hardeningSQL)
    await seed()
    for (const table of tables) await db.exec(`grant select,insert,update,delete on public.${table} to service_role`)
  }
  await db.exec(`alter table public.companies add column if not exists status text not null default 'active';
    create table if not exists public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,membership_role text);
    create table if not exists public.customers(id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.user_id',true),'')::uuid$$;
    create or replace function public.gridex_is_current_session_allowed() returns boolean language sql stable as $$select coalesce(nullif(current_setting('fixture.session_allowed',true),''),'true')::boolean$$;
    create or replace function public.gridex_user_is_platform_admin() returns boolean language sql stable as $$select false$$;
    insert into public.company_memberships select '${A}','00000000-0000-4000-8000-000000000010','active',true,'owner' where not exists(select from public.company_memberships where company_id='${A}');
    select set_config('fixture.user_id','00000000-0000-4000-8000-000000000010',false);`)
  await db.exec(actualLifecycleHelpers)
  await db.exec(lifecycleSource.split('\n').filter(line => /^(revoke all|grant execute) on function public\.gridex_can_(read|write)_company\(/.test(line)).join('\n'))
  // The missing-three-table characterization must not replay August over already
  // September-cleaned Auth-port relations. The base full-source pass (existing=false)
  // still executes the original global loop, then the complete September cleanup.
  const lifecycleLoop = existing
    ? actualLifecycleLoop.replace('    order by cls.relname',
      "      and cls.relname in ('ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages')\n    order by cls.relname")
    : actualLifecycleLoop
  await db.exec(lifecycleLoop)
  if (withRetention) {
    await db.exec(actualTruncateFunction)
    await db.exec(retentionSource.split('\n').filter(line => line.startsWith('revoke all on function public.gridex_guard_history_truncate_v1()')).join('\n'))
    await db.exec(actualTruncateLoop)
  }
}
async function laterMetadata() {
  return (await db.query<{ policies: unknown; triggers: unknown; functions: unknown }>(`select
    (select jsonb_agg(jsonb_build_array(oid,polrelid,polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) order by polrelid,polname)
      from pg_policy where polrelid in ('public.ediel_test_run_locks'::regclass,'public.ediel_agt_readiness'::regclass,'public.ediel_unlinked_test_messages'::regclass)) policies,
    (select jsonb_agg(jsonb_build_array(oid,tgname,tgenabled,tgtype,tgnargs,encode(tgargs,'hex'),tgfoid,pg_get_triggerdef(oid)) order by tgrelid,tgname)
      from pg_trigger where not tgisinternal and tgrelid in ('public.ediel_test_run_locks'::regclass,'public.ediel_agt_readiness'::regclass,'public.ediel_unlinked_test_messages'::regclass)) triggers,
    (select jsonb_agg(jsonb_build_array(oid,pg_get_functiondef(oid),proacl::text,proowner) order by proname) from pg_proc where oid in
      ('public.gridex_can_read_company(uuid)'::regprocedure,'public.gridex_can_write_company(uuid)'::regprocedure,'public.gridex_guard_history_truncate_v1()'::regprocedure)) functions`)).rows[0]
}
async function assertLaterProfile() {
  for (const table of tables) {
    const policies = (await db.query<{ policyname: string; permissive: string; roles: string[]; cmd: string }>(`select policyname,permissive,roles,cmd from pg_policies where schemaname='public' and tablename=$1 order by policyname`, [table])).rows
    expect(policies).toEqual([
      { policyname: table+'_service_role_all', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'ALL' },
      { policyname: 'tenant_lifecycle_anon_deny_guard', permissive: 'RESTRICTIVE', roles: ['anon'], cmd: 'ALL' },
      { policyname: 'tenant_lifecycle_delete_guard', permissive: 'RESTRICTIVE', roles: ['authenticated'], cmd: 'DELETE' },
      { policyname: 'tenant_lifecycle_insert_guard', permissive: 'RESTRICTIVE', roles: ['authenticated'], cmd: 'INSERT' },
      { policyname: 'tenant_lifecycle_select_guard', permissive: 'RESTRICTIVE', roles: ['authenticated'], cmd: 'SELECT' },
      { policyname: 'tenant_lifecycle_update_guard', permissive: 'RESTRICTIVE', roles: ['authenticated'], cmd: 'UPDATE' },
    ])
    const expressions = (await db.query<{ policyname: string; qual: string | null; with_check: string | null }>(`select policyname,qual,with_check from pg_policies where schemaname='public' and tablename=$1 and permissive='RESTRICTIVE' order by policyname`, [table])).rows
    const normalized = expressions.map(row => ({ name: row.policyname, qual: row.qual?.replaceAll('public.','').replace(/[\s()]/g,'') ?? null, check: row.with_check?.replaceAll('public.','').replace(/[\s()]/g,'') ?? null }))
    expect(normalized).toEqual([
      { name: 'tenant_lifecycle_anon_deny_guard', qual: 'false', check: 'false' },
      { name: 'tenant_lifecycle_delete_guard', qual: 'gridex_can_write_companycompany_id', check: null },
      { name: 'tenant_lifecycle_insert_guard', qual: null, check: 'gridex_can_write_companycompany_id' },
      { name: 'tenant_lifecycle_select_guard', qual: 'gridex_can_read_companycompany_id', check: null },
      { name: 'tenant_lifecycle_update_guard', qual: 'gridex_can_write_companycompany_id', check: 'gridex_can_write_companycompany_id' },
    ])
    const triggers = (await db.query<{ tgname: string; tgenabled: string; tgtype: number; function_name: string }>(`select tgname,tgenabled,tgtype,tgfoid::regprocedure::text function_name from pg_trigger where tgrelid=$1::regclass and not tgisinternal`, ['public.'+table])).rows
    expect(triggers).toEqual(table === 'ediel_unlinked_test_messages' ? [] : [{ tgname: 'gridex_history_truncate_guard', tgenabled: 'O', tgtype: 34, function_name: 'gridex_guard_history_truncate_v1()' }])
    for (const client of ['anon','authenticated']) expect((await db.query<{ allowed: boolean }>(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed`, [client,'public.'+table])).rows[0].allowed).toBe(false)
    expect((await db.query<{ enabled: boolean }>(`select relrowsecurity enabled from pg_class where oid=$1::regclass`, ['public.'+table])).rows[0].enabled).toBe(true)
  }
}
async function laterEffects() {
  const before = await state()
  // Native service ALL includes TRUNCATE: isolate the real guard, never mistake missing privilege for retention.
  for (const table of ['ediel_test_run_locks','ediel_agt_readiness']) {
    await db.exec('begin')
    try {
      await db.exec(`grant truncate on public.${table} to service_role`)
      await db.exec('set role service_role')
      await expect(db.exec(`truncate public.${table}`)).rejects.toMatchObject({ code: '23001' })
    } finally { await db.exec('rollback') }
    expect(await state()).toEqual(before)
  }
  // Temporary permissive fixture policies isolate actual restrictive helpers on ALL three tables.
  await db.exec('begin')
  try {
    await db.exec(`insert into public.ediel_test_run_locks(company_id,actor_role,message_family,environment_type,expires_at) values('${B}','supplier','PRODAT','agt_test',now()+interval '1 hour');
      insert into public.ediel_agt_readiness(company_id,actor_role,message_family) values('${B}','supplier','PRODAT');
      insert into public.ediel_unlinked_test_messages(company_id) values('${B}')`)
    for (const table of tables) await db.exec(`grant select,update on public.${table} to authenticated;
      create policy fixture_business_read_write on public.${table} for all to authenticated using(true) with check(true)`)
    await role('authenticated', async () => {
      for (const table of tables) expect((await db.query(`select company_id from public.${table}`)).rows).toEqual([{ company_id: A }])
    })
    await db.exec(`update public.companies set status='paused' where id='${A}'`)
    await role('authenticated', async () => {
      for (const table of tables) {
        expect((await db.query(`select company_id from public.${table}`)).rows).toEqual([{ company_id: A }])
        expect((await db.query(`update public.${table} set updated_at=now() returning id`)).rows).toEqual([])
      }
    })
    await db.exec(`update public.companies set status='suspended' where id='${A}'`)
    await role('authenticated', async () => {
      for (const table of tables) expect((await db.query(`select * from public.${table}`)).rows).toEqual([])
    })
  } finally { await db.exec('rollback') }
  expect(await state()).toEqual(before)
}
describe('August intermediate policy compatibility', () => {
  it('accepts exact August intermediate policies/history then converges to the September final closure', async () => {
    await augustIntermediateFixture(true)
    await assertLaterProfile(); await laterEffects()
    const rows=await state(),metadata=await laterMetadata()
    await upgrade()
    expect(withoutPolicies(await state())).toEqual(withoutPolicies(rows))
    const after=await laterMetadata();expect(after.triggers).toEqual(metadata.triggers);expect(after.functions).toEqual(metadata.functions)
    await assertFinalClosure()
  },30_000)
  it('accepts exact August lifecycle-only intermediate metadata without retaining inert policies', async () => {
    await augustIntermediateFixture(true,false)
    expect((await db.query<{n:number}>(`select count(*)::int n from pg_policies where tablename in ('ediel_test_run_locks','ediel_agt_readiness','ediel_unlinked_test_messages') and permissive='RESTRICTIVE'`)).rows[0].n).toBe(15)
    await upgrade();await assertFinalClosure()
  },30_000)
  it('repeated late final closure preserves effective metadata and registry', async () => {
    await fullSourceFixture(false);await upgrade();await assertPresent();await assertFinalClosure();await seed()
    const rows=await state(),metadata=await laterMetadata(),registry=await registryRows()
    await upgrade();expect(await state()).toEqual(rows);expect(await laterMetadata()).toEqual(metadata);expect(await registryRows()).toEqual(registry)
  },30_000)
  it('still refuses an unknown trigger without altering retained rows or policy metadata', async () => {
    await augustIntermediateFixture(false); await upgrade(); await seed()
    await db.exec(`create function public.fixture_unknown_trigger() returns trigger language plpgsql as $$begin return new;end$$;
      create trigger fixture_unknown_trigger before update on public.ediel_test_run_locks for each row execute function public.fixture_unknown_trigger()`)
    const before=await state(), metadata=await laterMetadata()
    await expect(upgrade()).rejects.toThrow('unknown_trigger'); expect(await state()).toEqual(before); expect(await laterMetadata()).toEqual(metadata)
  }, 30_000)
  it('still refuses a same-name retention trigger bound to an unknown function', async () => {
    await augustIntermediateFixture(false); await upgrade(); await seed()
    await db.exec(`drop trigger if exists gridex_history_truncate_guard on public.ediel_test_run_locks;
      create function public.fixture_wrong_retention() returns trigger language plpgsql as $$begin return null;end$$;
      create trigger gridex_history_truncate_guard before truncate on public.ediel_test_run_locks for each statement execute function public.fixture_wrong_retention()`)
    const before=await state(),metadata=await laterMetadata()
    await expect(upgrade()).rejects.toThrow('unknown_trigger'); expect(await state()).toEqual(before); expect(await laterMetadata()).toEqual(metadata)
  }, 30_000)
  it('still refuses a same-name lifecycle guard with a broadened expression', async () => {
    await augustIntermediateFixture(false); await upgrade(); await seed()
    await db.exec(`drop policy if exists tenant_lifecycle_select_guard on public.ediel_unlinked_test_messages;
      create policy tenant_lifecycle_select_guard on public.ediel_unlinked_test_messages as restrictive for select to authenticated using(true)`)
    const before=await state(),metadata=await laterMetadata()
    await expect(upgrade()).rejects.toThrow('unknown_policy'); expect(await state()).toEqual(before); expect(await laterMetadata()).toEqual(metadata)
  }, 30_000)
})


describe('late source retention privilege boundary', () => {
  it.each(['ediel_test_run_locks','ediel_agt_readiness'])('denies service TRUNCATE %s with 23001 despite explicit TRUNCATE privilege', async table => {
    await fullSourceFixture(false); await upgrade(); await seed()
    const before=await state()
    await db.exec('begin')
    try {
      await db.exec(`grant truncate on public.${table} to service_role`)
      expect((await db.query<{ allowed: boolean }>(`select has_table_privilege('service_role',$1,'TRUNCATE') allowed`,['public.'+table])).rows[0].allowed).toBe(true)
      await db.exec('set role service_role')
      await expect(db.exec(`truncate public.${table}`)).rejects.toMatchObject({code:'23001'})
    } finally { await db.exec('rollback') }
    expect(await state()).toEqual(before)
  },30_000)
  it('preserves postgres owner TRUNCATE under actual history guard and excludes nullable unlinked', async () => {
    await fullSourceFixture(false); await upgrade(); await seed()
    // Independent owner-positive control installs the actual historical DDL explicitly.
    // The service-denial tests above independently require forward itself to install the guards.
    await db.exec(actualTruncateLoop)
    expect((await db.query<{ name: string }>('select current_user name')).rows[0].name).toBe('postgres')
    expect((await db.query(`select tgname from pg_trigger where tgrelid='public.ediel_unlinked_test_messages'::regclass and tgname='gridex_history_truncate_guard'`)).rows).toEqual([])
    expect((await db.query(`select conname from pg_constraint where conrelid='public.ediel_unlinked_test_messages'::regclass and contype='f' and confrelid='public.companies'::regclass`)).rows).toEqual([])
    const before=await state()
    for(const table of ['ediel_test_run_locks','ediel_agt_readiness']) {
      await db.exec('begin')
      try { await db.exec(`truncate public.${table}`);expect((await db.query(`select * from public.${table}`)).rows).toEqual([]) } finally { await db.exec('rollback') }
      expect(await state()).toEqual(before)
    }
  },30_000)
})


// Final canonical closure: August lifecycle -> September classification/F14 cleanup -> October retention.
// Run the actual September migration, not a hand-built classification substitute.
const septemberSource = readFileSync('supabase/migrations/20260902094000_platform_table_classification_and_invariant_gate.sql', 'utf8')
async function fullSourceFixture(existing: boolean) {
  // Native postgres defaults give service_role ALL, including TRUNCATE; clients receive no grants.
  await db.exec('alter default privileges for role postgres in schema public grant all on tables to service_role')
  await augustIntermediateFixture(existing, false)
  await db.exec(septemberSource)
  await db.exec(actualTruncateFunction)
  await db.exec(retentionSource.split('\n').filter(line => line.startsWith('revoke all on function public.gridex_guard_history_truncate_v1()')).join('\n'))
  await db.exec(actualTruncateLoop)
}
async function registryRows(targetsOnly = true) {
  return (await db.query<{ value: Record<string, unknown> }>(`select to_jsonb(t) value from public.platform_table_classification t
    where ${targetsOnly ? '' : 'not'} (table_name=any($1::text[])) order by table_name`, [[...tables]])).rows.map(row => row.value)
}
async function assertFinalClosure() {
  for (const table of tables) {
    expect((await db.query(`select policyname,permissive,roles,cmd from pg_policies where schemaname='public' and tablename=$1 order by policyname`, [table])).rows)
      .toEqual([{ policyname: table+'_service_role_all', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'ALL' }])
    expect((await db.query(`select tgname,tgenabled,tgtype,tgfoid::regprocedure::text function_name from pg_trigger where tgrelid=$1::regclass and not tgisinternal`, ['public.'+table])).rows)
      .toEqual(table==='ediel_unlinked_test_messages' ? [] : [{ tgname:'gridex_history_truncate_guard',tgenabled:'O',tgtype:34,function_name:'gridex_guard_history_truncate_v1()' }])
    expect((await db.query<{ enabled: boolean }>(`select relrowsecurity enabled from pg_class where oid=$1::regclass`, ['public.'+table])).rows[0].enabled).toBe(true)
    for (const client of ['anon','authenticated']) {
      expect((await db.query<{ allowed: boolean }>(`select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed`,[client,'public.'+table])).rows[0].allowed).toBe(false)
      await role(client as 'anon'|'authenticated', async () => { await expect(db.query(`select * from public.${table}`)).rejects.toMatchObject({code:'42501'}) })
    }
  }
  // Exact unchanged F14 catalog predicate from scripts/sql/tenant-isolation-invariants.sql.
  expect((await db.query<{ n: number }>(`select count(*)::int n from pg_policy pol
    join pg_class c on c.oid=pol.polrelid
    join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    where pol.polroles<>'{0}'::oid[] and not exists(
      select 1 from unnest(pol.polroles) as role_oid join pg_roles r on r.oid=role_oid
      where has_table_privilege(r.rolname,c.oid,'SELECT, INSERT, UPDATE, DELETE'))`)).rows[0].n).toBe(0)
  expect((await db.query(`select table_name,kind from public.platform_table_classification where table_name=any($1::text[]) order by table_name`,[[...tables]])).rows)
    .toEqual(tables.map(table_name=>({table_name,kind:'system'})))
}
function withoutPolicies(value: ReplayState) {
  return { locks: value.locks, readiness: value.readiness, unlinked: value.unlinked,
    catalog: value.catalog, constraints: value.constraints, indexes: value.indexes }
}
describe('full source September registry and F14 closure', () => {
  it('accepts actual final clean metadata after September cleanup, preserving classification, policies, rows and retained guards', async () => {
    await fullSourceFixture(true)
    await assertFinalClosure()
    const before=await state(),metadata=await laterMetadata(),registry=await registryRows(),other=await registryRows(false)
    await upgrade()
    expect(await state()).toEqual(before);expect(await laterMetadata()).toEqual(metadata)
    expect(await registryRows()).toEqual(registry);expect(await registryRows(false)).toEqual(other)
    await assertFinalClosure();await upgrade();expect(await state()).toEqual(before);expect(await registryRows()).toEqual(registry)
  },30_000)
  it('late f23 creates the same final grant-closed profile without reinstalling inert August policies', async () => {
    await fullSourceFixture(false)
    expect(await registryRows()).toEqual([])
    const other=await registryRows(false)
    await upgrade();await assertPresent();await assertFinalClosure();expect(await registryRows(false)).toEqual(other)
    await seed()
    const before=await state(),metadata=await laterMetadata(),registry=await registryRows()
    await upgrade();expect(await state()).toEqual(before);expect(await laterMetadata()).toEqual(metadata);expect(await registryRows()).toEqual(registry)
  },30_000)
  it('restores exactly three source-derived system classifications with no invented NULL meaning', async () => {
    await fullSourceFixture(false);await upgrade()
    expect((await db.query(`select table_name,kind,rationale,null_company_meaning,classified_by from public.platform_table_classification where table_name=any($1::text[]) order by table_name`,[[...tables]])).rows)
      .toEqual(tables.map(table_name=>({table_name,kind:'system',rationale:'Service-role only: no client role holds any privilege, so the table is closed by grants rather than by policy.',null_company_meaning:null,classified_by:'migration:platform_table_classification'})))
  },30_000)
  it('retains compatible system-classification metadata and unrelated registry rows on repeated repair', async () => {
    await fullSourceFixture(false);await upgrade()
    await db.exec(`create table public.fixture_unrelated_registry(id integer primary key);
      insert into public.platform_table_classification(table_name,kind,rationale,classified_by,classified_at)
        values('fixture_unrelated_registry','system','retain unrelated metadata','fixture','2020-01-01T00:00:00Z')`)
    for(const table of tables) await db.query(`insert into public.platform_table_classification(table_name,kind,rationale,classified_by,classified_at)
      values($1,'system','retain compatible metadata','fixture','2020-01-01T00:00:00Z') on conflict(table_name) do update set rationale=excluded.rationale,classified_by=excluded.classified_by,classified_at=excluded.classified_at`,[table])
    const registry=await registryRows(),other=await registryRows(false),before=await state()
    await upgrade();expect(await registryRows()).toEqual(registry);expect(await registryRows(false)).toEqual(other);expect(await state()).toEqual(before)
  },30_000)
  it('rejects an incompatible existing classification atomically instead of overwriting its metadata', async () => {
    await fullSourceFixture(false);await upgrade();await seed()
    await db.exec(`insert into public.platform_table_classification(table_name,kind,rationale) values('ediel_test_run_locks','tenant','retain incompatible metadata')
      on conflict(table_name) do update set kind=excluded.kind,rationale=excluded.rationale`)
    const before=await state(),registry=await registryRows(),other=await registryRows(false),metadata=await laterMetadata()
    await expect(upgrade()).rejects.toThrow(/classification|registry|kind/)
    expect(await state()).toEqual(before);expect(await registryRows()).toEqual(registry);expect(await registryRows(false)).toEqual(other);expect(await laterMetadata()).toEqual(metadata)
  },30_000)
})


it('fixture boundary preserves unrelated post-September policies when replaying the three-table August intermediate',async()=>{
  const unrelated=async()=>(await db.query(`select p.oid,p.polname,p.polrelid::regclass::text relation,p.polroles::text,
    pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) check_expr
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and not(c.relname=any($1::text[])) order by c.relname,p.polname`,[[...tables]])).rows
  const before=await unrelated()
  await augustIntermediateFixture(true,false)
  await upgrade()
  // Same global unchanged F14 predicate, with names for the first-boundary diagnosis.
  const inert=(await db.query(`select c.relname,p.polname from pg_policy p
    join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
    where p.polroles<>'{0}'::oid[] and not exists(
      select 1 from unnest(p.polroles) as role_oid join pg_roles r on r.oid=role_oid
      where has_table_privilege(r.rolname,c.oid,'SELECT, INSERT, UPDATE, DELETE')) order by c.relname,p.polname`)).rows
  expect(inert,'F14 boundary rows: '+JSON.stringify(inert)).toEqual([])
  expect(await unrelated()).toEqual(before)
},30_000)
