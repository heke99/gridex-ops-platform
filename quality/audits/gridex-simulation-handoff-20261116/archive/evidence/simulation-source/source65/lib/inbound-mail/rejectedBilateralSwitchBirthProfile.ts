import {segmentComposite,segmentElementCount,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {BilateralSwitchBirthProfile} from './bilateralSwitchBirthProfile'

/** Catalog witnesses for the recognizable rejected two-register H source only.
 * The malformed second C829 remains invalid: this selects no original, grants
 * no admission/business authority and never inherits common fields onto it.
 */
export async function resolveRejectedBilateralSwitchBirthProfile(input: {
  rawPayload: string | null | undefined; receivedAt: string
}): Promise<BilateralSwitchBirthProfile | null> {
  if (!validateEdifactEnvelope(input.rawPayload).syntaxOk) return null
  const {segments,una}=tokenizeEdifact(input.rawPayload)
  const unhs=segments.filter(t=>t.tag==='UNH'),bgms=segments.filter(t=>t.tag==='BGM')
  if (unhs.length!==1||bgms.length!==1) return null
  const association=segmentComposite(unhs[0],2,una)
  const code=segmentComposite(bgms[0],1,una)
  const application=segmentComposite(segments.find(t=>t.tag==='UNB'),7,una)
  if (association.length!==5||association.slice(0,4).join(':')!=='PRODAT:D:97A:UN'||!association[4]
    ||code.length!==1||code[0]!=='Z04'||application.length!==1||application[0]!=='23-DDQ-PRODAT') return null
  const grouping=prodatRegisterGroups(segments,una,'Z04')
  if (grouping.groups.length!==2) return null
  const [first,second]=grouping.groups
  if (segments.indexOf(bgms[0])>segments.indexOf(first.segments[0])
    ||first.messageIndex!==second.messageIndex||first.itemId!==second.itemId||first.identityAgency!==second.identityAgency) return null
  for (const [index,group] of grouping.groups.entries()) {
    const identity=prodatRegisterFieldState('209',group.segments,una)
    const sequence=prodatRegisterFieldState('314',group.segments,una)
    if (!identity?.present||identity.malformed||!sequence?.present||sequence.malformed||sequence.value!==String(index+1)) return null
    const register=segmentComposite(group.segments[0],4,una)
    if (segmentElementCount(group.segments[0],una)!==4||register.length!==2
      ||register[0]!=='1'||register[1]!== (index===0?'1':'')) return null
  }
  const expectedProblems=['invalid_C829_indicator_or_index','per_object_register_sequence_invalid']
  if (grouping.problems.length!==2||grouping.problems.some(p=>p.fieldNumber!=='258'||p.lineIndex!==second.lineIndex)
    ||!expectedProblems.every(reason=>grouping.problems.some(p=>p.reason===reason))) return null

  // Count every supplied selector before checking its exact physical spelling.
  // A header/late/empty/second selector must not vanish through normalization.
  const qualifiers=segments.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]?.trim().toUpperCase()==='Z13')
  if (qualifiers.length!==1) return null
  const own=first.segments,cci=qualifiers[0],index=own.indexOf(cci),cav=own[index+1]
  const parent=own.findIndex(t=>t.tag==='RFF'||t.tag==='NAD'),separator=una.dataElementSeparator
  if (index<0||parent>=0&&index>=parent||segmentUntrimmedRaw(cci)!==`CCI${separator}${separator}Z13`
    ||!cav||cav.tag!=='CAV'||own[index+2]?.tag==='CAV') return null
  const reason=segmentComposite(cav,1,una)
  if (segmentElementCount(cav,una)!==1||reason.length>5||reason[0]!=='Z25'||reason.slice(1).some(v=>v!=='')
    ||segmentUntrimmedRaw(cav)!==`CAV${separator}Z25${una.componentDataElementSeparator.repeat(reason.length-1)}`) return null
  if (parseSourceReceiptInstant(input.receivedAt)===null) throw Error('rejected_bilateral_switch_birth_receipt_clock_invalid')
  const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z04',transactionSubtype:'Z25',
    applicationReference:application[0],direction:'inbound',businessDate:stockholmBusinessDate(new Date(input.receivedAt))})
  if (association[4]!==evidence.unhAssociationCode) throw Error('rejected_bilateral_switch_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw Error('rejected_bilateral_switch_birth_database_profile_key_missing')
  return {canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,
    rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,rule_pack_checksum:evidence.sourceHash,
    rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,
      profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash}}
}
