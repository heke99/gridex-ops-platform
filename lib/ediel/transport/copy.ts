import { supabaseService } from '@/lib/supabase/service'

export type EdielTransportCopy = {
  attemptId: string; lane: 'generic_journal' | 'sealed_z08'; companyId: string; messageId: string;
  environment: 'test' | 'production'; mimeArchiveRef: string; mimeSha256: string; mimeLength: number;
  rfcMessageId: string; mimePayloadSnapshotId: string; enteredAt: string; observedAt: string | null;
  smtpClassification: string | null; archiveReadbackRequired: true
}
export type EdielTransportReconciliationCase = {
  caseId: string; companyId: string; environment: 'test' | 'production'; messageId: string;
  lane: 'generic_journal' | 'sealed_z08'; attemptId: string; originalHash: string; mimeSha256: string;
  enteredAt: string; openedAt: string; reason: 'provider_outcome_unknown' | 'entry_unresolved_after_lease';
  status: 'needs_tracking' | 'outcome_observed'; observedClassification: string | null; observedAt: string | null;
  authorizesResend: false; deliveryProven: false
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sha256 = /^[a-f0-9]{64}$/
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
const knownClassifications = ['accepted', 'partial', 'all_rejected', 'explicit_negative', 'pre_connect_negative']
function boundedCases(value: unknown, scope: {companyId: string; messageId: string; environment: string}): EdielTransportReconciliationCase[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 50) throw new Error('ediel_transport_reconciliation_invalid')
  const ids = new Set<string>()
  const attempts = new Set<string>()
  return value.map(row => {
    if (!row || typeof row !== 'object' || !uuid.test(row.caseId) || ids.has(row.caseId) || !uuid.test(row.attemptId)
      || row.companyId !== scope.companyId || row.messageId !== scope.messageId || row.environment !== scope.environment
      || !['generic_journal', 'sealed_z08'].includes(row.lane) || !sha256.test(row.originalHash) || !sha256.test(row.mimeSha256)
      || !timestamp(row.enteredAt) || !timestamp(row.openedAt) || Date.parse(row.openedAt) < Date.parse(row.enteredAt)
      || !['provider_outcome_unknown', 'entry_unresolved_after_lease'].includes(row.reason)
      || !['needs_tracking', 'outcome_observed'].includes(row.status)
      || row.observedClassification !== null && ![...knownClassifications, 'unknown', 'uncertain'].includes(row.observedClassification)
      || row.observedAt !== null && !timestamp(row.observedAt)
      || (row.observedAt === null) !== (row.observedClassification === null)
      || row.observedAt !== null && Date.parse(row.observedAt) < Date.parse(row.enteredAt)
      || attempts.has(`${row.lane}:${row.attemptId}`)
      || (row.status === 'outcome_observed') !== knownClassifications.includes(row.observedClassification)
      || row.status === 'outcome_observed' && row.observedAt === null
      || row.authorizesResend !== false || row.deliveryProven !== false) throw new Error('ediel_transport_reconciliation_invalid')
    ids.add(row.caseId)
    attempts.add(`${row.lane}:${row.attemptId}`)
    // Explicit projection prevents a widened RPC object leaking bytes, archive paths or email addresses.
    return {caseId: row.caseId, companyId: row.companyId, environment: row.environment, messageId: row.messageId,
      lane: row.lane, attemptId: row.attemptId, originalHash: row.originalHash, mimeSha256: row.mimeSha256,
      enteredAt: row.enteredAt, openedAt: row.openedAt, reason: row.reason, status: row.status,
      observedClassification: row.observedClassification, observedAt: row.observedAt, authorizesResend: false, deliveryProven: false}
  })
}
export async function readEdielTransportCopies(input: { companyId: string; actorUserId: string; messageId: string }): Promise<{
  status: 'available' | 'held' | 'unavailable'; companyId: string; messageId: string; environment: 'test' | 'production';
  copies: EdielTransportCopy[]; reconciliationCases: EdielTransportReconciliationCase[]; blocker: string | null; authorizesResend: false; deliveryProven: false
}> {
  const { data, error } = await supabaseService.rpc('gridex_ediel_transport_copy_v1', {
    p_company_id: input.companyId, p_actor_user_id: input.actorUserId, p_message_id: input.messageId,
  })
  if (error) throw error
  if (!data || !['available','held','unavailable'].includes(data.status) || !Array.isArray(data.copies) || data.companyId !== input.companyId || data.messageId !== input.messageId || data.authorizesResend !== false || data.deliveryProven !== false) throw new Error('ediel_transport_copy_invalid')
  if (!['test', 'production'].includes(data.environment)) throw new Error('ediel_transport_copy_invalid')
  return {...data, reconciliationCases: boundedCases(data.reconciliationCases, data)}
}
