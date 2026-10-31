import { beforeEach, describe, expect, it, vi } from 'vitest'

// Fynd 023: the real worker catch path must persist a readable, bounded
// last_error for non-Error throwables (PostgREST error objects) without raw
// details/hint that may carry payload data.
const io = vi.hoisted(() => ({ get: vi.fn(), from: vi.fn(), rpc: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: io.get }))
vi.mock('@/lib/ediel/transport', () => ({ sendEdielMessageViaSmtp: vi.fn() }))
import { sendOutboxItem } from '@/lib/ediel/outbox/sendOutboxItem'

const at = '2026-10-30T12:00:00.000Z'
let queued: Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime(new Date(at))
  queued = { id: 'own-outbox', company_id: 'own-company', environment: 'test', ediel_message_id: 'own-message',
    status: 'sending', locked_by: 'own-worker', locked_at: at, current_send_attempt_id: 'own-attempt', attempts: 2 }
  io.from.mockImplementation((table: string) => {
    if (table !== 'ediel_outbox') throw Error(`undeclared_table:${table}`)
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const result = () => {
      if (!filters.every(([key, value]) => queued[key] === value)) return { data: null, error: null }
      if (patch) Object.assign(queued, patch)
      return { data: structuredClone(queued), error: null }
    }
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q },
      update: (value: Record<string, unknown>) => { patch = value; return q }, maybeSingle: async () => result() }
    return q
  })
  for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(io.log)
})

const send = () => sendOutboxItem({ actorUserId: 'own-worker', outboxItemId: 'own-outbox', workerId: 'own-worker', alreadyClaimed: true })

async function failWith(thrown: unknown) {
  io.get.mockImplementation(async () => { throw thrown })
  const result = await send()
  expect(result.status).toBe('failed')
  expect(queued).toMatchObject({ status: 'failed', attempts: 2, locked_at: null, locked_by: null })
  expect(result.error).toBe(queued.last_error)
  return String(queued.last_error)
}

describe('sendOutboxItem structured last_error', () => {
  it('keeps PostgREST code and message instead of [object Object]', async () => {
    const lastError = await failWith({ code: 'PGRST116', message: 'Results contain 5 rows', details: null, hint: null })
    expect(lastError).toBe('PGRST116: Results contain 5 rows')
  })

  it('never copies raw details/hint payload data into last_error or logs', async () => {
    const lastError = await failWith({ code: '23514', message: 'check violation',
      details: "Failing row contains (UNB+UNOC:3+secret')", hint: "UNB+hint'" })
    expect(lastError).toBe('23514: check violation')
    expect(lastError).not.toContain('UNB+')
    expect(JSON.stringify(io.log.mock.calls)).not.toContain('UNB+')
  })

  it('bounds the message length', async () => {
    const lastError = await failWith({ code: 'X1', message: 'm'.repeat(2000) })
    expect(lastError.length).toBeLessThanOrEqual(520)
  })

  it('includes .code on Error instances', async () => {
    expect(await failWith(Object.assign(new Error('boom'), { code: 'ECONNRESET' }))).toBe('ECONNRESET: boom')
  })

  it('keeps plain Error and string behaviour', async () => {
    expect(await failWith(new Error('plain'))).toBe('plain')
    queued = { ...queued, status: 'sending', locked_by: 'own-worker', locked_at: at }
    expect(await failWith('string_reason')).toBe('string_reason')
  })

  it('maps unknown values to unknown_error', async () => {
    expect(await failWith(42)).toBe('unknown_error')
    queued = { ...queued, status: 'sending', locked_by: 'own-worker', locked_at: at }
    expect(await failWith({ foo: 'bar' })).toBe('unknown_error')
  })
})
