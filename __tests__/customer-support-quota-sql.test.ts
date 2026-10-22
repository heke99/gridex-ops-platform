import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const migration = readFileSync('supabase/migrations/20261020160633_customer_support_quota_atomic.sql', 'utf8')
const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const customer = '33333333-3333-4333-8333-333333333333'
const otherCustomer = '44444444-4444-4444-8444-444444444444'
const foreignCustomer = '55555555-5555-4555-8555-555555555555'
const client = '66666666-6666-4666-8666-666666666666'
const identity = '77777777-7777-4777-8777-777777777777'
const nextAction = 'Supportärendet ska triageras inom tenantens ordinarie ärendeflöde.'
const assessment = { isWithdrawal: false, withdrawalDeadlineAt: null, withdrawalPossible: false,
  switchCanBeStopped: false, cancellationRequired: false, cancellationStatus: 'not_required',
  scenario: 'not_withdrawal', nextAction, billingBlocked: false, billingManualReview: false, breakFeeFlagged: false }
type Row = Record<string, unknown>
let db: PGlite

function source(pattern: RegExp) {
  const found = schema.match(pattern)?.[0]
  if (!found) throw new Error('Actual source DDL missing')
  return found
}
async function create(key: string, overrides: { company?: string; customer?: string; message?: string } = {}) {
  const result = await db.query<{ result: { case: Row; reused: boolean } }>(
    'select public.gridex_create_customer_support_case_v1($1,$2,$3,$4,$5,$6,$7,$8) as result',
    [overrides.company ?? company, overrides.customer ?? customer, client, identity, 'Synthetic support', overrides.message ?? 'Original customer body', 'support', key])
  return result.rows[0].result
}
async function message(caseId: unknown, owner = customer) {
  const result = await db.query<{ result: Row }>('select public.gridex_add_customer_support_message_v1($1,$2,$3,$4,$5,$6) as result',
    [company, owner, caseId, client, identity, 'Synthetic follow-up'])
  return result.rows[0].result
}
async function count(table: string) {
  return (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n
}
async function seedCases(n: number) {
  await db.query(`insert into public.customer_cases(company_id,customer_id,title,source,metadata)
    select $1,$2,'Legacy support','tenant_support_customer_portal',jsonb_build_object('support_case',true,'opened_by','customer') from generate_series(1,$3::int)`, [company, customer, n])
}
async function seedMessages(caseId: unknown, n: number) {
  await db.query(`insert into public.customer_case_events(company_id,customer_id,customer_case_id,event_type,message,payload)
    select $1,$2,$3,'support_customer_message','Synthetic existing body','{"visibility":"customer"}'::jsonb from generate_series(1,$4::int)`, [company, customer, caseId, n])
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema gridex_private;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key,company_id uuid not null,merged_into_customer_id uuid,unique(id,company_id));`)
  for (const table of ['customer_cases', 'customer_case_events', 'audit_logs']) {
    await db.exec(source(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`)))
    await db.exec(source(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n    ADD CONSTRAINT ${table}_pkey [^;]+;`)))
  }
  await db.exec(source(/CREATE FUNCTION public\.gridex_normalize_audit_context_v1\(\) RETURNS trigger[\s\S]*?\n\$\$;/))
  await db.exec(source(/CREATE TRIGGER audit_logs_normalize_context_v1 [^;]+;/))
  await db.exec(source(/CREATE UNIQUE INDEX customer_cases_support_idempotency_key_uidx [^;]+;/))
  await db.exec(source(/CREATE UNIQUE INDEX customer_cases_support_public_reference_uidx [^;]+;/))
  await db.query('insert into public.companies values($1),($2)', [company, otherCompany])
  await db.query('insert into public.customers(id,company_id) values($1,$2),($3,$2),($4,$5)', [customer, company, otherCustomer, foreignCustomer, otherCompany])
  await db.exec(migration)
}, 20_000)
afterEach(async () => { await db.close() })

// Actual source DDL and new SQL execute; Auth context and unrelated contract/
// operational triggers are finite ports. PGlite queues one local connection:
// concurrent callers below do not claim native multi-session contention proof.
describe('atomic customer support quota SQL', () => {
  it('creates the case, original assessment, created event, first message, reference and audit together', async () => {
    const result = await create('first')
    const row = result.case
    expect(result.reused).toBe(false)
    expect(row).toMatchObject({ case_type: 'other', status: 'open', priority: 'normal',
      billing_blocked: false, billing_manual_review: false, cancellation_required: false,
      cancellation_status: 'not_required', withdrawal_scenario: 'not_withdrawal', next_action: nextAction,
      metadata: { support_case: true, support_channel: 'customer_portal', opened_by: 'customer',
        description_visibility: 'customer', support_idempotency_key: 'first', assessment, prodatSentAt: null } })
    const reference = 'support_case_' + createHash('sha256').update(`gridex-public-reference:v1:${company}:support_case:${row.id}`).digest('base64url').slice(0, 32)
    expect((row.metadata as Row).support_public_reference).toBe(reference)
    const events = (await db.query<Row>('select * from public.customer_case_events order by event_type')).rows
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event_type: 'created', message: `Annan orsak registrerat. ${nextAction}`, payload: { assessment } })
    expect(events[1]).toMatchObject({ event_type: 'support_customer_message', message: 'Original customer body', payload: { visibility: 'customer', author_type: 'customer', channel: 'customer_portal', api_client_id: client, portal_identity_id: identity } })
    const audit = (await db.query<Row>('select * from public.audit_logs')).rows
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'customer_case_registered', actor_user_id: null, actor_type: 'system', system_actor: 'unspecified_system_actor',
      entity_type: 'customer_case', entity_id: row.id, metadata: { customer_id: customer },
      new_values: { case_type: 'other', billing_blocked: false, metadata: { assessment } } })
  })

  it('admits only the fiftieth distinct case at the rolling daily boundary', async () => {
    await seedCases(49)
    const results = await Promise.allSettled([create('last-a'), create('last-b')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { message: 'support_case_quota_exceeded' } })
    expect(await count('public.customer_cases')).toBe(50)
  })

  it('replays the same key at full quota without another case, first message or audit', async () => {
    await seedCases(49)
    const first = await create('last')
    const before = [await count('public.customer_cases'), await count('public.customer_case_events'), await count('public.audit_logs')]
    const replay = await create('last')
    expect(replay.reused).toBe(true)
    expect(replay.case.id).toBe(first.case.id)
    expect([await count('public.customer_cases'), await count('public.customer_case_events'), await count('public.audit_logs')]).toEqual(before)
  })

  it('deduplicates queued same-key submissions before quota admission', async () => {
    await seedCases(49)
    const results = await Promise.all([create('same'), create('same')])
    expect(results.map(result => result.reused)).toEqual([false, true])
    expect(results[0].case.id).toBe(results[1].case.id)
    expect(await count('public.customer_cases')).toBe(50)
  })

  it('admits only the 150th message across cases of this customer', async () => {
    const first = await create('messages')
    await seedMessages(first.case.id, 148)
    const results = await Promise.allSettled([message(first.case.id), message(first.case.id)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { message: 'support_message_quota_exceeded' } })
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.customer_case_events where event_type='support_customer_message'")).rows[0].n).toBe(150)
  })

  it('does not add a new hourly gate to opening a case', async () => {
    const first = await create('before-full-hour')
    await seedMessages(first.case.id, 149)
    expect((await create('new-case-after-hour-full')).reused).toBe(false)
    await expect(message(first.case.id)).rejects.toMatchObject({ message: 'support_message_quota_exceeded' })
  })

  it('uses rolling windows and keeps other customers/tenants independent', async () => {
    await seedCases(50)
    await db.exec("update public.customer_cases set created_at=clock_timestamp()-interval '25 hours'")
    const first = await create('fresh-window')
    await seedMessages(first.case.id, 149)
    await db.exec("update public.customer_case_events set created_at=clock_timestamp()-interval '61 minutes'")
    await expect(message(first.case.id)).resolves.toBeDefined()
    await expect(create('other-customer', { customer: otherCustomer })).resolves.toBeDefined()
    await expect(create('other-company', { company: otherCompany, customer: foreignCustomer })).resolves.toBeDefined()
  })

  it('repairs only missing legacy reference/first body from the original row without new case quota or new audit', async () => {
    const first = await create('legacy')
    await db.query("delete from public.customer_case_events where customer_case_id=$1 and event_type='support_customer_message'", [first.case.id])
    await db.query("update public.customer_cases set metadata=metadata-'support_public_reference' where id=$1", [first.case.id])
    await seedCases(49)
    const replay = await create('legacy', { message: 'Replacement input must not overwrite original body' })
    expect(replay.reused).toBe(true)
    expect(replay.case.id).toBe(first.case.id)
    expect((replay.case.metadata as Row).support_public_reference).toBe((first.case.metadata as Row).support_public_reference)
    expect((await db.query<Row>("select message from public.customer_case_events where event_type='support_customer_message'")).rows).toEqual([{ message: 'Original customer body' }])
    expect(await count('public.customer_cases')).toBe(50)
    expect(await count('public.audit_logs')).toBe(1)
  })

  it('refuses a legacy repair without an original body and rolls back reference repair', async () => {
    const first = await create('legacy-no-body')
    await db.query("delete from public.customer_case_events where customer_case_id=$1 and event_type='support_customer_message'", [first.case.id])
    await db.query("update public.customer_cases set description=null,metadata=metadata-'support_public_reference' where id=$1", [first.case.id])
    await expect(create('legacy-no-body')).rejects.toMatchObject({ message: 'support_legacy_repair_unavailable' })
    expect((await db.query<{ metadata: Row }>('select metadata from public.customer_cases where id=$1', [first.case.id])).rows[0].metadata).not.toHaveProperty('support_public_reference')
  })

  it('refuses replay of a non-portal or operational case with the same key', async () => {
    const first = await create('wrong-channel')
    await db.query("update public.customer_cases set source='tenant_support_staff_api' where id=$1", [first.case.id])
    await expect(create('wrong-channel')).rejects.toMatchObject({ message: 'support_case_replay_scope_mismatch' })
    expect(await count('public.audit_logs')).toBe(1)
  })

  it('rechecks the owned open case at message admission', async () => {
    const first = await create('closed')
    await expect(message(first.case.id, otherCustomer)).rejects.toMatchObject({ message: 'support_case_not_found' })
    await db.query("update public.customer_cases set status='closed' where id=$1", [first.case.id])
    await expect(message(first.case.id)).rejects.toMatchObject({ message: 'support_case_closed' })
    expect(await count('public.customer_case_events')).toBe(2)
  })

  it('validates customer/tenant scope before creating any guard, case or message', async () => {
    await expect(create('foreign', { customer: foreignCustomer })).rejects.toMatchObject({ message: 'support_customer_not_found' })
    expect(await count('public.customer_cases')).toBe(0)
    expect(await count('gridex_private.customer_support_quota_guards')).toBe(0)
  })

  it('rolls back quota admission, case and audit if a later event write fails', async () => {
    await db.exec("create function public.fixture_reject_message() returns trigger language plpgsql as $$begin if NEW.event_type='support_customer_message' then raise exception 'synthetic later write failure'; end if; return NEW; end$$; create trigger fixture_later_write_failure before insert on public.customer_case_events for each row execute function public.fixture_reject_message();")
    await expect(create('failed-transaction')).rejects.toThrow('synthetic later write failure')
    for (const table of ['public.customer_cases', 'public.customer_case_events', 'public.audit_logs', 'gridex_private.customer_support_quota_guards']) expect(await count(table)).toBe(0)
    await db.exec('drop trigger fixture_later_write_failure on public.customer_case_events')
    expect((await create('failed-transaction')).reused).toBe(false)
  })

  it('restricts both RPCs and private guard rows to their service-only boundary', async () => {
    const functions = [
      'public.gridex_create_customer_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text)',
      'public.gridex_add_customer_support_message_v1(uuid,uuid,uuid,uuid,uuid,text)',
    ]
    for (const fn of functions) {
      const result = await db.query<{ role: string; allowed: boolean }>("select role,has_function_privilege(role,$1,'EXECUTE') as allowed from unnest(array['anon','authenticated','service_role']) role order by role", [fn])
      expect(result.rows).toEqual([{ role: 'anon', allowed: false }, { role: 'authenticated', allowed: false }, { role: 'service_role', allowed: true }])
      const security = await db.query<{ prosecdef: boolean; proconfig: string[] }>('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [fn])
      expect(security.rows[0].prosecdef).toBe(true)
      expect(security.rows[0].proconfig).toContain('search_path=pg_catalog')
    }
    const table = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='gridex_private.customer_support_quota_guards'::regclass")
    expect(table.rows[0].relrowsecurity).toBe(true)
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect((await db.query<{ allowed: boolean }>("select has_table_privilege($1,'gridex_private.customer_support_quota_guards','SELECT,INSERT,UPDATE,DELETE') as allowed", [role])).rows[0].allowed).toBe(false)
    }
    await db.exec('set role anon')
    await expect(create('anon')).rejects.toThrow(/permission denied/)
    await db.exec('reset role; set role service_role')
    expect((await create('service')).reused).toBe(false)
    await db.exec('reset role')
  })
})
