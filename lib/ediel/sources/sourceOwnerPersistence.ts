import {supabaseService} from '@/lib/supabase/service'
import {takeReceivedSourceOwnerSeed} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {evidenceHash, isEvidenceRecord, isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {SourceObjectScope} from './sourceOwnerWire'

export type SourceOwnerReceipt =
  | {status:'unconfirmed';sourceDisposition:'not_established'}
  | {status:'recorded';sourceDisposition:'accepted'|'not_established';assessmentId:string;factsHash:string;witnessId:string;availableAt:string}
export type SourceOwnerSeed = NonNullable<ReturnType<typeof takeReceivedSourceOwnerSeed>>
export type SourceObjectDecision = {object:SourceObjectScope;disposition:'accepted'|'rejected'|'unavailable';reasons:string[];business:Record<string,unknown>|null;party:Record<string,unknown>|null}
type Seed = SourceOwnerSeed
type ObjectDecision = SourceObjectDecision
const unconfirmed = ():SourceOwnerReceipt => ({status:'unconfirmed',sourceDisposition:'not_established'})

/** Persist immutable compositions, then observe them in a separate committed
 * transaction. Every receipt is bound to the exact source and composition. */
export async function persistReceivedSourceOwnerDecisions(seed:Seed, objects:ObjectDecision[]):Promise<SourceOwnerReceipt> {
  try {
    const {evidence,assessmentId:canonicalAssessmentId} = seed
    const factsText = JSON.stringify({version:1,owner:'received-source-object-decisions-v1',ruleVersion:'1',canonicalFactsHash:evidenceHash(evidence.factsText),objects})
    if (Buffer.byteLength(factsText,'utf8') > 262144) return unconfirmed()
    const factsHash = evidenceHash(factsText)
    const {data,error} = await supabaseService.rpc('gridex_record_source_object_decisions_v1',{
      p_company_id:evidence.companyId,p_environment:evidence.environment,p_source_message_id:evidence.sourceMessageId,
      p_source_payload_hash:evidence.sourcePayloadHash,p_canonical_assessment_id:canonicalAssessmentId,p_facts_text:factsText,
    }).abortSignal(AbortSignal.timeout(2000))
    if (error || !isEvidenceRecord(data) || data.version !== 1 || !isEvidenceUuid(data.assessmentId)
      || data.companyId !== evidence.companyId || data.environment !== evidence.environment || data.sourceMessageId !== evidence.sourceMessageId
      || data.sourcePayloadHash !== evidence.sourcePayloadHash || data.canonicalAssessmentId !== canonicalAssessmentId || data.factsHash !== factsHash) return unconfirmed()
    const assessmentId = data.assessmentId
    const {data:witness,error:witnessError} = await supabaseService.rpc('gridex_witness_source_objects_v1',{
      p_company_id:evidence.companyId,p_environment:evidence.environment,p_assessment_id:assessmentId,p_facts_hash:factsHash,
    }).abortSignal(AbortSignal.timeout(2000))
    if (witnessError || !isEvidenceRecord(witness) || witness.version !== 1 || !isEvidenceUuid(witness.witnessId)
      || witness.assessmentId !== assessmentId || witness.companyId !== evidence.companyId || witness.environment !== evidence.environment
      || witness.factsHash !== factsHash || typeof witness.availableAt !== 'string') return unconfirmed()
    const available = parseSourceReceiptInstant(witness.availableAt), received = parseSourceReceiptInstant(seed.original.message_received_at)
    // JS clock resolution is milliseconds; retain PostgreSQL microseconds and
    // compare against the exclusive end of the current millisecond.
    if (available === null || received === null || available < received || available >= (BigInt(Date.now())+BigInt(1))*BigInt(1000)
      || objects.some(entry => entry.party && available < parseSourceReceiptInstant(entry.party.completedAt)!)) return unconfirmed()
    return {status:'recorded',sourceDisposition:objects.every(entry=>entry.disposition==='accepted')?'accepted':'not_established',assessmentId,factsHash,witnessId:witness.witnessId,availableAt:witness.availableAt}
  } catch { return unconfirmed() }
}
