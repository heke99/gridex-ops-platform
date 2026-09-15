const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { stripTypeScriptTypes } = require('node:module')
const { resolve } = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')

const source = readFileSync(resolve(__dirname, '../lib/ediel/testing/testRunTransportMetadata.ts'), 'utf8')
const start = source.indexOf('async function acquireAgtRunLock(')
const end = source.indexOf('\nfunction expectedFlowFromSteps(', start)
assert(start >= 0 && end > start)
const implementation = stripTypeScriptTypes(source.slice(start, end))
const input = { companyId: 'company-a', actorRole: 'supplier', messageFamily: 'PRODAT', environmentType: 'agt_test', actorUserId: 'actor-a' }

function fixture({ row = null, insertError = null, selectError = null } = {}) {
  const calls = []; const filters = []
  const query = {
    select() { return this },
    eq(key, value) { filters.push([key, value]); return this },
    is(key, value) { filters.push([key, value]); return this },
    gt(key, value) { filters.push([key, value]); return this },
    limit() { return this },
    async maybeSingle() {
      const expires = filters.find(([key]) => key === 'expires_at')
      return { data: row && (!expires || row.expires_at > expires[1]) ? row : null, error: selectError }
    },
    async insert(value) {
      calls.push(value)
      // The actual pinned partial unique index includes every unreleased row,
      // independently of expires_at; this mock does not claim SQL execution.
      return { error: insertError || (row ? { code: '23505', message: 'unique violation' } : null) }
    },
  }
  const supabaseService = { from(table) { assert.equal(table, 'ediel_test_run_locks'); return query } }
  const run = vm.runInNewContext(implementation + '\nacquireAgtRunLock', { supabaseService, Date, Error })
  return { run, calls, filters }
}

test('expired unreleased lock remains busy without attempting a conflicting insert', async () => {
  const f = fixture({ row: { id: 'old-lock', expires_at: '2000-01-01T00:00:00Z', released_at: null } })
  await assert.rejects(f.run(input), /AGT-test/)
  assert.equal(f.calls.length, 0)
  assert(!f.filters.some(([key]) => key === 'expires_at'))
})

test('active lock remains busy and preserves the complete tenant and transport key', async () => {
  const f = fixture({ row: { id: 'active-lock', expires_at: '9999-01-01T00:00:00Z', released_at: null } })
  await assert.rejects(f.run(input), /AGT-test/)
  assert.deepEqual(f.filters, [['company_id', 'company-a'], ['actor_role', 'supplier'], ['message_family', 'PRODAT'], ['environment_type', 'agt_test'], ['released_at', null]])
  assert.equal(f.calls.length, 0)
})

test('successful acquisition writes tenant, actor and transport identity', async () => {
  const f = fixture(); await f.run(input)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].company_id, input.companyId)
  assert.equal(f.calls[0].metadata.actorUserId, input.actorUserId)
  assert.equal(f.calls[0].environment_type, 'agt_test')
})

test('a competing acquisition is reported as busy while the unique index arbitrates', async () => {
  const f = fixture({ insertError: { code: '23505', message: 'unique violation' } })
  await assert.rejects(f.run(input), /AGT-test/)
  assert.equal(f.calls.length, 1)
})

test('other database failures propagate and non-AGT work does not acquire a lock', async () => {
  const error = { code: '42501', message: 'denied' }
  const f = fixture({ selectError: error })
  await assert.rejects(f.run(input), value => value === error)
  assert.equal(f.calls.length, 0)
  await f.run({ ...input, environmentType: 'tgt_test' })
  assert.equal(f.calls.length, 0)
})
