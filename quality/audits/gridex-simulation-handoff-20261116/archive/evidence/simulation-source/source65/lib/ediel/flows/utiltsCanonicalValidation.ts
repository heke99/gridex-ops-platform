import {finalizeCanonicalUtiltsRuntimeDecision,isEvidenceGateBlockedDecision,resolveCanonicalRuntimeDecisionWithRegistry,type CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {createEdielMessageEvent} from '@/lib/ediel/db'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {UtiltsRuntimeResult} from '@/lib/ediel/utiltsEngine'

/** Keep the actual initial owner object through matching. A policy alone does
 * not reproduce its locked original registry witness or its one-use receipt. */
export async function initialCanonicalUtiltsDecision(message:EdielMessageRow,retained?:CanonicalRuntimeDecision|null,policy?:CanonicalEdielPolicy|null) {
  const decision=retained ?? await resolveCanonicalRuntimeDecisionWithRegistry(message)
  if(!decision.policy || decision.policy.family!=='UTILTS' || decision.policy.direction!=='inbound' || decision.policy.code!==message.message_code
    || (retained && policy && policy!==decision.policy)) throw new Error('utilts_initial_canonical_owner_context_mismatch')
  if (!decision.policy.timeAnchors) throw new Error('utilts_runtime_policy_time_context_mismatch')
  return decision as CanonicalRuntimeDecision & {policy:CanonicalEdielPolicy}
}

/** The final matching/structural owner replaces the provisional own-IDE facet
 * before any new native storage/ACK effect. No new guide or registry is read. */
export async function recordFinalCanonicalUtiltsDecision(input:{original:EdielMessageRow;validated:EdielMessageRow;initialDecision:CanonicalRuntimeDecision;runtime:UtiltsRuntimeResult}) {
  const decision=finalizeCanonicalUtiltsRuntimeDecision({message:input.validated,initialDecision:input.initialDecision,runtime:input.runtime})
  const companyId=input.original.company_id
  if(!companyId) throw new Error('utilts_final_canonical_source_company_required')
  const receipt=await recordReceivedSourceValidation({...input,resolvedCompanyId:companyId,decision})
  if(receipt.status!=='recorded') throw new Error('utilts_final_canonical_transaction_evidence_unconfirmed')
  // Named original witness also supports actual national/functional negative
  // ACK rendering; capturing it never asserts positive own-IDE treatment.
  // Missing active witness can still freeze a genuine negative-only facet.
  if(decision.validationReport.rulePackEvidence) {
    await captureFreshEdielSourceRulePackEvidence(companyId,input.original.id)
  }
  return {decision,receipt}
}

/** The DB evidence gate blocked the initial decision (for example a message
 * code this platform never receives) and no final owner exists. The source is
 * held for manual review: no ACK, receipt, consumption or business effect. */
export async function holdCanonicalEvidenceGateBlocked(input:{actorUserId:string;message:EdielMessageRow;initialDecision:CanonicalRuntimeDecision}):Promise<boolean> {
  if(!isEvidenceGateBlockedDecision(input.initialDecision)) return false
  await createEdielMessageEvent({actorUserId:input.actorUserId,edielMessageId:input.message.id,eventType:'validated',eventStatus:'warning',
    message:'Källans regelunderlag blockerades vid mottagning. Meddelandet hålls för manuell granskning utan kvittens eller affärseffekt.',
    payload:{reason:'ediel_canonical_evidence_gate_blocked',manualReviewRequired:true,decisionTrace:input.initialDecision.decisionTrace.slice(-1)}})
  return true
}
