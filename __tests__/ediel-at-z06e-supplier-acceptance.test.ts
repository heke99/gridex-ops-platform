// Bounded AT-Z06E-SUPPLIER consumer proof. Native input/mutation/ACK proof is
// still required; this file deliberately carries no whole-contract approval tag.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))

import { applyInboundCustomerLifeEvent } from '@/lib/ediel/flows/inboundCustomerLifeEvent'
import { isSourceCustomerLifeEventCommit, type SourceCustomerLifeEventCommit } from '@/lib/ediel/flows/sourceCustomerLifeEventCommit'
import { source } from './fixtures/prodat-identity'
import { bilateralCustomerNativeWire } from '../scripts/helpers/ediel-bilateral-customer-native-wire'

const companyId = '00000000-0000-4000-8000-000000000021'
const actorUserId = '00000000-0000-4000-8000-000000000022'
function original() {
  return {
    ...source(bilateralCustomerNativeWire({ sender: '12345', receiver: '54321', point: '735123456789012345', customerIdentity: '199001011234', reference: 'SYNTHETIC-OWN' }), 'Z06'),
    company_id: companyId,
    parsed_payload: { customer: { name: 'UNTRUSTED mutable hint' } },
  }
}

beforeEach(() => io.rpc.mockReset())

describe('real Z06E native-effect consumer with an explicit finite RPC port', () => {
  it('publishes an original-bound capability only during the successful observer call', async () => {
    const message = original(), before = structuredClone(message)
    const receipt = { applied: true, sourceMessageId: message.id, scopes: [{ objectId: 'SYNTHETIC-OWN' }] }
    io.rpc.mockResolvedValue({ data: receipt, error: null })
    let retained: SourceCustomerLifeEventCommit | undefined
    const observer = vi.fn(async (commit: SourceCustomerLifeEventCommit) => {
      retained = commit
      expect(isSourceCustomerLifeEventCommit(commit)).toBe(true)
      expect(isSourceCustomerLifeEventCommit({ ...commit })).toBe(false)
      expect(isSourceCustomerLifeEventCommit(structuredClone(commit))).toBe(false)
      expect(commit.actorUserId).toBe(actorUserId)
      expect(commit.message).toEqual(before)
      expect(Object.isFrozen(commit)).toBe(true)
      commit.message.parsed_payload.customer = { name: 'OBSERVER mutation' }
    })
    expect(await applyInboundCustomerLifeEvent({ message, actorUserId, onCustomerLifeEventCommitted: observer })).toEqual(receipt)
    expect(io.rpc.mock.calls).toEqual([['ediel_apply_customer_life_event_source_v1', {
      p_company_id: companyId, p_source_message_id: message.id, p_actor_user_id: actorUserId,
    }]])
    expect(observer).toHaveBeenCalledTimes(1)
    expect(message).toEqual(before)
    expect(isSourceCustomerLifeEventCommit(retained)).toBe(false)
  })

  it.each([
    { applied: true, sourceMessageId: 'foreign-original', scopes: [{}] },
    { applied: true, sourceMessageId: original().id, scopes: [] },
    { applied: true, sourceMessageId: original().id, scopes: null },
  ])('withholds the source handoff for a mismatched or absent whole-source result: %j', async receipt => {
    const observer = vi.fn()
    io.rpc.mockResolvedValue({ data: receipt, error: null })
    await expect(applyInboundCustomerLifeEvent({ message: original(), actorUserId, onCustomerLifeEventCommitted: observer })).rejects.toThrow('customer_life_event_native_scope_invalid')
    expect(observer).not.toHaveBeenCalled()
  })

  it('a held native effect cannot create a positive source handoff', async () => {
    const observer = vi.fn(), receipt = { applied: false, reason: 'reviewed_bilateral_ground_missing' }
    io.rpc.mockResolvedValue({ data: receipt, error: null })
    expect(await applyInboundCustomerLifeEvent({ message: original(), actorUserId, onCustomerLifeEventCommitted: observer })).toEqual(receipt)
    expect(observer).not.toHaveBeenCalled()
  })

  it('missing tenant or native failure cannot reach the observer', async () => {
    const observer = vi.fn()
    await expect(applyInboundCustomerLifeEvent({ message: { ...original(), company_id: null }, actorUserId, onCustomerLifeEventCommitted: observer })).rejects.toThrow('company_required')
    expect(io.rpc).not.toHaveBeenCalled()
    io.rpc.mockResolvedValue({ data: null, error: Error('native effect unavailable') })
    await expect(applyInboundCustomerLifeEvent({ message: original(), actorUserId, onCustomerLifeEventCommitted: observer })).rejects.toThrow('native effect unavailable')
    expect(observer).not.toHaveBeenCalled()
  })
})
