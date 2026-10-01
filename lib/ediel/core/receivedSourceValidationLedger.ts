import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { CanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { buildReceivedSourceValidationEvidence, type SourceValidationInput } from '@/lib/ediel/core/receivedSourceValidationEvidence'
import { evidenceHash, isEvidenceRecord, isEvidenceUuid } from '@/lib/ediel/utilts/durableSourceDiscovery'

export type ReceivedSourceValidationReceipt =
  | { status: 'not_requested' | 'unconfirmed'; sourceDisposition: 'not_established' }
  | { status: 'recorded'; sourceDisposition: 'not_established'; assessmentId: string; factsHash: string }
type OwnerSeed = {original: EdielMessageRow; evidence: SourceValidationInput; assessmentId: string}
const freshOwnerSeeds = new WeakMap<object, OwnerSeed>()

/** One-use, same-invocation handoff. A persisted or copied receipt has no seed,
 * and cannot turn status JSON into a fresh canonical-owner decision. */
export function takeReceivedSourceOwnerSeed(receipt: ReceivedSourceValidationReceipt): OwnerSeed | null {
  const seed = freshOwnerSeeds.get(receipt)
  freshOwnerSeeds.delete(receipt)
  return seed ?? null
}

/** Failure remains an unconfirmed diagnostic: do not change the actual
 * canonical decision, ACK, customer persistence or ingestion outcome. */
export async function recordReceivedSourceValidation(input: {
  original: EdielMessageRow; validated: EdielMessageRow; resolvedCompanyId: string; decision: CanonicalRuntimeDecision
}): Promise<ReceivedSourceValidationReceipt> {
  if (!['PRODAT', 'UTILTS', 'CONTRL', 'APERAK', 'UTILTS_ERR'].includes(input.original.message_family) || !isEvidenceUuid(input.original.id) || !isEvidenceUuid(input.original.company_id)) {
    return { status: 'not_requested', sourceDisposition: 'not_established' }
  }
  try {
    const capturedOriginal = structuredClone(input.original)
    const evidence = buildReceivedSourceValidationEvidence({...input, original: capturedOriginal})
    if (!evidence) return { status: 'unconfirmed', sourceDisposition: 'not_established' }
    const utilts=capturedOriginal.message_family==='UTILTS',prodat=capturedOriginal.message_family==='PRODAT'
    const objectFactsHash=evidence.prodatObjectValidation?evidenceHash(JSON.stringify(evidence.prodatObjectValidation)):null
    const ignoredFactsHash=evidence.prodatIgnoredFields?evidenceHash(JSON.stringify(evidence.prodatIgnoredFields)):null
    const transactionFactsHash=evidence.utiltsTransactionValidation ? evidenceHash(JSON.stringify(evidence.utiltsTransactionValidation)) : null
    const headerFactsHash=evidence.utiltsHeaderValidation ? evidenceHash(JSON.stringify(evidence.utiltsHeaderValidation)) : null
    const functionalFactsHash=evidence.utiltsFunctionalValidation ? evidenceHash(JSON.stringify(evidence.utiltsFunctionalValidation)) : null
    const { data, error } = await supabaseService.rpc(utilts ? 'gridex_record_utilts_source_validation_v4' : prodat?'gridex_record_prodat_source_validation_v3':'gridex_record_source_validation_v1', {
      p_company_id: evidence.companyId, p_environment: evidence.environment, p_source_message_id: evidence.sourceMessageId,
      p_source_payload_hash: evidence.sourcePayloadHash, p_facts_text: evidence.factsText,
      ...(prodat?{p_ignored_fields_text:evidence.prodatIgnoredFields?JSON.stringify(evidence.prodatIgnoredFields):null,p_object_facts_text:evidence.prodatObjectValidation?JSON.stringify(evidence.prodatObjectValidation):null}:{}),
      ...(utilts ? {p_transaction_facts_text:evidence.utiltsTransactionValidation ? JSON.stringify(evidence.utiltsTransactionValidation) : null,p_header_facts_text:evidence.utiltsHeaderValidation ? JSON.stringify(evidence.utiltsHeaderValidation) : null,p_functional_facts_text:evidence.utiltsFunctionalValidation ? JSON.stringify(evidence.utiltsFunctionalValidation) : null} : {}),
    }).abortSignal(AbortSignal.timeout(2000))
    const factsHash = evidenceHash(evidence.factsText)
    if (error || !isEvidenceRecord(data) || data.version !== (utilts ? 4 : prodat?3:1) || data.companyId !== evidence.companyId || data.environment !== evidence.environment
      || data.sourceMessageId !== evidence.sourceMessageId || data.sourcePayloadHash !== evidence.sourcePayloadHash || data.factsHash !== factsHash
      || (prodat&&(data.ignoredFieldsHash!==ignoredFactsHash||data.objectFactsHash!==objectFactsHash)) || data.sourceDisposition !== 'not_established' || !isEvidenceUuid(data.assessmentId) || (utilts && (data.transactionFactsHash!==transactionFactsHash || data.headerFactsHash!==headerFactsHash || data.functionalFactsHash!==functionalFactsHash))) return { status: 'unconfirmed', sourceDisposition: 'not_established' }
    const receipt: ReceivedSourceValidationReceipt = { status: 'recorded', sourceDisposition: 'not_established', assessmentId: data.assessmentId, factsHash }
    if (capturedOriginal.message_family === 'PRODAT') {
      freshOwnerSeeds.set(receipt,{original:capturedOriginal,evidence,assessmentId:data.assessmentId})
    }
    return receipt
  } catch { return { status: 'unconfirmed', sourceDisposition: 'not_established' } }
}
