import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {EDIEL_ACK_DEADLINE_MINUTES} from '@/lib/ediel/specRegistry'
import {canonicalMessageCode} from '@/lib/ediel/core/messageIdentity'

/** This internal sender watch does not assert the recipient's receipt time. */
export const EDIEL_TECHNICAL_ACK_EXPECTATION_CONSTRAINTS=Object.freeze({version:1 as const,ruleId:'TM-CONTRL' as const,
  offset:EDIEL_ACK_DEADLINE_MINUTES,unit:'minutes' as const,anchor:'actual_accepted_smtp_observed_at' as const,
  timerKind:'internal_sender_watch' as const,remoteReceiptKnown:false as const})
export type EdielTechnicalExpectationPlan=Readonly<typeof EDIEL_TECHNICAL_ACK_EXPECTATION_CONSTRAINTS & {
  policy:{guideRevision:string;referenceDate:string;profileKey:string|null;sourceTrace:CanonicalEdielPolicy['sourceTrace']}
}>

/** Prepare from the same admitted policy before provider entry. The immutable
 * accepted journal supplies the sole observation clock to later projections. */
export function prepareEdielTechnicalExpectationPlan(message:EdielMessageRow,policy:CanonicalEdielPolicy):EdielTechnicalExpectationPlan|null {
  if(message.direction!=='outbound' || policy.direction!=='outbound' || message.message_family!==policy.family
    || canonicalMessageCode(message.message_family,String(message.message_code))!==policy.code)throw new Error('ediel_technical_expectation_policy_source_mismatch')
  if(policy.ackRule.technicalAck!=='CONTRL')return null
  return Object.freeze({...EDIEL_TECHNICAL_ACK_EXPECTATION_CONSTRAINTS,policy:Object.freeze({
    guideRevision:policy.guide.guideRevision,referenceDate:policy.referenceDate,profileKey:policy.profileKey,sourceTrace:policy.sourceTrace})})
}
