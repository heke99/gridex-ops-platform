import assert from 'node:assert/strict'
import type { ProcessManualEmailOutboxResult } from '@/lib/email/manualEmailOutbox'

type Row = Record<string, unknown>
type Response = { data: Row[] | Row | null; error: Error | null }
type Query = { table: string; patch: Row | null; filters: Array<[string, string, unknown]> }
type Process = (input?: { companyId?: string | null; limit?: number }) => Promise<ProcessManualEmailOutboxResult>
type ManualLoader = (fixture: ReturnType<typeof manualFixture>) => Process
type AnalyticsLoader = (fixture: ReturnType<typeof analyticsFixture>) => () => Promise<string[]>

// The fake applies the production query's actual predicates to persisted rows.
// Hooks change persisted state at awaited boundaries, never the candidate snapshot.
export function manualFixture() {
  const row: Row = {
    id: 'email-A', company_id: 'A', status: 'queued', external_delivery: true,
    attempts: 0, request_id: 'request-A', next_attempt_at: '2020-01-01', queued_at: '2020-01-01',
    locked_at: null, locked_by: null, to_email: 'recipient@example.test',
    actual_recipient_email: 'recipient@example.test', from_email: 'sender@example.test',
    provider_idempotency_key: 'stable-key-A',
  }
  const request: Row = { id: 'request-A', company_id: 'A', status: 'manual_email_queued', metadata: {} }
  const foreign: Row = { ...row, company_id: 'B', locked_by: 'OTHER-B', status: 'sending', locked_at: new Date().toISOString() }
  const foreignRequest: Row = { ...request, company_id: 'B' }
  const state = {
    row, request, foreign, foreignRequest,
    mutations: [] as Query[], calls: [] as Query[], sends: [] as Row[], policies: [] as string[],
    beforeQuery: (query: Query): Response | undefined => { void query; return undefined },
    policy: async (call: number) => { void call; return { allowed: true, reason_code: 'allowed', company_status: 'active' } },
    reserved: async () => false,
    send: async (input: Row) => { void input; return { providerMessageId: 'provider-A', status: 'sent' as const } },
    db: { from },
  }
  function from(table: string) {
    const query: Query = { table, patch: null, filters: [] }
    let single = false
    let maximum = Infinity
    const q = {
      update(patch: Row) { query.patch = patch; return q },
      select() { return q },
      eq(key: string, value: unknown) { query.filters.push(['eq', key, value]); return q },
      in(key: string, value: unknown[]) { query.filters.push(['in', key, value]); return q },
      lt(key: string, value: unknown) { query.filters.push(['lt', key, value]); return q },
      lte(key: string, value: unknown) { query.filters.push(['lte', key, value]); return q },
      order() { return q },
      limit(n: number) { maximum = n; return q },
      maybeSingle() { single = true; return q },
      then(resolve: (value: Response) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          state.calls.push(query)
          const response = state.beforeQuery(query)
          if (response) return response
          const all = table === 'manual_email_outbox' ? [row, foreign]
            : table === 'grid_owner_information_requests' ? [request, foreignRequest] : []
          const matched = all.filter((entry) => query.filters.every(([op, key, value]) => {
            if (op === 'eq') return entry[key] === value
            if (op === 'in') return (value as unknown[]).includes(entry[key])
            if (entry[key] == null) return false
            return op === 'lt' ? String(entry[key]) < String(value) : String(entry[key]) <= String(value)
          })).slice(0, maximum)
          if (query.patch && matched.length) {
            state.mutations.push(query)
            for (const entry of matched) Object.assign(entry, query.patch)
          }
          const data = matched.map((entry) => ({ ...entry }))
          return { data: single ? data[0] ?? null : data, error: null }
        }).then(resolve, reject)
      },
    }
    return q
  }
  return state
}

function takeOtherLease(f: ReturnType<typeof manualFixture>, status = 'sending') {
  Object.assign(f.row, { status, locked_by: status === 'sent' ? null : 'OTHER-WORKER', locked_at: new Date().toISOString(), attempts: 3 })
}
function assertUntouchedForeign(f: ReturnType<typeof manualFixture>) {
  assert.equal(f.foreign.status, 'sending')
  assert.equal(f.foreign.locked_by, 'OTHER-B')
  assert.equal(f.foreignRequest.status, 'manual_email_queued')
}
function noProjection(f: ReturnType<typeof manualFixture>) {
  assert.equal(f.request.status, 'manual_email_queued')
  assert.equal(f.calls.filter((q) => q.table === 'grid_owner_information_requests').length, 0)
  assertUntouchedForeign(f)
}

export const manualCases: Array<{ name: string; run: (load: ManualLoader) => Promise<void> }> = [
  {
    name: 'preclaim policy failure cannot clear another worker lease or count an owned failure',
    async run(load) {
      const f = manualFixture()
      f.policy = async () => { takeOtherLease(f); throw new Error('policy unavailable') }
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'sending'); assert.equal(f.row.locked_by, 'OTHER-WORKER')
      assert.equal(f.row.attempts, 3); assert.equal(result.claimed, 0); assert.equal(result.failed, 0)
      assert.equal(result.skipped, 1); assert.match(result.errors.join('|'), /preclaim.*policy unavailable/)
      assert.equal(f.mutations.length, 0); assert.equal(f.sends.length, 0); noProjection(f)
    },
  },
  ...[false, true].map((committed) => ({
    name: `claim response failure with commit=${committed} does not assume ownership`,
    async run(load: ManualLoader) {
      const f = manualFixture()
      f.beforeQuery = (q) => {
        if (q.patch?.status === 'sending') {
          if (committed) Object.assign(f.row, q.patch)
          return { data: null, error: new Error('claim response unavailable') }
        }
      }
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, committed ? 'sending' : 'queued')
      assert.equal(f.row.attempts, 0); assert.equal(f.mutations.length, 0)
      assert.equal(result.claimed, 0); assert.equal(result.failed, 0); assert.equal(result.skipped, 1)
      assert.match(result.errors.join('|'), /preclaim.*claim response unavailable/)
      assert.equal(f.sends.length, 0); noProjection(f)
    },
  })),
  {
    name: 'zero-row claim is an observable skip without a provider call',
    async run(load) {
      const f = manualFixture()
      f.beforeQuery = (q) => { if (q.patch?.status === 'sending') takeOtherLease(f) }
      const result = await load(f)({ companyId: 'A' })
      assert.equal(result.claimed, 0); assert.equal(result.skipped, 1); assert.equal(result.failed, 0)
      assert.match(result.errors.join('|'), /claim_lost/)
      assert.equal(f.sends.length, 0); assert.equal(f.row.locked_by, 'OTHER-WORKER'); noProjection(f)
    },
  },
  ...['sending', 'sent'].flatMap((status) => ['transport', 'failure-write'].map((boundary) => ({
    name: `lost ownership to ${status} at ${boundary} cannot retry or project terminal failure`,
    async run(load: ManualLoader) {
      const f = manualFixture()
      f.row.attempts = 4
      f.policy = async (call) => {
        if (call === 2) { if (boundary === 'transport') takeOtherLease(f, status); throw new Error('transport policy unavailable') }
        return { allowed: true, reason_code: 'allowed', company_status: 'active' }
      }
      f.beforeQuery = (q) => { if (boundary === 'failure-write' && q.patch?.last_error_code === 'send_failed') takeOtherLease(f, status) }
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, status); assert.equal(f.row.attempts, 3)
      assert.equal(f.row.locked_by, status === 'sent' ? null : 'OTHER-WORKER')
      assert.equal(result.claimed, 1); assert.equal(result.failed, 0); assert.equal(result.skipped, 1)
      assert.match(result.errors.join('|'), /claim_lost_before_failure_persistence/)
      assert.equal(f.sends.length, 0); noProjection(f)
    },
  }))),
  {
    name: 'owned transient failure retains exponential retry and stable provider key',
    async run(load) {
      const f = manualFixture(); f.row.attempts = 2
      f.send = async () => { throw new Error('temporary provider rejection') }
      const before = Date.now()
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'queued'); assert.equal(f.row.attempts, 3); assert.equal(f.row.locked_by, null)
      const delay = Date.parse(String(f.row.next_attempt_at)) - before
      assert.ok(delay >= 20 * 60_000 && delay < 20 * 60_000 + 10_000)
      assert.equal(result.failed, 1); assert.equal(result.sent, 0)
      assert.equal(f.sends[0].idempotencyKey, 'stable-key-A'); assert.deepEqual(f.policies, ['A', 'A'])
      noProjection(f)
    },
  },
  {
    name: 'owned fifth failure terminalizes and projects only the same company request',
    async run(load) {
      const f = manualFixture(); f.row.attempts = 4
      f.send = async () => { throw new Error('provider rejection') }
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'failed'); assert.equal(f.row.attempts, 5); assert.equal(f.row.next_attempt_at, null)
      assert.equal(result.failed, 1); assert.equal(f.request.status, 'needs_review')
      assert.equal(f.request.dispatch_error_code, 'send_failed'); assertUntouchedForeign(f)
    },
  },
  {
    name: 'failure persistence error leaves lease and linked request untouched without fake failure success',
    async run(load) {
      const f = manualFixture(); f.row.attempts = 4
      f.send = async () => { throw new Error('provider rejection') }
      f.beforeQuery = (q) => q.patch?.last_error_code === 'send_failed' ? { data: null, error: new Error('failure persistence unavailable') } : undefined
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'sending'); assert.equal(f.row.attempts, 4)
      assert.equal(result.failed, 0); assert.equal(result.skipped, 1)
      assert.match(result.errors.join('|'), /failure-update.*failure persistence unavailable/); noProjection(f)
    },
  },
  ...['owned', 'sent', 'sending', 'write-error'].map((outcome) => ({
    name: `provider acceptance then failed persistence (${outcome}) never requeues or projects unowned failure`,
    async run(load: ManualLoader) {
      const f = manualFixture()
      f.beforeQuery = (q) => {
        if (q.patch?.status === 'sent') {
          if (outcome === 'sent' || outcome === 'sending') takeOtherLease(f, outcome)
          return { data: null, error: new Error('sent persistence unavailable') }
        }
        if (q.patch?.status === 'delivery_uncertain' && q.filters.some(([, key]) => key === 'locked_by') && outcome === 'write-error') {
          return { data: null, error: new Error('uncertain persistence unavailable') }
        }
      }
      const process = load(f)
      const result = await process({ companyId: 'A' })
      assert.equal(result.sent, 0); assert.equal(result.failed, 0); assert.equal(result.deliveryUncertain, 1)
      assert.equal(f.sends.length, 1)
      if (outcome === 'owned') {
        assert.equal(f.row.status, 'delivery_uncertain'); assert.equal(f.row.next_attempt_at, null)
        assert.equal(f.row.provider_message_id, 'provider-A'); assert.equal(f.request.dispatch_error_code, 'delivery_uncertain')
      } else {
        assert.equal(f.row.status, outcome === 'sent' ? 'sent' : 'sending')
        assert.match(result.errors.join('|'), /delivery-uncertain-update/); noProjection(f)
      }
      await process({ companyId: 'A' }); assert.equal(f.sends.length, 1); assertUntouchedForeign(f)
    },
  })),
  ...['recipient', 'reserved'].map((guard) => ({
    name: `${guard} validation remains a permanent owned failure before provider delivery`,
    async run(load: ManualLoader) {
      const f = manualFixture()
      if (guard === 'recipient') f.row.actual_recipient_email = 'different@example.test'
      else f.reserved = async () => true
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'failed'); assert.equal(result.failed, 1); assert.equal(f.sends.length, 0)
      assert.equal(f.request.status, 'needs_review'); assertUntouchedForeign(f)
    },
  })),
  ...[1, 2].map((deniedCall) => ({
    name: `tenant policy gate ${deniedCall} prevents delivery`,
    async run(load: ManualLoader) {
      const f = manualFixture()
      f.policy = async (call) => ({ allowed: call !== deniedCall, reason_code: 'tenant_paused', company_status: 'paused' })
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, deniedCall === 1 ? 'queued' : 'blocked_tenant_state')
      assert.equal(result.skipped, 1); assert.equal(f.sends.length, 0); noProjection(f)
    },
  })),
  {
    name: 'lost tenant-block transition cannot retry a reclaimed row',
    async run(load) {
      const f = manualFixture()
      f.policy = async (call) => {
        if (call === 2) takeOtherLease(f)
        return { allowed: call !== 2, reason_code: 'tenant_paused', company_status: 'paused' }
      }
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'sending'); assert.equal(f.row.locked_by, 'OTHER-WORKER')
      assert.equal(result.failed, 0); assert.match(result.errors.join('|'), /claim_lost/)
      assert.equal(f.sends.length, 0); noProjection(f)
    },
  },
  {
    name: 'successful send and linked projection remain terminal on later invocation',
    async run(load) {
      const f = manualFixture(); const process = load(f)
      const result = await process({ companyId: 'A' })
      assert.equal(result.sent, 1); assert.equal(f.row.status, 'sent')
      assert.equal(f.request.status, 'waiting_manual_response')
      await process({ companyId: 'A' }); assert.equal(f.sends.length, 1); assertUntouchedForeign(f)
    },
  },
  {
    name: 'accepted sent transition plus linked projection failure does not retry delivery',
    async run(load) {
      const f = manualFixture()
      f.beforeQuery = (q) => q.table === 'grid_owner_information_requests' && q.patch?.status === 'waiting_manual_response'
        ? { data: null, error: new Error('linked projection unavailable') } : undefined
      const process = load(f); const result = await process({ companyId: 'A' })
      assert.equal(result.sent, 1); assert.equal(result.failed, 0); assert.equal(f.row.status, 'sent')
      assert.equal(f.request.dispatch_error_code, 'post_send_projection_failed')
      await process({ companyId: 'A' }); assert.equal(f.sends.length, 1); assertUntouchedForeign(f)
    },
  },
  {
    name: 'stale sending recovery still marks uncertainty and never resends automatically',
    async run(load) {
      const f = manualFixture()
      Object.assign(f.row, { status: 'sending', locked_by: 'DEAD-WORKER', locked_at: '2020-01-01' })
      const result = await load(f)({ companyId: 'A' })
      assert.equal(f.row.status, 'delivery_uncertain'); assert.equal(f.request.dispatch_error_code, 'delivery_uncertain')
      assert.equal(result.claimed, 0); assert.equal(f.sends.length, 0); assertUntouchedForeign(f)
    },
  },
]

export function analyticsFixture(count: number) {
  const state = {
    rows: Array.from({ length: count }, (_, i) => ({ id: `company-${String(i).padStart(6, '0')}`, status: 'active', is_active: false })),
    queries: [] as Array<{ limit: number; after: string | null; order: string | null; statuses: string[] }>,
    failPage: 0, error: new Error('company page unavailable'), beforePage: (page: number) => { void page },
    db: { from },
  }
  function from(table: string) {
    assert.equal(table, 'companies')
    const request = { limit: 1000, after: null as string | null, order: null as string | null, statuses: [] as string[] }
    const q = {
      select() { return q },
      in(key: string, statuses: string[]) { assert.equal(key, 'status'); request.statuses = statuses; return q },
      order(key: string, options: { ascending: boolean }) { assert.equal(options.ascending, true); request.order = key; return q },
      gt(key: string, after: string) { assert.equal(key, 'id'); request.after = after; return q },
      limit(n: number) { request.limit = n; return q },
      then(resolve: (value: { data: Array<{ id: string }> | null; error: Error | null }) => unknown, reject?: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          state.queries.push(request)
          state.beforePage(state.queries.length)
          if (state.failPage === state.queries.length) return { data: null, error: state.error }
          let rows = state.rows.filter((row) => request.statuses.includes(row.status) && (!request.after || row.id > request.after))
          if (request.order === 'id') rows = rows.toSorted((a, b) => a.id.localeCompare(b.id))
          return { data: rows.slice(0, Math.min(request.limit, 1000)).map(({ id }) => ({ id })), error: null }
        }).then(resolve, reject)
      },
    }
    return q
  }
  return state
}

export const analyticsCases: Array<{ name: string; run: (load: AnalyticsLoader) => Promise<void> }> = [
  ...[0, 200, 1000, 1001, 1603].map((count) => ({
    name: `enumerates all ${count} eligible companies in stable bounded pages`,
    async run(load: AnalyticsLoader) {
      const f = analyticsFixture(count); const expected = f.rows.map((row) => row.id)
      f.rows.reverse()
      const ids = await load(f)()
      assert.deepEqual(Array.from(ids), expected)
      assert.equal(new Set(ids).size, count)
      for (const query of f.queries) {
        assert.ok(query.limit < 1000); assert.equal(query.order, 'id')
        assert.deepEqual(Array.from(query.statuses), ['active', 'onboarding'])
      }
      const pageSize = f.queries[0].limit
      assert.equal(f.queries.length, Math.floor(count / pageSize) + 1)
      if (count >= pageSize) assert.equal(f.queries[1].after, expected[pageSize - 1])
    },
  })),
  {
    name: 'status governance applies on every page and ignores legacy is_active',
    async run(load) {
      const f = analyticsFixture(1400)
      f.rows.forEach((row, i) => { row.status = i % 5 === 0 ? 'paused' : i % 2 === 0 ? 'onboarding' : 'active'; row.is_active = row.status === 'paused' })
      const expected = f.rows.filter((row) => row.status !== 'paused').map((row) => row.id)
      assert.deepEqual(Array.from(await load(f)()), expected)
    },
  },
  ...[1, 2].map((page) => ({
    name: `page ${page} errors propagate instead of returning partial company coverage`,
    async run(load: AnalyticsLoader) {
      const f = analyticsFixture(1600); f.failPage = page
      await assert.rejects(load(f), (error: unknown) => error === f.error)
      assert.equal(f.queries.length, page)
    },
  })),
  {
    name: 'deletion behind the cursor cannot shift a later company out of coverage',
    async run(load) {
      const f = analyticsFixture(1600); const expected = f.rows.map((row) => row.id)
      f.beforePage = (page) => { if (page === 2) f.rows.shift() }
      assert.deepEqual(Array.from(await load(f)()), expected)
    },
  },
]
