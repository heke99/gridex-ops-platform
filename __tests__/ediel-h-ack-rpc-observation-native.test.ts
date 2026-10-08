import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeAckTransportRpcErrors } from '../scripts/helpers/ediel-h-ack-rpc-observation-native'

const scope = { companyId: 'own-company', environment: 'test', messageId: 'own-source', actorUserId: 'own-actor' }
const projection = 'gridex_ediel_repair_accepted_transport_projection_v1'
const input = { p_company_id: scope.companyId, p_environment: scope.environment,
  p_message_id: scope.messageId, p_actor_user_id: scope.actorUserId }
afterEach(() => vi.restoreAllMocks())
function rpcReturning<T>(builder: T) {
  return vi.fn<(name: string, params: unknown) => T>(() => builder)
}
function lazyReply<T>(response: T) {
  return { then: vi.fn((fulfilled: (value: T) => unknown, rejected?: (reason: unknown) => unknown) =>
    Promise.resolve(response).then(fulfilled, rejected)) }
}

describe('H native ACK observation preserves the original RPC action', () => {
  it('delegates the lazy builder once, keeps response identity and restores own descriptors', async () => {
    const error = { code: 'P0001', message: 'ediel_source_projection_owned_outbound_request_required' }
    const response = { data: null, error }
    const then = vi.fn((fulfilled: (value: typeof response) => unknown) => Promise.resolve(fulfilled(response)))
    const builder = { then }
    const rpc = vi.fn<(name: string, params: unknown) => typeof builder>(function (this: unknown) { expect(this).toBe(client); return builder })
    const client = { rpc }
    const rpcBefore = Object.getOwnPropertyDescriptor(client, 'rpc')
    const thenBefore = Object.getOwnPropertyDescriptor(builder, 'then')
    const observed = await observeAckTransportRpcErrors(client, scope, async () => {
      const returned = client.rpc(projection, input)
      expect(returned).toBe(builder)
      expect(then).not.toHaveBeenCalled()
      return await returned
    })
    expect(observed.result).toBe(response)
    expect(observed.rpcObservation).toEqual({ selectedCalls: 1, errorCount: 1, observerFailed: false,
      errors: [{ rpc: projection, phase: null, code: 'P0001',
        guard: 'ediel_source_projection_owned_outbound_request_required', unknown: false }] })
    expect(rpc).toHaveBeenCalledExactlyOnceWith(projection, input)
    expect(then).toHaveBeenCalledTimes(1)
    expect(Object.getOwnPropertyDescriptor(client, 'rpc')).toEqual(rpcBefore)
    expect(Object.getOwnPropertyDescriptor(builder, 'then')).toEqual(thenBefore)
  })

  it.each(Object.keys(input))('leaves a different %s outside the observed scope', async key => {
    const response = { data: null, error: { code: 'P0001', message: 'private detail must not be recorded' } }
    const builder = Promise.resolve(response)
    const client = { rpc: rpcReturning(builder) }
    const before = Object.getOwnPropertyDescriptor(builder, 'then')
    const observed = await observeAckTransportRpcErrors(client, scope,
      async () => await client.rpc(projection, { ...input, [key]: 'different' }))
    expect(observed.result).toBe(response)
    expect(observed.rpcObservation).toEqual({ selectedCalls: 0, errorCount: 0, errors: [], observerFailed: false })
    expect(Object.getOwnPropertyDescriptor(builder, 'then')).toEqual(before)
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('observes a scoped transport phase and sanitizes unknown errors without changing them', async () => {
    const error = { code: 'PGRST116', message: 'unrecognized private diagnostic' }
    const response = { data: null, error }
    const client = { rpc: rpcReturning(lazyReply(response)) }
    const transportInput = { p_input: { ...scope, action: 'observe' } }
    const observed = await observeAckTransportRpcErrors(client, scope,
      async () => await client.rpc('gridex_ediel_transport_attempt_v1', transportInput))
    expect(observed.result).toBe(response)
    expect(observed.result.error).toBe(error)
    expect(observed.rpcObservation).toEqual({ selectedCalls: 1, errorCount: 1, observerFailed: false,
      errors: [{ rpc: 'gridex_ediel_transport_attempt_v1', phase: 'observe', code: 'PGRST116', guard: null, unknown: true }] })
    expect(JSON.stringify(observed.rpcObservation)).not.toContain(error.message)
  })

  it.each(['invalid_phase', 'unrelated_rpc'])('does not observe %s', async kind => {
    const response = { error: { code: 'P0001', message: 'ediel_transport_worker_fence_lost' } }
    const client = { rpc: rpcReturning(lazyReply(response)) }
    const name = kind === 'invalid_phase' ? 'gridex_ediel_transport_attempt_v1' : 'unrelated_rpc'
    const params = kind === 'invalid_phase' ? { p_input: { ...scope, action: 'invalid' } } : input
    const observed = await observeAckTransportRpcErrors(client, scope, async () => await client.rpc(name, params))
    expect(observed.result).toBe(response)
    expect(observed.rpcObservation.selectedCalls).toBe(0)
    expect(observed.rpcObservation.errors).toEqual([])
  })

  it('keeps rejection identity, delegates once and removes inherited-method wrappers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = { code: 'P0001', message: 'ediel_transport_worker_fence_lost' }
    const then = vi.fn((_fulfilled: unknown, rejected: (reason: unknown) => unknown) =>
      Promise.resolve().then(() => rejected(error)))
    const builder = Object.create({ then })
    const rpc = rpcReturning(builder)
    const client = Object.create({ rpc })
    await expect(observeAckTransportRpcErrors(client, scope,
      async () => await client.rpc(projection, input))).rejects.toBe(error)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(then).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(client, 'rpc')).toBe(false)
    expect(Object.hasOwn(builder, 'then')).toBe(false)
    expect(client.rpc).toBe(rpc)
    expect(builder.then).toBe(then)
  })

  it('keeps a synchronous original action error and resets observation ownership', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const error = new Error('original action failure')
    const rpc = vi.fn<(name: string, params: unknown) => never>(() => { throw error })
    const client = { rpc }
    await expect(observeAckTransportRpcErrors(client, scope,
      async () => client.rpc(projection, input))).rejects.toBe(error)
    expect(client.rpc).toBe(rpc)
    expect(rpc).toHaveBeenCalledTimes(1)
    const next = await observeAckTransportRpcErrors(client, scope, async () => 'next original action')
    expect(next.result).toBe('next original action')
  })

  it('refuses overlapping observation and leaves the outer action and descriptors intact', async () => {
    const client = { rpc: vi.fn() }
    const before = Object.getOwnPropertyDescriptor(client, 'rpc')
    const observed = await observeAckTransportRpcErrors(client, scope, async () => {
      await expect(observeAckTransportRpcErrors(client, scope, async () => 'inner'))
        .rejects.toThrow('native_ack_rpc_observation_overlap')
      return 'outer'
    })
    expect(observed.result).toBe('outer')
    expect(Object.getOwnPropertyDescriptor(client, 'rpc')).toEqual(before)
    expect(client.rpc).not.toHaveBeenCalled()
    expect((await observeAckTransportRpcErrors(client, scope, async () => 'next')).result).toBe('next')
  })
})
