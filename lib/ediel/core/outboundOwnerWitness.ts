import { supabaseService } from '@/lib/supabase/service'
import type { EdielSourceRulePackEvidence } from './sourceRulePackEvidence'
export type PreparedOutboundOwnerWitness = Readonly<{ witnessId: string; evidence: EdielSourceRulePackEvidence }>
/** Call with the SAME exact original witness returned by actual canonical
 * validation, before the original raw message INSERT. No latest re-selection. */
export async function prepareEdielOutboundOwnerWitness(input: {
  companyId: string
  actorUserId: string
  environment: 'test' | 'production'
  rawPayload: string
  rulePackEvidence: EdielSourceRulePackEvidence
  relatedMessageId?: string | null
  sourceQualifiedPositiveFixtureWitnessId?: string
  sourceQualifiedNegativeFixtureWitnessId?: string
}): Promise<PreparedOutboundOwnerWitness> {
  const { data, error } = await supabaseService.rpc('ediel_prepare_outbound_owner_witness_v1', { p_input: input })
  const result = data as { version?: unknown; witnessId?: unknown; evidence?: unknown } | null
  if (error || !result || result.version !== 1 || typeof result.witnessId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.witnessId)
    || !result.evidence || typeof result.evidence !== 'object') throw new Error('ediel_outbound_owner_witness_required', { cause: error })
  const e = result.evidence as EdielSourceRulePackEvidence
  if (e.rulePackId !== input.rulePackEvidence.rulePackId || e.messageProfileId !== input.rulePackEvidence.messageProfileId
    || e.profileKey !== input.rulePackEvidence.profileKey || e.sourceHash !== input.rulePackEvidence.sourceHash
    || e.version !== input.rulePackEvidence.version || e.snapshot?.profileKey !== e.profileKey
    || e.snapshot?.profileVersionId !== e.messageProfileId || e.snapshot?.version !== e.version || e.snapshot?.checksum !== e.sourceHash) throw new Error('ediel_outbound_owner_witness_required')
  return Object.freeze({ witnessId: result.witnessId, evidence: e })
}
