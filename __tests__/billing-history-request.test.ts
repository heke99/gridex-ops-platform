import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, createDraft, queueZ13, createTask } = vi.hoisted(() => ({
  state: { existing: [] as unknown[] },
  createDraft: vi.fn(async () => ({ id: 'perm-1' })),
  queueZ13: vi.fn(async () => ({})),
  createTask: vi.fn(async () => ({})),
}))

vi.mock('@/lib/supabase/service', () => {
  const chain = (result: () => unknown) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'limit']) builder[method] = () => builder
    builder.maybeSingle = async () => ({ data: { grid_owner_id: 'go-1' }, error: null })
    builder.then = (resolve: (value: unknown) => unknown) => resolve(result())
    return builder
  }
  return { supabaseService: { from: () => chain(() => ({ data: state.existing, error: null })) } }
})
vi.mock('@/lib/onboarding/infoRequests', () => ({ createMeteringPermissionDraft: createDraft, queueMeteringPermissionForZ13: queueZ13 }))
vi.mock('@/lib/customers/dataTasks', () => ({ createCustomerDataTask: createTask }))

import { ensureHistoricalMeteringRequest } from '@/lib/billing/historyRequest'

const base = { companyId: 'c1', customerId: 'cust', siteId: 'site', meteringPointId: 'mp-1234567890' }

beforeEach(() => {
  state.existing = []
  createDraft.mockClear(); queueZ13.mockClear(); createTask.mockClear()
})

describe('ensureHistoricalMeteringRequest', () => {
  it('does nothing when a history request is already open for the meter', async () => {
    state.existing = [{ id: 'p0' }]
    expect(await ensureHistoricalMeteringRequest({ ...base, actorUserId: 'u1' })).toBe('already_requested')
    expect(createDraft).not.toHaveBeenCalled()
  })

  it('creates and queues a Z13 history request with an actor', async () => {
    expect(await ensureHistoricalMeteringRequest({ ...base, actorUserId: 'u1' })).toBe('requested')
    expect(createDraft).toHaveBeenCalledTimes(1)
    expect(queueZ13).toHaveBeenCalledWith({ companyId: 'c1', actorUserId: 'u1', permissionId: 'perm-1' })
  })

  it('leaves a draft and an operator task in system runs', async () => {
    expect(await ensureHistoricalMeteringRequest({ ...base, actorUserId: null })).toBe('draft_for_operator')
    expect(queueZ13).not.toHaveBeenCalled()
    expect(createTask).toHaveBeenCalledTimes(1)
  })
})
