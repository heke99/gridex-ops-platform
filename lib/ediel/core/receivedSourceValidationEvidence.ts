import { isEvidenceRecord, isEvidenceUuid, evidenceHash } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'
import { bindReceivedRegisterValidation } from '@/lib/ediel/core/receivedRegisterValidationBinding'

type SourceFacts = { id: unknown; company_id?: unknown; environment: unknown; direction: unknown; message_family: unknown; message_standard: unknown; raw_payload: unknown; message_code: unknown; message_received_at: unknown; execution_context_snapshot?: unknown }
type RuntimeFacts = { syntaxDecision: unknown; applicationDecision: unknown; functionalDecision: unknown; canonical: { messageReference: unknown }; issues: Array<{ code: unknown }>; validationReport: Record<string, unknown>; prodatRegisterValidation?: unknown }
export type SourceValidationInput = { companyId: string; environment: 'test' | 'production'; sourceMessageId: string; sourcePayloadHash: string; factsText: string }
const CONTEXT_KEYS = ['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
const states = new Set(['accepted','rejected','not_applicable','manual_review'])

/** Call only with the ORIGINAL row and the row just passed to the real
 * resolveCanonicalRuntimeDecisionWithRegistry owner. Never hydrate decision
 * input from status JSON, a cached validation_report or an onboarding receipt.
 * This is canonical-runtime facet evidence, not approval of every LIN object,
 * register chain, party, supersession or temporal comparison baseline. */
export function buildReceivedSourceValidationEvidence(input: { original: SourceFacts; validated: SourceFacts; resolvedCompanyId: unknown; decision: RuntimeFacts }): SourceValidationInput | null {
  const { original, validated, decision } = input
  if (original.direction !== 'inbound' || original.message_standard !== 'edifact' || original.message_family !== 'PRODAT'
    || !isEvidenceUuid(original.id) || !isEvidenceUuid(original.company_id)
    || (original.environment !== 'test' && original.environment !== 'production') || typeof original.raw_payload !== 'string'
    || original.raw_payload.length > 262144 || Buffer.byteLength(original.raw_payload,'utf8') > 262144
    || !isEvidenceRecord(original.execution_context_snapshot)) return null
  const context = original.execution_context_snapshot.receivedProdatContext
  if (!isEvidenceRecord(context) || Object.keys(context).length !== CONTEXT_KEYS.length || !CONTEXT_KEYS.every(key => Object.hasOwn(context,key))
    || context.version !== 1 || context.contextOrigin !== 'database_insert' || context.sourceMessageId !== original.id
    || context.companyId !== original.company_id || context.environment !== original.environment || context.messageCode !== original.message_code
    || input.resolvedCompanyId !== context.companyId || validated.company_id !== context.companyId || validated.environment !== context.environment
    || validated.id !== original.id || validated.raw_payload !== original.raw_payload) return null
  const sourcePayloadHash = evidenceHash(original.raw_payload)
  const received = parseSourceReceiptInstant(original.message_received_at)
  if (context.payloadHash !== sourcePayloadHash || received === null || parseSourceReceiptInstant(context.sourceReceivedAt) !== received
    || parseSourceReceiptInstant(context.capturedAt) === null) return null
  if (![decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision].every(value => typeof value === 'string' && states.has(value))) return null
  const messageReference = decision.canonical.messageReference
  if (!(messageReference === null || (typeof messageReference === 'string' && /^[^\x00-\x1f\x7f]{1,128}$/.test(messageReference)))) return null
  const reasonCodes = [...new Set(decision.issues.map(issue => issue.code))]
  if (reasonCodes.length > 128 || !reasonCodes.every(code => typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(code))) return null
  const evidence = decision.validationReport.rulePackEvidence
  let rulePackEvidence: { profileKey: string; messageProfileId: string; rulePackId: string; sourceHash: string } | null = null
  if (evidence != null) {
    if (!isEvidenceRecord(evidence) || typeof evidence.profileKey !== 'string' || evidence.profileKey.length > 128
      || !isEvidenceUuid(evidence.messageProfileId) || !isEvidenceUuid(evidence.rulePackId)
      || typeof evidence.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sourceHash)) return null
    rulePackEvidence = { profileKey: evidence.profileKey, messageProfileId: evidence.messageProfileId, rulePackId: evidence.rulePackId, sourceHash: evidence.sourceHash }
  }
  // Registry-unavailable acceptance is never silently downgraded to evidence
  // with an unknown rule version. Rejection can legitimately precede registry.
  if (decision.applicationDecision === 'accepted' && rulePackEvidence === null) return null
  const hasRegisterValidation = decision.prodatRegisterValidation !== undefined
  const registerValidation = hasRegisterValidation ? bindReceivedRegisterValidation(decision.prodatRegisterValidation, original.raw_payload) : null
  if (hasRegisterValidation && (!registerValidation || !rulePackEvidence)) return null
  return { companyId: original.company_id, environment: original.environment, sourceMessageId: original.id, sourcePayloadHash,
    factsText: JSON.stringify({ version: 1, owner: 'canonical-runtime-with-registry-v1', sourceDisposition: 'not_established',
      objectDisposition: 'not_checked', partyDisposition: 'not_checked', coverage: 'canonical_runtime_only', originalTenantMatch: 'matched',
      syntaxDecision: decision.syntaxDecision, applicationDecision: decision.applicationDecision, functionalDecision: decision.functionalDecision,
      messageReference, reasonCodes, rulePackEvidence, ...(hasRegisterValidation ? { registerValidation } : {}) }) }
}
