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
  if (input.original.message_family !== 'PRODAT' || !isEvidenceUuid(input.original.id) || !isEvidenceUuid(input.original.company_id)) {
    return { status: 'not_requested', sourceDisposition: 'not_established' }
  }
  try {
    const capturedOriginal = structuredClone(input.original)
    const evidence = buildReceivedSourceValidationEvidence({...input, original: capturedOriginal})
    if (!evidence) return { status: 'unconfirmed', sourceDisposition: 'not_established' }
    const { data, error } = await supabaseService.rpc('gridex_record_source_validation_v1', {
      p_company_id: evidence.companyId, p_environment: evidence.environment, p_source_message_id: evidence.sourceMessageId,
      p_source_payload_hash: evidence.sourcePayloadHash, p_facts_text: evidence.factsText,
    }).abortSignal(AbortSignal.timeout(2000))
    const factsHash = evidenceHash(evidence.factsText)
    if (error || !isEvidenceRecord(data) || data.version !== 1 || data.companyId !== evidence.companyId || data.environment !== evidence.environment
      || data.sourceMessageId !== evidence.sourceMessageId || data.sourcePayloadHash !== evidence.sourcePayloadHash || data.factsHash !== factsHash
      || data.sourceDisposition !== 'not_established' || !isEvidenceUuid(data.assessmentId)) return { status: 'unconfirmed', sourceDisposition: 'not_established' }
    const receipt: ReceivedSourceValidationReceipt = { status: 'recorded', sourceDisposition: 'not_established', assessmentId: data.assessmentId, factsHash }
    freshOwnerSeeds.set(receipt, {original: capturedOriginal, evidence, assessmentId: data.assessmentId})
    return receipt
  } catch { return { status: 'unconfirmed', sourceDisposition: 'not_established' } }
}
