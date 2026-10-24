import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  queue: [] as Array<Record<string, unknown>>, clock: 0, claimDelay: 0,
  claims: [] as Array<Record<string, unknown>>, releases: [] as Array<Record<string, unknown>>,
  decisionHook: null as null | (() => void), send: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_ediel_outbox_items') {
      io.claims.push(args)
      const rows = io.queue.filter(row => ['queued', 'prepared'].includes(String(row.status))).slice(0, Number(args.p_limit))
      for (const row of rows) Object.assign(row, { status: 'sending', locked_by: args.p_worker_id, current_send_attempt_id: `attempt-${io.claims.length}` })
      const data = rows.map(row => ({ ...row }))
      io.clock += io.claimDelay
      return { data, error: null }
    }
    if (name === 'canonical_block_claimed_ediel_outbox_item') {
      const row = io.queue.find(row => row.id === args.p_outbox_item_id && row.locked_by === args.p_worker_id && row.status === 'sending')
      if (!row) return { data: null, error: new Error('claim_lost') }
      Object.assign(row, { status: 'blocked_tenant_state', locked_by: null })
      return { data: 'blocked_tenant_state', error: null }
    }
    throw Error(`unexpected_rpc_${name}`)
  },
  from: (table: string) => {
    if (table !== 'ediel_outbox') throw Error('unexpected_table')
    const filters: Record<string, unknown> = {}; let payload: Record<string, unknown> = {}
    const query = {
      update: (value: Record<string, unknown>) => { payload = value; return query },
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      is: (key: string, value: unknown) => { filters[key] = value; return query },
      select: () => query,
      maybeSingle: async () => {
        io.releases.push({ ...filters })
        const row = io.queue.find(row => Object.entries(filters).every(([key, value]) => row[key] === value))
        if (!row) return { data: null, error: null }
        Object.assign(row, payload); return { data: { id: row.id }, error: null }
      },
    }
    return query
  },
} }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async (company: string) => {
  io.decisionHook?.()
  return { allowed: company !== 'denied', reason_code: 'tenant_suspended', company_status: 'suspended' }
} }))
vi.mock('@/lib/ediel/outbox/sendOutboxItem', () => ({ sendOutboxItem: io.send }))
vi.mock('@/lib/ediel/automationActor', () => ({ resolveConfiguredEdielAutomationActorId: async () => 'automation' }))
import { GET } from '@/app/api/ediel/outbox/process/route'
import { NextRequest } from 'next/server'
import { drainEdielOutbox } from '@/lib/ediel/outbox/drainEdielOutbox'
import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'
import { claimEdielOutboxItems, releaseUnsentEdielOutboxClaim } from '@/lib/ediel/outbox/claimOutboxItems'
const row = (id: string, company_id = 'allowed') => ({ id, company_id, environment: 'test', status: 'queued', locked_by: null, current_send_attempt_id: null })
const drain = (extra = {}) => drainEdielOutbox({ actorUserId: 'automation', environment: 'test', now: () => io.clock, ...extra })
beforeEach(() => {
  io.queue = []; io.clock = 0; io.claimDelay = 0; io.claims = []; io.releases = []; io.decisionHook = null
  io.send.mockReset().mockImplementation(async ({ outboxItemId }: { outboxItemId: string }) => {
    io.queue.find(row => row.id === outboxItemId)!.status = 'sent'; return { status: 'sent', messageId: 'fixture' }
  })
})
it('drains past 25 denied tenant claims and sends the following allowed acknowledgement', async () => {
  io.queue = [...Array.from({ length: 25 }, (_, i) => row(`denied-${i}`, 'denied')), row('allowed-ack')]
  const result = await drain()
  expect(result).toMatchObject({ claimed: 26, processed: 1, sent: 1, blocked: 25, stoppedBy: 'queue_empty' })
  expect(io.queue.filter(r => r.status === 'queued')).toHaveLength(0)
  expect(io.send).toHaveBeenCalledTimes(1)
  expect(io.send.mock.calls[0][0]).toMatchObject({ outboxItemId: 'allowed-ack', alreadyClaimed: true })
})
it('checks admission before each claim and send, allowing only the last in-flight send to finish', async () => {
  io.queue = Array.from({ length: 30 }, (_, i) => row(`slow-${i}`))
  io.send.mockImplementation(async ({ outboxItemId }: { outboxItemId: string }) => {
    io.clock += 6_000; io.queue.find(row => row.id === outboxItemId)!.status = 'sent'; return { status: 'sent' }
  })
  expect(await drain({ budgetMs: 45_000 })).toMatchObject({ processed: 8, claimed: 8, stoppedBy: 'budget' })
  expect(io.clock).toBe(48_000); expect(io.claims).toHaveLength(8)
  expect(io.queue.filter(r => r.status === 'queued')).toHaveLength(22)
  expect(io.releases).toHaveLength(0)
})
it('releases a slow claim before any send when the deadline passed during claiming', async () => {
  io.queue = [row('slow-claim')]; io.claimDelay = 50
  expect(await drain({ budgetMs: 45 })).toMatchObject({ claimed: 1, processed: 0, stoppedBy: 'budget' })
  expect(io.send).not.toHaveBeenCalled(); expect(io.queue[0].status).toBe('queued')
  expect(io.releases[0]).toMatchObject({ id: 'slow-claim', status: 'sending', current_send_attempt_id: 'attempt-1', locked_by: expect.any(String) })
})
it('does not overwrite a concurrent replacement claim or report a zero-row release as success', async () => {
  io.queue = [row('changed')]
  io.decisionHook = () => { io.clock = 50; Object.assign(io.queue[0], { locked_by: 'other-worker', current_send_attempt_id: 'new-attempt' }) }
  await expect(drain({ budgetMs: 45 })).rejects.toThrow('ediel_outbox_unsent_release_claim_lost')
  expect(io.send).not.toHaveBeenCalled()
  expect(io.queue[0]).toMatchObject({ status: 'sending', locked_by: 'other-worker', current_send_attempt_id: 'new-attempt' })
})
it('never requeues or releases an in-flight send when the clock crosses the budget', async () => {
  io.queue = [row('uncertain'), row('later')]
  io.send.mockImplementation(async () => { io.clock = 100; io.queue[0].status = 'delivery_uncertain'; return { status: 'delivery_uncertain' } })
  expect(await drain({ budgetMs: 45 })).toMatchObject({ processed: 1, deliveryUncertain: 1, stoppedBy: 'budget' })
  expect(io.queue[0].status).toBe('delivery_uncertain'); expect(io.releases).toHaveLength(0); expect(io.claims).toHaveLength(1)
})
it('rate or retry deferral that requeues a row does not resend it in the same drain', async () => {
  io.queue = [row('retry')]
  io.send.mockImplementation(async () => { io.queue[0].status = 'queued'; return { status: 'blocked', error: 'rate_limit_fixture' } })
  expect(await drain({ limit: 1 })).toMatchObject({ processed: 1, blocked: 1, stoppedBy: 'repeated_rows' })
  expect(io.send).toHaveBeenCalledTimes(1); expect(io.queue[0].status).toBe('queued'); expect(io.releases).toHaveLength(1)
})
it('retains distinct send outcomes and finite max-batch bound', async () => {
  io.queue = [row('rate'), row('failed'), row('later')]
  io.send.mockImplementation(async ({ outboxItemId }: { outboxItemId: string }) => {
    const status = outboxItemId === 'rate' ? 'blocked' : 'failed'; io.queue.find(r => r.id === outboxItemId)!.status = status; return { status }
  })
  expect(await drain({ limit: 1, maxBatches: 2 })).toMatchObject({ claimed: 2, processed: 2, blocked: 1, failed: 1, batches: 2, stoppedBy: 'max_batches' })
  expect(io.queue[2].status).toBe('queued')
})
it('a zero budget starts neither a claim nor a send', async () => {
  io.queue = [row('untouched')]
  expect(await drain({ budgetMs: 0 })).toMatchObject({ batches: 0, claimed: 0, processed: 0, stoppedBy: 'budget' })
  expect(io.claims).toHaveLength(0); expect(io.send).not.toHaveBeenCalled()
})
it('preserves the existing array claim API and per-process unique worker identities', async () => {
  io.queue = [row('legacy')]
  expect(await claimEdielOutboxItems({ workerId: 'legacy-worker', limit: 1 })).toHaveLength(1)
  io.queue = [row('one')]; await processEdielOutbox({ actorUserId: 'same', limit: 1 })
  io.queue = [row('two')]; await processEdielOutbox({ actorUserId: 'same', limit: 1 })
  expect(io.claims[1].p_worker_id).not.toBe(io.claims[2].p_worker_id)
})
it('fences a null-attempt pre-send release with IS NULL rather than omitting the attempt condition', async () => {
  io.queue = [{ ...row('null-attempt'), status: 'sending', locked_by: 'worker' }]
  await releaseUnsentEdielOutboxClaim(io.queue[0] as never, 'worker')
  expect(io.releases[0]).toEqual({ company_id: 'allowed', id: 'null-attempt', status: 'sending', locked_by: 'worker', current_send_attempt_id: null })
  expect(io.queue[0].status).toBe('queued')
})

afterEach(() => { vi.unstubAllEnvs() })
it('cron route retains secret authorization and never starts work for an unauthorized request', async () => {
  vi.stubEnv('EDIEL_CRON_SECRET', 'private-test-secret'); vi.stubEnv('CRON_SECRET', '')
  const response = await GET(new NextRequest('https://example.invalid/api/ediel/outbox/process'))
  expect(response.status).toBe(401); expect(io.claims).toHaveLength(0); expect(io.send).not.toHaveBeenCalled()
})
it('authorized cron binds the drain globally and retains ignored company overrides', async () => {
  vi.stubEnv('EDIEL_CRON_SECRET', 'private-test-secret'); vi.stubEnv('CRON_SECRET', '')
  io.queue = [...Array.from({ length: 25 }, (_, i) => row(`route-denied-${i}`, 'denied')), row('route-ack')]
  const response = await GET(new NextRequest('https://example.invalid/api/ediel/outbox/process?companyId=tenant-override&environment=test', {
    headers: { authorization: 'Bearer private-test-secret' },
  }))
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ companyId: null, ignoredCompanyOverride: 'blocked_on_generic_cron', result: { claimed: 26, sent: 1, blocked: 25, stoppedBy: 'queue_empty' } })
  expect(io.claims.every(claim => claim.p_company_id === null && claim.p_environment === 'test')).toBe(true)
})

it('refuses a pre-send release after a concurrent company change and never starts a send', async () => {
  io.queue = [row('moved-company')]
  io.decisionHook = () => { io.clock = 50; io.queue[0].company_id = 'other-company' }
  await expect(drain({ budgetMs: 45 })).rejects.toThrow('ediel_outbox_unsent_release_claim_lost')
  expect(io.send).not.toHaveBeenCalled()
  expect(io.queue[0]).toMatchObject({ company_id: 'other-company', status: 'sending', locked_by: expect.any(String), current_send_attempt_id: 'attempt-1' })
  expect(io.releases[0]).toMatchObject({ company_id: 'allowed', id: 'moved-company', status: 'sending', current_send_attempt_id: 'attempt-1', locked_by: expect.any(String) })
})
it('blocks a raw claim without company scope before any release query or send', async () => {
  io.queue = [{ ...row('missing-company'), company_id: null }]
  expect(await drain()).toMatchObject({ claimed: 1, processed: 0, sent: 0, blocked: 1, stoppedBy: 'queue_empty' })
  expect(io.queue[0].status).toBe('blocked_tenant_state')
  expect(io.releases).toHaveLength(0); expect(io.send).not.toHaveBeenCalled()
})
