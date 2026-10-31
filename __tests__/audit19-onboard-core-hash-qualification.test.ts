import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { prePr973Audit19Schema } from './helpers/db05PredecessorSchema'

// simulation: 20261029-3f1a8ab1/claude-track2/014c
// Actual main source-contract body and actual main onboarding-core body (both
// from supabase/schema.sql) run in PGlite over selected actual DDL. Hermetic
// component test: no full-union replay, non-superuser owner envelope (the
// DB05 owner SCOPE/RESTORE sections are compared textually, not executed),
// native concurrency or production installation evidence. The onboarding core
// is created with check_function_bodies=off because its referenced tables are
// not loaded; its prosrc bytes are unchanged and it is never invoked.
// The forward is applied to the exact pre-PR973 capture, never to a capture
// that already contains it.
const schema = prePr973Audit19Schema(readFileSync('supabase/schema.sql', 'utf8'))
const forwardPath = 'supabase/migrations/20261030131500_audit19_qualify_onboard_customer_graph_core_hash.sql'
const forward = existsSync(forwardPath) ? readFileSync(forwardPath, 'utf8') : ''
const supportDonor = readFileSync('supabase/migrations/20261020180847_audit19_customer_support_consumer_contract.sql', 'utf8')
const helper = 'gridex_ediel_retention.audit19_source_contract_v1(text)'
const coreName = 'public.gridex_onboard_customer_graph_core'
const core = coreName + '(jsonb)'
const helperBeforeHash = '3a4cd230f9ffc6cc7fe97671fbe21f11d3feac7c928fb3530201ab853ef34314'
const helperAfterHash = 'ef491015524922d0f679678c1854d0fa398c979607ba5e82cd765c1453c116a2'
const oldCoreHash = '1610d0a87a9eeae06e593b9465cc675a63abb403092241ce76dc5c2dc2db637f'
const coreHash = 'edacde4cbe5c0dfdd7cd89a14cc40ad5f84ef4737e7a5e93a3a13b01147e7f27'
const action = 'ediel.retention.decision_original_reviewed'
const writer = 'public.ediel_review_decision_evidence_retention_v1'
const writerHash = '9eea7976474ff7e16d1e022787eedce025d0b7a5617237860d82ac6bd502b5c5'

let db: PGlite
function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function definition(sql: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = new RegExp(`^CREATE(?: OR REPLACE)? FUNCTION ${escaped}\\(`, 'im').exec(sql)
  if (!start) throw new Error('Missing actual function: ' + name)
  const rest = sql.slice(start.index)
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(rest)
  if (!delimiter) throw new Error('Missing function delimiter')
  const end = rest.indexOf(delimiter[1] + ';', delimiter.index + delimiter[0].length)
  if (end < 0) throw new Error('Unterminated function')
  return rest.slice(0, end + delimiter[1].length + 1)
}
function body(sql: string) {
  const delimiter = /\bAS\s+(\$[^$]*\$)/i.exec(sql)
  if (!delimiter) throw new Error('Missing body')
  const start = delimiter.index + delimiter[0].length
  return sql.slice(start, sql.indexOf(delimiter[1] + ';', start))
}
function table(name: string) {
  const start = schema.indexOf('CREATE TABLE ' + name + ' (')
  if (start < 0) throw new Error('Missing actual table: ' + name)
  return schema.slice(start, schema.indexOf('\n);', start) + 3)
}
function block(tag: string) {
  const start = forward.indexOf(`DO $${tag}$`)
  if (start < 0) return '' // Missing forward deliberately exposes RED.
  const end = forward.indexOf(`$${tag}$;`, start + tag.length + 5)
  if (end < 0) throw new Error('Unterminated forward block')
  return forward.slice(start, end + tag.length + 3)
}
function section(sql: string, name: string) {
  const start = sql.indexOf(`-- DB05_INSTALL_OWNER_${name}_BEGIN`)
  const end = sql.indexOf(`-- DB05_INSTALL_OWNER_${name}_END`, start)
  return start < 0 || end < 0 ? '' : sql.slice(start, end)
}
function map(source: string, tag: string): Record<string, string> {
  return JSON.parse(source.split('$' + tag + '$')[1]) as Record<string, string>
}
function stripMaps(source: string) {
  return source.replace(/\$contracts\$[\s\S]*?\$contracts\$/, '<HASH_MAP>')
    .replace(/\$signatures\$[\s\S]*?\$signatures\$/, '<SIGNATURE_MAP>')
}
const mainHelper = definition(schema, 'gridex_ediel_retention.audit19_source_contract_v1')
const mainCore = definition(schema, coreName)
// Exact pre-20261023232109 core captured from schema.sql at 3d08d112^.
const preCasCore = definition(readFileSync('__tests__/fixtures/audit19-onboard-core-pre-cas-3d08d112-parent.sql', 'utf8'), coreName)
async function source(signature: string) {
  return (await db.query<{ prosrc: string }>('select prosrc from pg_proc where oid=$1::regprocedure', [signature])).rows[0].prosrc
}
async function profiles() {
  return (await db.query<{ profile: unknown }>(`select to_jsonb(p)-'prosrc' as profile from pg_proc p
    where oid=any(array[$1::regprocedure::oid,$2::regprocedure::oid]) order by oid`, [helper, core])).rows
}
async function qualify(selectedAction = action) {
  return (await db.query<{ result: { sourceVersion: string; writerFunction: string; writerBodyHash: string } }>(
    `select ${helper.slice(0, helper.indexOf('('))}($1) as result`, [selectedAction])).rows[0].result
}
async function apply(includePostcheck = true) {
  await db.exec(block('audit19_onboard_core_preflight'))
  const snapshot = /CREATE TEMPORARY TABLE gridex_audit19_onboard_core_function_scope\b[\s\S]*?;/.exec(forward)
  await db.exec(snapshot?.[0] ?? '')
  await db.exec(block('audit19_onboard_core_slot'))
  if (includePostcheck) await db.exec(block('audit19_onboard_core_profiles_preserved'))
}
async function rejectedApply() {
  const before = await profiles()
  const beforeBody = await source(helper)
  await db.exec('savepoint failed_install')
  let error: { code?: string; message?: string } | undefined
  try { await apply() } catch (caught) {
    error = caught as typeof error
    await db.exec('rollback to savepoint failed_install')
  }
  await db.exec('release savepoint failed_install')
  expect(error?.code).toBe('42501')
  expect(error?.message).toMatch(/audit19_onboard_core/)
  expect(await profiles()).toEqual(before)
  expect(await source(helper)).toBe(beforeBody)
}
async function replaceBody(signature: string, next: (old: string) => string) {
  const old = await source(signature)
  const actual = (await db.query<{ ddl: string }>('select pg_get_functiondef($1::regprocedure) as ddl', [signature])).rows[0].ddl
  await db.exec('set local check_function_bodies=off')
  await db.exec(actual.replace(old, next(old)))
}

describe('audit19 requalifies the reviewed onboarding-core source after the Ediel CAS redefinition', () => {
  beforeAll(async () => {
    expect(hash(body(mainHelper))).toBe(helperBeforeHash)
    expect(hash(body(mainCore))).toBe(coreHash)
    expect(hash(body(preCasCore))).toBe(oldCoreHash)
    db = new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create role gridex_ediel_retention_owner nologin noinherit bypassrls;
      create schema gridex_ediel_retention authorization gridex_ediel_retention_owner;`)
    for (const name of ['public.audit_logs', 'public.customer_cases', 'gridex_ediel_retention.audit19_approvals_v1',
      'gridex_ediel_retention.decision_evidence_policies']) await db.exec(table(name))
    for (const name of ['public.gridex_normalize_audit_context_v1', 'public.gridex_guard_history_truncate_v1',
      'gridex_ediel_retention.audit19_guard_v1', writer]) await db.exec(definition(schema, name))
    await db.exec(mainHelper)
    await db.exec('set check_function_bodies=off')
    await db.exec(mainCore)
    await db.exec('reset check_function_bodies')
    await db.exec(`alter function ${helper} owner to gridex_ediel_retention_owner;
      revoke all on function ${helper} from public,anon,authenticated,service_role;
      revoke all on function ${core} from public,anon,authenticated,service_role;`)
    for (const name of ['audit19_owner_delete_guard_v1', 'audit_logs_normalize_context_v1', 'audit19_a9_guard_v1']) {
      const trigger = new RegExp(`^CREATE TRIGGER ${name} .*;$`, 'm').exec(schema)
      if (!trigger) throw new Error('Missing actual trigger: ' + name)
      await db.exec(trigger[0])
    }
    const truncate = /^CREATE TRIGGER gridex_history_truncate_guard .* ON public\.audit_logs .*;$/m.exec(schema)
    if (!truncate) throw new Error('Missing actual audit truncate trigger')
    await db.exec(truncate[0])
  }, 60_000)
  beforeEach(async () => { await db.exec('begin') })
  afterEach(async () => { await db.exec('rollback') })
  afterAll(async () => { await db.close() })

  it('reproduces: the actual main helper rejects the actual main onboarding core', async () => {
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('(c) qualifies the actual onboarding core and retains the writer source result', async () => {
    await apply()
    expect(await qualify()).toEqual({ sourceVersion: '7f7d827987896f949f35b9da5801a79fbc1bceb6', writerFunction: writer, writerBodyHash: writerHash })
  })
  it('(a) changes exactly one contracts entry; signatures, owned list and writer logic stay exact', async () => {
    await apply()
    const after = await source(helper)
    expect(hash(after)).toBe(helperAfterHash)
    expect(stripMaps(after)).toBe(stripMaps(body(mainHelper)))
    const beforeContracts = map(body(mainHelper), 'contracts')
    const afterContracts = map(after, 'contracts')
    expect(Object.keys(afterContracts)).toEqual(Object.keys(beforeContracts))
    expect(beforeContracts[coreName]).toBe(oldCoreHash)
    expect(afterContracts[coreName]).toBe(coreHash)
    const changed = Object.keys(beforeContracts).filter(key => beforeContracts[key] !== afterContracts[key])
    expect(changed).toEqual([coreName])
    expect(map(after, 'signatures')).toEqual(map(body(mainHelper), 'signatures'))
    expect(after.match(/to_regprocedure\('/g)?.length).toBe(body(mainHelper).match(/to_regprocedure\('/g)?.length)
  })
  it('(b) accepts edacde4c and rejects the stale 1610d0a8 and an arbitrary third core body', async () => {
    await apply()
    await expect(qualify()).resolves.toMatchObject({ writerFunction: writer })
    await db.exec('savepoint stale_core')
    await replaceBody(core, () => body(preCasCore))
    expect(hash(await source(core))).toBe(oldCoreHash)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
    await db.exec('rollback to savepoint stale_core;release savepoint stale_core')
    await replaceBody(core, old => old + '\n-- arbitrary third body\n')
    expect(hash(await source(core))).not.toBe(coreHash)
    expect(hash(await source(core))).not.toBe(oldCoreHash)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('(b) does not make onboarding a retention writer', async () => {
    await apply()
    await expect(qualify('customer_onboarding.committed')).rejects.toMatchObject({ code: '42501', message: 'audit19_supported_source_contract_required' })
  })
  it('preserves both OIDs and every pg_proc attribute except the helper prosrc', async () => {
    const before = await profiles()
    await apply()
    expect(await profiles()).toEqual(before)
    expect(hash(await source(core))).toBe(coreHash)
  })
  it('(d) rejects an unknown helper body without replacing anything', async () => {
    await replaceBody(helper, old => old + '\n-- unqualified source change\n')
    await rejectedApply()
  })
  it('(d) rejects the post-support (pre-legacy-trigger) helper instead of rebasing it', async () => {
    const older = mainHelper.replace(/,"private\.gridex_complete_tenant_website_receipt_on_launch_ready_v1":"[0-9a-f]+"/, '')
    expect(older).not.toBe(mainHelper)
    await replaceBody(helper, () => body(older))
    await rejectedApply()
  })
  it('(d) rejects an unknown onboarding-core body', async () => {
    await replaceBody(core, old => old + '\n-- unreviewed\n')
    await rejectedApply()
  })
  it.each([
    ['helper definer', `alter function ${helper} security definer`],
    ['helper search path', `alter function ${helper} set search_path=public`],
    ['helper owner', `alter function ${helper} owner to postgres`],
    ['helper authenticated execute', `grant execute on function ${helper} to authenticated`],
    ['core invoker', `alter function ${core} security invoker`],
    ['core search path', `alter function ${core} set search_path=public`],
    ['core owner', `alter function ${core} owner to gridex_ediel_retention_owner`],
    ['core public execute', `grant execute on function ${core} to public`],
    ['core service execute', `grant execute on function ${core} to service_role`],
  ])('(d) rejects changed %s', async (_label, mutation) => {
    await db.exec(mutation)
    await rejectedApply()
  })
  it('(d) rejects an already replaced helper (no silent rebase)', async () => {
    await apply()
    await rejectedApply()
  })
  it('rolls back the replacement if the post-check fails', async () => {
    const before = await profiles()
    await db.exec('savepoint atomic_install')
    await apply(false)
    expect(hash(await source(helper))).toBe(helperAfterHash)
    await db.exec(`grant execute on function ${helper} to authenticated`)
    await expect(db.exec(block('audit19_onboard_core_profiles_preserved'))).rejects.toMatchObject({ code: '42501' })
    await db.exec('rollback to savepoint atomic_install;release savepoint atomic_install')
    expect(await profiles()).toEqual(before)
    expect(hash(await source(helper))).toBe(helperBeforeHash)
  })
  it('still rejects a newly unknown audit consumer', async () => {
    await apply()
    await db.exec(`create function public.fixture_unknown_consumer() returns bigint language sql as $$select count(*) from public.audit_logs$$`)
    await expect(qualify()).rejects.toMatchObject({ code: '42501', message: 'audit19_unowned_or_changed_semantic_consumer' })
  })
  it('copies the support-consumer owner install/restore boundary with only the scope name changed', () => {
    const rename = (sql: string) => sql.replaceAll('gridex_audit19_support_install_scope', 'gridex_audit19_onboard_core_install_scope')
    expect(section(forward, 'SCOPE')).not.toBe('')
    expect(section(forward, 'SCOPE')).toBe(rename(section(supportDonor, 'SCOPE')))
    expect(section(forward, 'RESTORE')).toBe(rename(section(supportDonor, 'RESTORE')))
    expect(forward.trim()).toMatch(/^--[\s\S]*\nBEGIN;/)
    expect(forward.trim()).toMatch(/COMMIT;$/)
    expect(forward).not.toMatch(/(?:UPDATE|LOCK\s+TABLE)\s+(?:pg_catalog\.)?pg_proc\b/i)
  })
})
