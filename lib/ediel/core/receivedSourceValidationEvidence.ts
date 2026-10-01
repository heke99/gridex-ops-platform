import {bindReceivedProdatIgnoredFields} from './receivedProdatIgnoredFieldBinding'
import type {ProdatIgnoredField} from '@/lib/ediel/rulebook/fieldMatrix'
import { isEvidenceRecord, isEvidenceUuid, evidenceHash } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'
import { bindReceivedRegisterValidation } from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {bindReceivedUtiltsTransactionValidation,type ReceivedUtiltsTransactionValidation} from '@/lib/ediel/core/receivedUtiltsTransactionValidation'
import {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {bindReceivedUtiltsHeaderValidation,type ReceivedUtiltsHeaderValidation} from './receivedUtiltsHeaderValidation'
import {bindReceivedUtiltsFunctionalValidation,type ReceivedUtiltsFunctionalValidation} from './receivedUtiltsFunctionalValidation'

type SourceFacts = { id: unknown; company_id?: unknown; environment: unknown; direction: unknown; message_family: unknown; message_standard: unknown; raw_payload: unknown; message_code: unknown; message_received_at: unknown; execution_context_snapshot?: unknown }
type RuntimeFacts = { syntaxDecision: unknown; applicationDecision: unknown; functionalDecision: unknown; canonical: { messageReference: unknown }; issues: Array<{ code: unknown }>; validationReport: Record<string, unknown>; prodatRegisterValidation?: unknown;prodatIgnoredFields?:unknown;utiltsTransactionValidation?:unknown;utiltsHeaderValidation?:unknown;utiltsFunctionalValidation?:unknown }
export type SourceValidationInput = { companyId: string; environment: 'test' | 'production'; sourceMessageId: string; sourcePayloadHash: string; factsText: string;prodatIgnoredFields?:ProdatIgnoredField[];utiltsTransactionValidation?:ReceivedUtiltsTransactionValidation;utiltsHeaderValidation?:ReceivedUtiltsHeaderValidation;utiltsFunctionalValidation?:ReceivedUtiltsFunctionalValidation }
const CONTEXT_KEYS = ['version','contextOrigin','sourceMessageId','companyId','environment','messageCode','payloadHash','sourceReceivedAt','capturedAt']
const states = new Set(['accepted','rejected','not_applicable','manual_review'])

/** Call only with the ORIGINAL row and the row just passed to the real
 * resolveCanonicalRuntimeDecisionWithRegistry owner. Never hydrate decision
 * input from status JSON, a cached validation_report or an onboarding receipt.
 * This is canonical-runtime facet evidence, not approval of every LIN object,
 * register chain, party, supersession or temporal comparison baseline. */
export function buildReceivedSourceValidationEvidence(input: { original: SourceFacts; validated: SourceFacts; resolvedCompanyId: unknown; decision: RuntimeFacts }): SourceValidationInput | null {
  const { original, validated, decision } = input
  const ack = ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(String(original.message_family))
  const utilts = original.message_family === 'UTILTS'
  const byteLimit = ack || utilts ? 8388608 : 262144
  if (original.direction !== 'inbound' || original.message_standard !== 'edifact' || (original.message_family !== 'PRODAT' && !ack && !utilts)
    || !isEvidenceUuid(original.id) || !isEvidenceUuid(original.company_id)
    || (original.environment !== 'test' && original.environment !== 'production') || typeof original.raw_payload !== 'string'
    || original.raw_payload.length > byteLimit || Buffer.byteLength(original.raw_payload,'utf8') > byteLimit
    || !isEvidenceRecord(original.execution_context_snapshot)) return null
  const context = original.execution_context_snapshot[ack ? 'receivedAckContext' : utilts ? 'receivedUtiltsContext' : 'receivedProdatContext']
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
  let rulePackEvidence: ReturnType<typeof receivedOriginalRulePackWitness> = null
  if (evidence != null) {
    if(!isEvidenceRecord(evidence) || !isEvidenceUuid(evidence.messageProfileId) || !isEvidenceUuid(evidence.rulePackId)
      || (Object.hasOwn(evidence,'databaseProfileKey') && (typeof evidence.databaseProfileKey!=='string' || !evidence.databaseProfileKey))) return null
    rulePackEvidence=receivedOriginalRulePackWitness(evidence)
    if(!rulePackEvidence) return null
  }
  // Registry-unavailable acceptance is never silently downgraded to evidence
  // with an unknown rule version. Rejection can legitimately precede registry.
  if (decision.applicationDecision === 'accepted' && rulePackEvidence === null) return null
  if ((ack || utilts) && decision.prodatRegisterValidation !== undefined) return null
  if(!utilts && decision.utiltsTransactionValidation!==undefined) return null
  const utiltsTransactionValidation=decision.utiltsTransactionValidation!==undefined ? bindReceivedUtiltsTransactionValidation(decision.utiltsTransactionValidation,original.raw_payload) : null
  if(decision.utiltsTransactionValidation!==undefined && !utiltsTransactionValidation) return null
  if(!utilts && decision.utiltsHeaderValidation!==undefined) return null
  const utiltsHeaderValidation=decision.utiltsHeaderValidation!==undefined ? bindReceivedUtiltsHeaderValidation(decision.utiltsHeaderValidation,original.raw_payload) : null
  if(decision.utiltsHeaderValidation!==undefined && (!utiltsHeaderValidation || decision.syntaxDecision!=='accepted'
    || !['rejected','manual_review'].includes(String(decision.applicationDecision)) || !utiltsTransactionValidation
    || utiltsTransactionValidation.transactions.some(transaction=>transaction.disposition!=='guide_rejected' || transaction.responseType!=='negative_aperak'))) return null
  if(!utilts && decision.utiltsFunctionalValidation!==undefined) return null
  const utiltsFunctionalValidation=decision.utiltsFunctionalValidation!==undefined && utiltsTransactionValidation ? bindReceivedUtiltsFunctionalValidation(decision.utiltsFunctionalValidation,original.raw_payload,utiltsTransactionValidation) : null
  if(decision.utiltsFunctionalValidation!==undefined && (!utiltsFunctionalValidation || decision.syntaxDecision!=='accepted'
    || !['rejected','manual_review'].includes(String(decision.functionalDecision)))) return null
  const hasRegisterValidation = decision.prodatRegisterValidation !== undefined
  const registerValidation = hasRegisterValidation ? bindReceivedRegisterValidation(decision.prodatRegisterValidation, original.raw_payload) : null
  if (hasRegisterValidation && (!registerValidation || !rulePackEvidence)) return null
  if ((ack||utilts) && decision.prodatIgnoredFields!==undefined) return null
  const prodatIgnoredFields=decision.prodatIgnoredFields!==undefined?bindReceivedProdatIgnoredFields(decision.prodatIgnoredFields,original.raw_payload):null
  if(decision.prodatIgnoredFields!==undefined && (!hasRegisterValidation||!prodatIgnoredFields)) return null
  return { companyId: original.company_id, environment: original.environment, sourceMessageId: original.id, sourcePayloadHash,...(prodatIgnoredFields?{prodatIgnoredFields}:{}),...(utiltsTransactionValidation ? {utiltsTransactionValidation} : {}),...(utiltsHeaderValidation ? {utiltsHeaderValidation} : {}),...(utiltsFunctionalValidation ? {utiltsFunctionalValidation} : {}),
    factsText: JSON.stringify({ version: 1, owner: 'canonical-runtime-with-registry-v1', sourceDisposition: 'not_established',
      objectDisposition: 'not_checked', partyDisposition: 'not_checked', coverage: 'canonical_runtime_only', originalTenantMatch: 'matched',
      syntaxDecision: decision.syntaxDecision, applicationDecision: decision.applicationDecision, functionalDecision: decision.functionalDecision,
      messageReference, reasonCodes, rulePackEvidence, ...(hasRegisterValidation ? { registerValidation } : {}) }) }
}
