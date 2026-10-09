import { beforeEach, describe, expect, it, vi } from 'vitest'

// Finite SDK ports execute the actual case helper. The unique index and native
// concurrent processing have separate database and acceptance evidence.
const state = vi.hoisted(() => ({
  reads: [] as unknown[], insertError: null as unknown, inserts: 0, updates: 0,
  selects: 0, events: 0, loseUpdate: false, payload: {} as Record<string, unknown>,
  filters: [] as unknown[][],
}))
function chain(table: string) {
  let updating = false
  const builder: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'is', 'ilike', 'or', 'in', 'limit', 'order', 'neq', 'not']) {
    builder[name] = (...args: unknown[]) => { if (table === 'ediel_inbound_cases') state.filters.push([name, ...args]); return builder }
  }
  builder.update = (payload: Record<string, unknown>) => { updating = true; state.updates++; state.payload = payload; return builder }
  builder.maybeSingle = async () => {
    if (table !== 'ediel_inbound_cases') return { data: null, error: null }
    if (updating) return { data: state.loseUpdate ? null : { ...winner(), ...state.payload }, error: null }
    state.selects++
    const next = state.reads.shift()
    if (next && typeof next === 'object' && 'samePayload' in next) {
      return { data: { ...winner(), ...state.payload, ...(next as { overrides?: object }).overrides }, error: null }
    }
    if (next && typeof next === 'object' && 'readError' in next) return { data: null, error: (next as { readError: unknown }).readError }
    return { data: next ?? null, error: null }
  }
  builder.insert = () => { state.inserts++; return { select: () => ({ single: async () => ({ data: null, error: state.insertError }) }) } }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
  return builder
}
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => chain(table), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async () => { state.events++ }, getEdielMessageById: vi.fn(), linkEdielMessage: vi.fn() }))

import { createOrUpdateInboundProdatCase } from '@/lib/ediel/inboundCases'
import { ownerSource } from './helpers/sourceOwnerFixtures'

const sourceId = '11111111-1111-4111-8111-111111111111'
const companyId = '22222222-2222-4222-8222-222222222222'
const winner = (extra: Record<string, unknown> = {}) => ({ id: 'winner-case', company_id: companyId, ediel_message_id: sourceId, status: 'pending_review', updated_at: '2026-10-09T20:00:00Z', ...extra })
const message = (company: string | null = companyId) => ({ ...ownerSource(), id: sourceId, company_id: company, direction: 'inbound' }) as never
const conflict = { code: '23505', message: 'duplicate key value violates unique constraint "ux_ediel_inbound_cases_message"' }
const invoke = (company: string | null = companyId) => createOrUpdateInboundProdatCase({ actorUserId: 'actor', message: message(company) })

beforeEach(() => Object.assign(state, { reads: [null, winner()], insertError: conflict, inserts: 0, updates: 0, selects: 0, events: 0, loseUpdate: false, payload: {}, filters: [] }))

describe('createOrUpdateInboundProdatCase concurrent insert', () => {
  it('uses the existing pending-case CAS after the exact unique conflict', async () => {
    await expect(invoke()).resolves.toMatchObject({ id: 'winner-case', updated_by: 'actor', status: 'pending_review' })
    expect(state.inserts).toBe(1)
    expect(state.updates).toBe(1)
    expect(state.events).toBe(0)
    expect(state.filters).toContainEqual(['eq', 'company_id', companyId])
    expect(state.filters).toContainEqual(['eq', 'updated_at', '2026-10-09T20:00:00Z'])
    expect(state.filters).toContainEqual(['eq', 'status', 'pending_review'])
  })
  it('refuses a winning case from another tenant', async () => {
    state.reads = [null, winner({ company_id: '33333333-3333-4333-8333-333333333333' })]
    await expect(invoke()).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
    expect(state.updates).toBe(0)
  })
  it('still throws other insert errors', async () => {
    state.insertError = { code: '23503', message: 'fk' }
    await expect(invoke()).rejects.toBe(state.insertError)
    expect(state.selects).toBe(1)
  })
  it('does not consume an unrelated unique violation', async () => {
    state.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "another_index"' }
    await expect(invoke()).rejects.toBe(state.insertError)
    expect(state.selects).toBe(1)
  })
  it('keeps the original conflict if the winner disappeared', async () => {
    state.reads = [null, null]
    await expect(invoke()).rejects.toBe(conflict)
  })
  it('refuses a different source returned by a broken read port', async () => {
    state.reads = [null, winner({ ediel_message_id: 'other-source' })]
    await expect(invoke()).rejects.toBe(conflict)
    expect(state.updates).toBe(0)
  })
  it.each(['applied', 'approved', 'rejected'])('preserves the entire finalized %s winner', async (status) => {
    const saved = winner({ status, review_decision: { retained: 'history' } })
    state.reads = [null, saved]
    await expect(invoke()).resolves.toBe(saved)
    expect(state.updates).toBe(0)
    expect(state.events).toBe(0)
  })
  it('preserves a winner with an object-application review decision', async () => {
    const saved = winner({ review_decision: { objectApplication: { immutable: true } } })
    state.reads = [null, saved]
    await expect(invoke()).resolves.toBe(saved)
    expect(state.updates).toBe(0)
  })
  it('keeps an unresolved tenant explicitly NULL in the CAS', async () => {
    state.reads = [null, winner({ company_id: null })]
    await expect(invoke(null)).resolves.toMatchObject({ company_id: null })
    expect(state.filters).toContainEqual(['is', 'company_id', null])
  })
  it('accepts a lost CAS only when the full intended payload is persisted', async () => {
    state.loseUpdate = true
    state.reads = [null, winner(), { samePayload: true }]
    await expect(invoke()).resolves.toMatchObject({ updated_by: 'actor', ediel_message_id: sourceId })
    expect(state.updates).toBe(1)
    expect(state.events).toBe(0)
    expect(state.filters).toContainEqual(['eq', 'id', 'winner-case'])
  })
  it.each([{ status: 'failed' }, { parsed_customer: { changed: 'manual data' } }, { updated_by: 'another-actor' }])('refuses a changed payload after a lost CAS (%j)', async (overrides) => {
    state.loseUpdate = true
    state.reads = [null, winner(), { samePayload: true, overrides }]
    await expect(invoke()).rejects.toThrow('PRODAT_INBOUND_CASE_CHANGED')
    expect(state.updates).toBe(1)
  })
  it('preserves a newly finalized winner after a lost CAS', async () => {
    state.loseUpdate = true
    state.reads = [null, winner(), { samePayload: true, overrides: { status: 'approved', review_decision: { retained: true } } }]
    await expect(invoke()).resolves.toMatchObject({ status: 'approved', review_decision: { retained: true } })
    expect(state.updates).toBe(1)
  })
  it.each([{ company_id: 'another-tenant' }, { ediel_message_id: 'another-source' }, { id: 'another-case' }])('refuses changed identity even if finalized (%j)', async (overrides) => {
    state.loseUpdate = true
    state.reads = [null, winner(), { samePayload: true, overrides: { ...overrides, status: 'approved' } }]
    await expect(invoke()).rejects.toThrow('PRODAT_INBOUND_CASE_CHANGED')
  })
  it('keeps a reread database error after a lost CAS', async () => {
    const error = { code: '42501' }
    state.loseUpdate = true
    state.reads = [null, winner(), { readError: error }]
    await expect(invoke()).rejects.toBe(error)
  })
  it('retains the normal existing-case update path', async () => {
    state.reads = [winner()]
    await expect(invoke()).resolves.toMatchObject({ updated_by: 'actor' })
    expect(state.inserts).toBe(0)
    expect(state.updates).toBe(1)
  })
})
