import {parseCanonicalEdielPayload} from '@/lib/ediel/core/canonicalMessage'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {prodatCharacteristicValues} from '@/lib/ediel/prodat/prodatCharacteristicFields'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatRegisterGroups,prodatRegisterRuleScopes} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {evaluateProdatTransactionReason} from '@/lib/ediel/prodat/prodatTransactionReason'
import {resolveCanonicalRulePack,type OriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

export type BilateralSwitchBirthProfile = {
  canonical_rule_pack_id: string
  rule_profile_key: string
  rule_profile_version_id: string
  rule_profile_version: string
  rule_pack_checksum: string
  rule_pack_snapshot: OriginalRulePackWitness & {
    profileKey: string; profileVersionId: string; version: string; checksum: string
  }
}

/** Prospective catalog witnesses only. Bilateral agreement, original custody,
 * admission, validation and business effects remain with their actual owners.
 * Common field223 belongs to each object's valid first register; later valid
 * Z04 registers inherit it through the existing physical grouping authority.
 */
export async function resolveBilateralSwitchBirthProfile(input: {
  rawPayload: string | null | undefined; receivedAt: string
}): Promise<BilateralSwitchBirthProfile | null> {
  if (!validateEdifactEnvelope(input.rawPayload).syntaxOk) return null
  const {segments,una}=tokenizeEdifact(input.rawPayload)
  const unhs=segments.filter(token=>token.tag==='UNH'),bgms=segments.filter(token=>token.tag==='BGM')
  if(unhs.length!==1||bgms.length!==1) return null
  const association=segmentComposite(unhs[0],2,una)
  if(association.length!==5||association.slice(0,4).join(':')!=='PRODAT:D:97A:UN'||!association[4]
    ||segmentComposite(bgms[0],1,una)[0]!=='Z04') return null
  const canonical=parseCanonicalEdielPayload({rawPayload:input.rawPayload,direction:'inbound',standardHint:'edifact'})
  if(canonical.family!=='PRODAT'||canonical.messageCode!=='Z04'||canonical.applicationReference!=='23-DDQ-PRODAT') return null
  const grouping=prodatRegisterGroups(segments,una,'Z04')
  if(grouping.problems.length||!grouping.groups.length||grouping.groups.some(group=>{
    const identity=prodatRegisterFieldState('209',group.segments,una)
    return !group.validRegisterChain||!identity?.present||identity.malformed
  })) return null
  const scopes=prodatRegisterRuleScopes('223',segments,una,'Z04')??[]
  // Count physical qualifiers as well as semantic values: header and later
  // empty/malformed pairs cannot disappear into the inheritance projection.
  const qualifiers=segments.filter(token=>token.tag==='CCI'&&(segmentComposite(token,2,una)[0]??'').trim().toUpperCase()==='Z13')
  if(!scopes.length||qualifiers.length!==scopes.length||!scopes.every(scope=>{
    const reasons=prodatCharacteristicValues('223',scope,una)
    return reasons.length===1&&reasons[0]==='Z25'
  })) return null
  if(evaluateProdatTransactionReason({rawSegments:canonical.rawSegments,una,code:'Z04'}).issues.length) return null
  const received=new Date(input.receivedAt)
  // Receipt authority is an actual zoned instant, never a date-only/default
  // clock. Reject calendar normalization such as February30 before lookup.
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(input.receivedAt)
    ||!Number.isFinite(received.getTime())
    ||new Date(input.receivedAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==input.receivedAt.slice(0,10)) {
    throw Error('bilateral_switch_birth_receipt_clock_invalid')
  }
  const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z04',transactionSubtype:'Z25',
    applicationReference:canonical.applicationReference,direction:'inbound',businessDate:stockholmBusinessDate(received)})
  if(association[4]!==evidence.unhAssociationCode) throw Error('bilateral_switch_birth_association_mismatch')
  if(!evidence.databaseProfileKey) throw Error('bilateral_switch_birth_database_profile_key_missing')
  return {canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,
    rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,rule_pack_checksum:evidence.sourceHash,
    rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,
      profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash}}
}
