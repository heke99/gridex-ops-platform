import { supabaseService } from '@/lib/supabase/service'
import { createHash } from 'node:crypto'
import { isEvidenceRecord, isEvidenceUuid } from '@/lib/ediel/utilts/durableSourceDiscovery'

type CorrectionScope = { companyId: string; operationId: string; actorUserId: string; originalMessageId: string; sourceAckMessageId: string; correctedRawPayload: string }
const hash = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex')

/** Native committed physical ACK evidence selects the eligible failed scope.
 * The protected producer owns new LI allocation; this adapter only accepts its
 * exact current actor, operation, original/ACK tuple and returned wire hashes. */
export async function prepareProdatCorrectionReferences(input: CorrectionScope): Promise<string> {
  if (![input.companyId, input.operationId, input.actorUserId, input.originalMessageId, input.sourceAckMessageId].every(isEvidenceUuid)
    || !input.correctedRawPayload || Buffer.byteLength(input.correctedRawPayload, 'utf8') > 262144) throw Error('prodat_recovery_references_scope_required')
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>
  const { data, error } = await rpc('ediel_prepare_prodat_recovery_references_v1', {
    p_company_id: input.companyId, p_operation_id: input.operationId, p_actor_user_id: input.actorUserId,
    p_original_message_id: input.originalMessageId, p_source_ack_message_id: input.sourceAckMessageId, p_corrected_raw_payload: input.correctedRawPayload,
  })
  if (error) throw error
  if (!isEvidenceRecord(data) || data.companyId !== input.companyId || data.operationId !== input.operationId || data.actorUserId !== input.actorUserId
    || data.originalMessageId !== input.originalMessageId || data.ackMessageId !== input.sourceAckMessageId || data.inputPayloadHash !== hash(input.correctedRawPayload)
    || typeof data.correctedRawPayload !== 'string' || !data.correctedRawPayload || Buffer.byteLength(data.correctedRawPayload, 'utf8') > 262144
    || data.correctedPayloadHash !== hash(data.correctedRawPayload) || !Array.isArray(data.allocations)
    || data.allocations.some(a => !isEvidenceRecord(a) || !Number.isInteger(a.sourceFirstLineIndex) || !Number.isInteger(a.inputFirstLineIndex)
      || typeof a.point !== 'string' || !a.point || typeof a.identityAgency !== 'string' || !a.identityAgency || typeof a.reference !== 'string' || !/^[A-Z0-9]{35}$/.test(a.reference))) {
    throw Error('prodat_recovery_references_receipt_invalid')
  }
  if (!data.allocations.length && data.correctedRawPayload !== input.correctedRawPayload) throw Error('prodat_recovery_references_receipt_invalid')
  return data.correctedRawPayload
}
