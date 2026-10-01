import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareAndQueueProdatRecovery } from '@/lib/ediel/recovery/prodatRecovery'
import { source, head, own } from './fixtures/prodat-identity'
import { raw } from './fixtures/prodat-register'
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), route: vi.fn(), finalize: vi.fn(), request: vi.fn(), queue: vi.fn(), intent: vi.fn(), basis: vi.fn(), dates: vi.fn(), reporting: vi.fn(),serviceOrigin:vi.fn(),references:vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/ediel/core/kernel', () => ({ resolveCanonicalOutboundContext: io.route, finalizeCanonicalOutboundDraft: io.finalize }))
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: io.request }))
vi.mock('@/lib/ediel/flows/shared', () => ({ queuePreparedEdielMessage: io.queue }))
vi.mock('@/lib/ediel/intent/prodatRecoveryGateway', () => ({ finalizeRecoveryDraft: io.finalize,queueRecoveryDraft: io.queue }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: io.intent }))
vi.mock('@/lib/ediel/recovery/sourceContext', () => ({ readRecoveryOperationBasis: io.basis }))
vi.mock('@/lib/ediel/production/dateEventContext', () => ({ loadProdatDateEventValidationContext: io.dates,recoveryDateEventScope: (value: unknown) => value }))
vi.mock('@/lib/ediel/recovery/reportingContext', () => ({ loadRecoveryReportingContext: io.reporting }))
vi.mock('@/lib/ediel/services/permissionOrigin', () => ({ loadServicePermissionRecoveryOrigin: io.serviceOrigin }))
vi.mock('@/lib/ediel/recovery/correctionReferences', () => ({ prepareProdatCorrectionReferences: io.references }))
const scope = { companyId: 'tenant-a', actorUserId: 'actual-actor', originalMessageId: 'original', operationId: 'operation' }
const wire = raw([...head(), ...own('1', '735123456789012345', 'OWN')], 'Z01').replace("23-DDQ-PRODAT'", "23-DDQ-PRODAT++++1'")
const original = { ...source(wire), id: 'original', direction: 'outbound' as const, company_id: 'tenant-a', customer_id: 'customer', status: 'sent' as const }
const corrected = { ...original, id: 'new-message', status: 'draft' as const, original_message_id: 'original', source_operation_id: 'operation', outbound_request_id: 'new-request',intent_id: 'new-intent' }
const command = { ...scope, sourceAckMessageId: 'actual-negative-ack', correctedRawPayload: wire }
function messages() {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }
  query.select.mockReturnValue(query);query.eq.mockImplementation((key: string, value: string) => { if (key === 'id') query.maybeSingle.mockResolvedValue({ data: value === 'original' ? original : corrected, error: null });return query });io.from.mockReturnValue(query)
}
function authorized(extra: Record<string, unknown> = {}) { return { data: { status: 'authorized', operationId: 'operation', originalMessageId: 'original', kind: 'aperak_correction', previousAttemptId: null, newMessageId: 'new-message', ...extra }, error: null } }
beforeEach(() => {
  vi.resetAllMocks(); messages();io.rpc.mockResolvedValue(authorized());io.queue.mockResolvedValue(undefined);io.references.mockImplementation(async input=>input.correctedRawPayload)
  io.route.mockResolvedValue({ route: { id: 'current-route' },actor: { marketRoles: ['electricity_supplier'] },routeRuntime: { route_profile_id: 'current-profile' }, environment: 'test', companyId: 'tenant-a' });io.request.mockResolvedValue({ id: 'new-request' });io.finalize.mockResolvedValue(corrected)
  io.intent.mockResolvedValue({ id: 'new-intent' });io.basis.mockResolvedValue({ originalMessageId: 'original',operationId: 'operation',allowedObjects: [] });io.dates.mockResolvedValue(undefined);io.reporting.mockResolvedValue({ originalMessage: original,context: undefined });io.serviceOrigin.mockResolvedValue(undefined)
})
describe('source qualified manual PRODAT recovery', () => {
  it('a missing/unknown loss proof stays held and cannot create an outbox or rerender', async () => {
    io.rpc.mockResolvedValue({ data: { status: 'held', reason: 'verified_transfer_loss_required' }, error: null })
    expect(await prepareAndQueueProdatRecovery({ ...scope, previousAttemptId: 'unknown-attempt' })).toEqual({ status: 'held', reason: 'verified_transfer_loss_required' })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_prepare_prodat_recovery_v1', { p_company_id: 'tenant-a', p_original_message_id: 'original', p_actor_user_id: 'actual-actor', p_operation_id: 'operation', p_source_ack_message_id: null, p_previous_attempt_id: 'unknown-attempt', p_corrected_raw_payload: null })
    expect(io.from).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
  })
  it('queues a distinct authorization-owned retry without resetting the original or its outcomes', async () => {
    io.rpc.mockResolvedValueOnce(authorized({ kind: 'verified_transfer_loss', previousAttemptId: 'known-negative', newMessageId: null }))
      .mockResolvedValueOnce({ data: { status: 'queued', outboxId: 'new-outbox' }, error: null })
    expect(await prepareAndQueueProdatRecovery({ ...scope, previousAttemptId: 'known-negative' })).toMatchObject({ status: 'queued', messageId: 'original', outboxId: 'new-outbox' })
    expect(io.rpc).toHaveBeenLastCalledWith('ediel_queue_prodat_retry_v1', { p_company_id: 'tenant-a', p_message_id: 'original', p_actor_user_id: 'actual-actor', p_operation_id: 'operation' });expect(io.from).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled()
  })
  it('idempotently returns an already queued correction without touching any old message', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { ...corrected, status: 'sent' }, error: null }) };query.select.mockReturnValue(query);query.eq.mockReturnValue(query);io.from.mockReturnValue(query)
    expect(await prepareAndQueueProdatRecovery(command)).toMatchObject({ status: 'existing', messageId: 'new-message' });expect(io.queue).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled()
  })
  it('rechecks source authority before queue and cannot fall back when the immutable ACK no longer qualifies', async () => {
    io.queue.mockRejectedValue({ message: 'prodat_recovery_current_source_required' })
    await expect(prepareAndQueueProdatRecovery(command)).rejects.toEqual({ message: 'prodat_recovery_current_source_required' });expect(io.finalize).not.toHaveBeenCalled()
  })
  it('uses a new operation request and current canonical finalizer, never inherits the old rule snapshot or ACK states', async () => {
    io.rpc.mockResolvedValueOnce(authorized({ newMessageId: null })).mockResolvedValueOnce(authorized()).mockResolvedValueOnce({ data: null, error: null })
    expect(await prepareAndQueueProdatRecovery(command)).toMatchObject({ status: 'queued', messageId: 'new-message' })
    expect(io.request.mock.calls[0][0]).toMatchObject({ sourceType: 'manual', sourceId: 'new-intent', operationId: 'operation', environment: 'test' })
    expect(io.intent.mock.calls[0][0]).toMatchObject({ companyId: 'tenant-a',operationId: 'operation',idempotencyKey: 'prodat-recovery:operation',routeProfileId: 'current-profile' })
    expect(io.finalize.mock.calls[0][0]).toMatchObject({ actorUserId: 'actual-actor',intent: { id: 'new-intent' },params: { outboundRequestId: 'new-request', duplicateCheck: { sourceId: 'new-intent' }, draft: { companyId: 'tenant-a',intentId: 'new-intent', originalMessageId: 'original', sourceOperationId: 'operation', rawPayload: wire, contrlStatus: 'pending', aperakStatus: 'not_required' } } })
    expect(io.finalize.mock.calls[0][0].params.draft.rulePackSnapshot).toBeUndefined();expect(io.finalize.mock.calls[0][0].params.draft.parsedPayload.prodatEngine).toBeUndefined()
  })
  it('cannot queue a generic dedupe result until its exact private recovery binding matches', async () => {
    io.rpc.mockResolvedValueOnce(authorized({ newMessageId: null })).mockResolvedValueOnce(authorized())
    io.finalize.mockResolvedValue({ ...original, id: 'old-other-message' })
    await expect(prepareAndQueueProdatRecovery(command)).rejects.toThrow('final_message_unbound');expect(io.queue).not.toHaveBeenCalled()
  })
  it('checks current actor/tenant and exact retry attempt identity rather than accepting a caller flag', async () => {
    io.rpc.mockResolvedValue(authorized({ kind: 'verified_transfer_loss', previousAttemptId: 'other-negative-attempt' }))
    await expect(prepareAndQueueProdatRecovery({ ...scope, previousAttemptId: 'claimed-attempt' })).rejects.toThrow('attempt_conflict');expect(io.rpc).toHaveBeenCalledTimes(1)
    await expect(prepareAndQueueProdatRecovery({ ...scope, actorUserId: '', previousAttemptId: 'claimed-attempt' })).rejects.toThrow('scope_required')
  })
  it('holds a correction when fresh private protected context cannot qualify before intent/finalizer', async () => {
    io.rpc.mockResolvedValue(authorized({ newMessageId: null }));io.basis.mockResolvedValue(undefined)
    await expect(prepareAndQueueProdatRecovery(command)).rejects.toThrow('current_basis_required')
    expect(io.intent).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
  })
  it('uses the native producer wire before authorization, idempotent binding and queue', async () => {
    const normalized=wire.replace('LI:OWN',`LI:Z01${'A'.repeat(32)}`)
    io.references.mockResolvedValue(normalized)
    const query={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:{...corrected,raw_payload:normalized},error:null})};query.select.mockReturnValue(query);query.eq.mockReturnValue(query);io.from.mockReturnValue(query)
    expect(await prepareAndQueueProdatRecovery(command)).toMatchObject({status:'queued',messageId:'new-message'})
    expect(io.references).toHaveBeenCalledExactlyOnceWith(command)
    expect(io.references.mock.invocationCallOrder[0]).toBeLessThan(io.rpc.mock.invocationCallOrder[0])
    expect(io.rpc.mock.calls[0][1]).toMatchObject({p_corrected_raw_payload:normalized,p_actor_user_id:scope.actorUserId})
    expect(io.queue).toHaveBeenCalledOnce();expect(io.finalize).not.toHaveBeenCalled()
  })
  it('a refused current reference producer cannot authorize or mutate a correction', async () => {
    const error=Error('prodat_recovery_execution_actor_forbidden');io.references.mockRejectedValue(error)
    await expect(prepareAndQueueProdatRecovery(command)).rejects.toBe(error)
    expect(io.rpc).not.toHaveBeenCalled();expect(io.from).not.toHaveBeenCalled();expect(io.intent).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
  })
})
