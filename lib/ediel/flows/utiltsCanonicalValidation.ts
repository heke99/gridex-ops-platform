import {finalizeCanonicalUtiltsRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry,type CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
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
