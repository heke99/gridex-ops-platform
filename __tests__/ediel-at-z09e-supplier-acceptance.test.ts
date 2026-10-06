// Bounded AT-Z09E-SUPPLIER refusal proof through the real source/preparer chain.
// The finite RPC port does not establish native original, ACK or version effects.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))

import { prepareAndQueueRequestedCustomerChange } from '@/lib/ediel/flows/prodatRequestedCustomerChange'

const companyId = '00000000-0000-4000-8000-000000000001'
const actorUserId = '00000000-0000-4000-8000-000000000002'
const artifactId = '00000000-0000-4000-8000-000000000003'
const eventId = '00000000-0000-4000-8000-000000000004'
const scope = { companyId, actorUserId, artifactId }

beforeEach(() => {
  io.rpc.mockReset()
  io.from.mockReset().mockImplementation(() => { throw Error('unexpected query after source refusal') })
})

describe('actual requested source wrapper and life-event preparer, without a substituted queue', () => {
  it.each(['issuer_revoked', 'reviewer_revoked', 'source_expired'])('fresh life-event %s holds an otherwise bound requested artifact before route, intent or queue', async reason => {
    const held = { status: 'held', missing: [reason] }
    io.rpc.mockResolvedValueOnce({ data: { status: 'authorized', artifactId, eventId }, error: null })
      .mockResolvedValueOnce({ data: held, error: null })
    expect(await prepareAndQueueRequestedCustomerChange({ ...scope, preferredRouteId: 'untrusted-route-hint' })).toEqual(held)
    expect(io.rpc.mock.calls).toEqual([
      ['ediel_requested_customer_change_queue_basis_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_artifact_id: artifactId }],
      ['ediel_customer_life_event_source_v1', { p_company_id: companyId, p_event_id: eventId, p_actor_user_id: actorUserId }],
    ])
    expect(io.from).not.toHaveBeenCalled()
  })

  it('a failed fresh event read cannot borrow the earlier artifact authorization', async () => {
    io.rpc.mockResolvedValueOnce({ data: { status: 'authorized', artifactId, eventId }, error: null })
      .mockResolvedValueOnce({ data: null, error: Error('fresh event source unavailable') })
    await expect(prepareAndQueueRequestedCustomerChange(scope)).rejects.toThrow('fresh event source unavailable')
    expect(io.rpc).toHaveBeenCalledTimes(2)
    expect(io.from).not.toHaveBeenCalled()
  })

  it('a held artifact prevents even the event read', async () => {
    const held = { status: 'held', artifactId, missing: ['authentic_current_outgoing_customer_mandate'] }
    io.rpc.mockResolvedValue({ data: held, error: null })
    expect(await prepareAndQueueRequestedCustomerChange(scope)).toEqual(held)
    expect(io.rpc).toHaveBeenCalledTimes(1)
    expect(io.from).not.toHaveBeenCalled()
  })

  it('an incoming-source selector cannot substitute for the owned outgoing artifact', async () => {
    io.rpc.mockResolvedValue({ data: { status: 'authorized', artifactId: eventId, sourceMessageId: eventId }, error: null })
    await expect(prepareAndQueueRequestedCustomerChange(scope)).rejects.toThrow('requested_customer_change_scope_invalid')
    expect(io.rpc).toHaveBeenCalledTimes(1)
    expect(io.from).not.toHaveBeenCalled()
  })
})
