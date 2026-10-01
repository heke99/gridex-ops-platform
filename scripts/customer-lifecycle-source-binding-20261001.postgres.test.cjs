/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node --test CommonJS entrypoint; no production module or browser bundle. */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { fixture, root, migration } = require('./customer-lifecycle-source-binding-20261001-core.cjs')

test('actual current-schema withdrawal producer creates the required durable sourced decision', async () => {
  const f = await fixture()
  try {
    const result = await f.execute()
    assert.ok(result, `required decision missing; actual SQL errors: ${f.transport.errors.join(',')}`)
    const rows = (await f.db.query('select * from public.customer_lifecycle_decisions')).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].source_customer_case_id, f.caseRow.id)
    assert.equal(rows[0].decision_type, 'withdrawal')
    assert.equal(rows[0].billing_blocked, true)
    assert.equal(rows[0].scope_type, 'metering_point')
    assert.equal(rows[0].scope_id, f.id(4))
    assert.equal(rows[0].received_channel, 'phone')
    assert.equal(rows[0].notes, 'Owned staff note')
    assert.deepEqual(rows[0].received_at, f.caseRow.withdrawal_requested_at)
    assert.equal(rows[0].created_by, f.id(7))
  } finally { await f.close() }
})

test('current cancelled mapping is accepted for both existing cancellation case types', async () => {
  const f = await fixture()
  try {
    for (const [index, caseType] of ['onboarding_aborted', 'supplier_switch_aborted'].entries()) {
      const row = (await f.db.query(`insert into public.customer_cases(id,company_id,customer_id,case_type,title,billing_blocked) values($1,$2,$3,$4,'Owned cancellation',true) returning *`, [f.id(20 + index), f.id(1), f.id(2), caseType])).rows[0]
      const result = await f.execute(row)
      assert.ok(result, `missing cancelled decision; SQL errors: ${f.transport.errors.join(',')}`)
      assert.equal((await f.db.query('select decision_type from public.customer_lifecycle_decisions where id=$1', [result])).rows[0].decision_type, 'cancelled')
    }
  } finally { await f.close() }
})

test('the actual current old CHECK alone reproduces the missing cancelled type and forward fixes it', async () => {
  const f = await fixture({ baseline: true })
  try {
    const insert = () => f.db.query("insert into public.customer_lifecycle_decisions(customer_id,company_id,decision_type,reason) values($1,$2,'cancelled','Owned unbound legacy cancellation')", [f.id(2), f.id(1)])
    await assert.rejects(insert(), error => error.code === '23514')
    await f.db.exec(readFileSync(resolve(root, 'supabase/migrations', migration), 'utf8'))
    await insert()
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 1)
  } finally { await f.close() }
})

test('source-case replay survives a genuine title edit and retains original decision facts', async () => {
  const f = await fixture()
  try {
    const first = await f.execute()
    assert.ok(first)
    const before = await f.originalSnapshot()
    const edited = (await f.db.query("update public.customer_cases set title='Edited current title' where id=$1 returning *", [f.caseRow.id])).rows[0]
    assert.equal(await f.execute(edited), first)
    assert.deepEqual(await f.originalSnapshot(), before)
  } finally { await f.close() }
})

test('two concurrent actual producer calls resolve a genuine unique conflict to one sourced decision', async () => {
  const f = await fixture()
  try {
    const ids = await Promise.all([f.execute(), f.execute()])
    assert.ok(ids[0]); assert.equal(ids[1], ids[0])
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 1)
    assert.equal(f.transport.errors.filter(code => code === '23505').length, 1)
  } finally { await f.close() }
})

test('customer, contract, site and metering scopes bind to the current case hierarchy', async () => {
  const f = await fixture()
  try {
    for (const [index, scope] of ['customer', 'contract', 'site', 'metering_point'].entries()) {
      const values = [f.id(30 + index), f.id(1), f.id(2), index >= 2 ? f.id(3) : null, index === 3 ? f.id(4) : null, index >= 1 ? f.id(5) : null]
      const row = (await f.db.query("insert into public.customer_cases(id,company_id,customer_id,site_id,metering_point_id,customer_contract_id,case_type,title,billing_blocked) values($1,$2,$3,$4,$5,$6,'rejected_customer','Owned scoped rejection',true) returning *", values)).rows[0]
      const decision = await f.execute(row)
      assert.ok(decision)
      const stored = (await f.db.query('select scope_type,scope_id,decision_type from public.customer_lifecycle_decisions where id=$1', [decision])).rows[0]
      assert.equal(stored.scope_type, scope)
      assert.equal(stored.scope_id, [null, f.id(5), f.id(3), f.id(4)][index])
      assert.equal(stored.decision_type, 'rejected')
    }
  } finally { await f.close() }
})

test('current case identity and selected scope cannot be replaced by caller row fields', async () => {
  const f = await fixture()
  try {
    for (const patch of [
      { company_id: f.id(11), customer_id: f.id(12) },
      { metering_point_id: f.id(14) },
      { metering_point_id: null, site_id: f.id(13) },
      { metering_point_id: null, site_id: null, customer_contract_id: null },
      { case_type: 'onboarding_aborted' },
    ]) {
      await assert.rejects(f.execute({ ...f.caseRow, ...patch }), error => error.code === '23514')
    }
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 0)
  } finally { await f.close() }
})

test('an inconsistent current referenced resource prevents a new decision', async () => {
  const f = await fixture()
  try {
    await f.db.query('update public.metering_points set customer_id=$1,company_id=$2 where id=$3', [f.id(12), f.id(11), f.id(4)])
    await assert.rejects(f.execute(), error => error.code === '23514')
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 0)
  } finally { await f.close() }
})

test('a sourced decision cannot be detached or rewritten to another case identity', async () => {
  const f = await fixture()
  try {
    const decision = await f.execute()
    assert.ok(decision)
    const before = await f.originalSnapshot()
    await assert.rejects(f.db.query('update public.customer_lifecycle_decisions set source_customer_case_id=null where id=$1', [decision]), error => error.code === '23514')
    await assert.rejects(f.db.query("update public.customer_lifecycle_decisions set scope_type='customer',scope_id=null where id=$1", [decision]), error => error.code === '23514')
    assert.deepEqual(await f.originalSnapshot(), before)
  } finally { await f.close() }
})

test('nullable legacy row values survive the forward without historical backfill', async () => {
  const f = await fixture({ baseline: true })
  try {
    await f.db.query("insert into public.customer_lifecycle_decisions(id,company_id,customer_id,decision_type,reason,created_at) values($1,null,$2,'withdrawal','Historical retained reason','2026-05-01T00:00:00Z')", [f.id(40), f.id(2)])
    const before = await f.originalSnapshot()
    await f.db.exec(readFileSync(resolve(root, 'supabase/migrations', migration), 'utf8'))
    assert.deepEqual(await f.originalSnapshot(), before)
    assert.equal((await f.db.query('select source_customer_case_id,received_at,received_channel,notes from public.customer_lifecycle_decisions')).rows[0].source_customer_case_id, null)
    await f.db.query("update public.customer_lifecycle_decisions set notes='Ordinary authorized legacy note' where id=$1", [f.id(40)])
  } finally { await f.close() }
})

test('a late actual decision-insert fault rolls back that statement and preserves current case bytes', async () => {
  const f = await fixture()
  try {
    const before = await f.db.query('select to_jsonb(c) as value from public.customer_cases c order by id')
    await f.db.exec("create function private.owned_lifecycle_fault() returns trigger language plpgsql as $$ begin raise exception using errcode='PT500',message='owned_lifecycle_fault'; end $$; create trigger owned_lifecycle_fault after insert on public.customer_lifecycle_decisions for each row execute function private.owned_lifecycle_fault();")
    await assert.rejects(f.execute(), error => error.code === 'PT500')
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 0)
    assert.deepEqual(await f.db.query('select to_jsonb(c) as value from public.customer_cases c order by id'), before)
  } finally { await f.close() }
})

test('ordinary support does not create lifecycle decisions and a genuinely old missing schema retains explicit fallback', async () => {
  const f = await fixture({ baseline: true })
  try {
    assert.equal(await f.execute({ ...f.caseRow, case_type: 'other' }), null)
    assert.equal(f.transport.queries.length, 0)
    assert.equal(await f.execute(), null)
    assert.deepEqual(f.transport.errors, ['42703'])
  } finally { await f.close() }
})

test('an unrelated actual primary-key conflict cannot be mistaken for a source-case replay', async () => {
  const f = await fixture()
  try {
    await f.db.query(`alter table public.customer_lifecycle_decisions alter column id set default '${f.id(50)}'::uuid`)
    assert.ok(await f.execute())
    const row = (await f.db.query("insert into public.customer_cases(id,company_id,customer_id,case_type,title,billing_blocked) values($1,$2,$3,'withdrawal','Different current case',true) returning *", [f.id(51), f.id(1), f.id(2)])).rows[0]
    await assert.rejects(f.execute(row), error => error.code === '23505')
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 1)
  } finally { await f.close() }
})

test('a stale caller row cannot replay a sourced decision after its real current case scope changes', async () => {
  const f = await fixture()
  try {
    assert.ok(await f.execute())
    await f.db.query('update public.customer_cases set site_id=null,metering_point_id=null,customer_contract_id=null where id=$1', [f.caseRow.id])
    await assert.rejects(f.execute(), error => error.code === '23514')
    assert.equal((await f.db.query('select count(*)::int as count from public.customer_lifecycle_decisions')).rows[0].count, 1)
  } finally { await f.close() }
})

test('a forward with incompatible pre-existing receipt type fails without historical row rewrites', async () => {
  const f = await fixture({ baseline: true })
  try {
    await f.db.exec('alter table public.customer_lifecycle_decisions add column received_at text')
    await assert.rejects(f.db.exec('begin;'+readFileSync(resolve(root, 'supabase/migrations', migration), 'utf8')+'commit;'), error => error.code === 'P0001' && error.message === 'lifecycle_source_schema_incompatible')
    await f.db.exec('rollback')
    const columns = (await f.db.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name='customer_lifecycle_decisions' and column_name in ('source_customer_case_id','received_at') order by column_name")).rows
    assert.deepEqual(columns, [{ column_name: 'received_at', data_type: 'text' }])
  } finally { await f.close() }
})
