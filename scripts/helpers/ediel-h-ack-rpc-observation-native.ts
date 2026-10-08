// Stored-boundary observation only: never invokes transport or projection again.
// Failure-only observation of the existing SDK await; never await the builder twice.
const ackRpcErrorGuards = [
  'ediel_accepted_projection_actor_forbidden',
  'ediel_accepted_projection_ambiguous',
  'ediel_accepted_projection_expected_recipient_required',
  'ediel_accepted_projection_frozen_plan_invalid',
  'ediel_accepted_projection_original_changed',
  'ediel_accepted_projection_receipt_invalid',
  'ediel_accepted_projection_scope_required',
  'ediel_accepted_projection_source_changed',
  'ediel_source_projection_accepted_binding_required',
  'ediel_source_projection_accepted_lane_required',
  'ediel_source_projection_accepted_receipt_required',
  'ediel_source_projection_actor_forbidden',
  'ediel_source_projection_expectation_clock_changed',
  'ediel_source_projection_frozen_clock_required',
  'ediel_source_projection_frozen_expectation_required',
  'ediel_source_projection_frozen_technical_plan_required',
  'ediel_source_projection_frozen_z02_deadline_required',
  'ediel_source_projection_info_request_not_unique',
  'ediel_source_projection_original_changed',
  'ediel_source_projection_owned_data_request_required',
  'ediel_source_projection_owned_info_request_required',
  'ediel_source_projection_owned_outbound_request_required',
  'ediel_source_projection_scope_required',
  'ediel_source_projection_technical_plan_invalid',
  'ediel_transport_copy_forbidden',
  'ediel_transport_copy_message_unavailable',
  'ediel_transport_copy_scope_required',
  'ediel_transport_original_basis_binding_required',
  'ediel_transport_original_changed',
  'ediel_transport_replay_scope_invalid',
  'ediel_transport_retry_authorization_denied',
  'ediel_transport_retry_binding_invalid',
  'ediel_transport_retry_cursor_contract_failed',
  'ediel_transport_retry_observed_original_required',
  'ediel_transport_retry_private_outbox_required',
  'ediel_transport_worker_fence_lost',
] as const
let ackRpcObservationActive = false
type AckRpcScope = { companyId: string; environment: string; messageId: string; actorUserId: string }
type AckRpcError = { rpc: string; phase: string | null; code: string | null; guard: string | null; unknown: boolean }
function safeAckRpcError(error: unknown, rpc: string, phase: string | null): AckRpcError {
  const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = typeof value.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(value.code) ? value.code : null
  const message = typeof value.message === 'string' ? value.message : ''
  const guard = ackRpcErrorGuards.find(candidate => message === candidate || message.startsWith(candidate + ':')) ?? null
  return { rpc, phase, code, guard, unknown: guard === null }
}
export async function observeAckTransportRpcErrors<T>(client: object, scope: AckRpcScope, action: () => Promise<T>) {
  if (ackRpcObservationActive) throw new Error('native_ack_rpc_observation_overlap')
  const rpcDescriptor = Object.getOwnPropertyDescriptor(client, 'rpc')
  const originalRpc = Reflect.get(client, 'rpc') as (...args: unknown[]) => unknown
  const builders = new Map<object, PropertyDescriptor | undefined>()
  const observation = { selectedCalls: 0, errorCount: 0, errors: [] as AckRpcError[], observerFailed: false }
  const record = (error: unknown, rpc: string, phase: string | null) => {
    if (!error) return
    observation.errorCount++
    try { if (observation.errors.length < 16) observation.errors.push(safeAckRpcError(error, rpc, phase)) }
    catch { observation.observerFailed = true }
  }
  let actionFailed = false
  ackRpcObservationActive = true
  try {
    Object.defineProperty(client, 'rpc', { configurable: true, writable: true, value: function (this: unknown, ...args: unknown[]) {
      const builder = Reflect.apply(originalRpc, this, args)
      const name = args[0], input = args[1] && typeof args[1] === 'object' ? args[1] as Record<string, unknown> : {}
      const transport = name === 'gridex_ediel_transport_attempt_v1'
      const target = transport || name === 'gridex_ediel_accepted_transport_projection_v1'
        || name === 'gridex_ediel_repair_accepted_transport_projection_v1' || name === 'ediel_project_accepted_source_state_v1'
      const identity = transport && input.p_input && typeof input.p_input === 'object' ? input.p_input as Record<string, unknown> : input
      const phase = transport && ['prepare', 'enter', 'observe', 'release'].includes(String(identity.action)) ? String(identity.action) : null
      const matches = target && (!transport || phase !== null)
        && identity[transport ? 'companyId' : 'p_company_id'] === scope.companyId
        && identity[transport ? 'environment' : 'p_environment'] === scope.environment
        && identity[transport ? 'messageId' : 'p_message_id'] === scope.messageId
        && identity[transport ? 'actorUserId' : 'p_actor_user_id'] === scope.actorUserId
      if (matches && builder && typeof builder === 'object' && !builders.has(builder)) {
        const originalThen = Reflect.get(builder, 'then') as (...args: unknown[]) => PromiseLike<unknown>
        const descriptor = Object.getOwnPropertyDescriptor(builder, 'then')
        builders.set(builder, descriptor)
        Object.defineProperty(builder, 'then', { configurable: true, writable: true, value:
          function (fulfilled?: (value: unknown) => unknown, rejected?: (reason: unknown) => unknown) {
            observation.selectedCalls++
            return Reflect.apply(originalThen, builder, [
              (response: unknown) => {
                try { if (response && typeof response === 'object') record(Reflect.get(response, 'error'), String(name), phase) }
                catch { observation.observerFailed = true }
                return fulfilled ? fulfilled(response) : response
              },
              (reason: unknown) => { record(reason, String(name), phase); if (rejected) return rejected(reason); throw reason },
            ])
          } })
      }
      return builder
    } })
    const result = await action()
    return { result, rpcObservation: observation }
  } catch (error) {
    actionFailed = true
    try { console.error('native_ack_rpc_send_threw', JSON.stringify(observation)) } catch { /* Keep the original action error. */ }
    throw error
  } finally {
    let cleanupFailures = 0
    for (const [builder, descriptor] of builders) {
      try {
        if (descriptor) Object.defineProperty(builder, 'then', descriptor)
        else if (!Reflect.deleteProperty(builder, 'then')) throw new Error('native_ack_rpc_cleanup_failed')
      } catch { cleanupFailures++ }
    }
    try {
      if (rpcDescriptor) Object.defineProperty(client, 'rpc', rpcDescriptor)
      else if (!Reflect.deleteProperty(client, 'rpc')) throw new Error('native_ack_rpc_cleanup_failed')
    } catch { cleanupFailures++ }
    finally { ackRpcObservationActive = false }
    if (cleanupFailures) {
      try { console.error('native_ack_rpc_cleanup_failed', JSON.stringify({ cleanupFailures })) } catch { /* Keep primary error identity. */ }
      if (!actionFailed) throw new Error('native_ack_rpc_cleanup_failed')
    }
  }
}

