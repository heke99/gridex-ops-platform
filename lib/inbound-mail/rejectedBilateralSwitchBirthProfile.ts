import {segmentComposite,segmentElementCount,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {BilateralSwitchBirthProfile} from './bilateralSwitchBirthProfile'

/** Catalog witnesses for recognizable rejected H sources: missing single-LIN
 * sequence, or malformed second C829. Both remain invalid: this selects no original, grants
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
  const first=grouping.groups[0]
  if (grouping.groups.length===2) {
    const second=grouping.groups[1]
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
  } else if (grouping.groups.length===1) {
    const lin=first.segments[0],identity=prodatRegisterFieldState('209',first.segments,una)
    const sequence=segmentComposite(lin,1,una),action=segmentComposite(lin,2,una)
    const separator=una.dataElementSeparator,component=una.componentDataElementSeparator
    const reserved=[separator,component,una.releaseCharacter,una.segmentTerminator]
    const encode=(value:string)=>[...value].map(c=>reserved.includes(c)?una.releaseCharacter+c:c).join('')
    const expectedLin=`LIN${separator.repeat(3)}${encode(identity?.value??'')}${component.repeat(3)}${first.identityAgency}`
    if (segments.indexOf(bgms[0])>segments.indexOf(lin)||segmentElementCount(lin,una)!==3
      ||sequence.length!==1||sequence[0]!==''||action.length!==1||action[0]!==''
      ||!identity?.present||identity.malformed||segmentUntrimmedRaw(lin)!==expectedLin
      ||first.validRegisterChain||first.firstLineIndex!==null||first.lineNumber!==null
      ||first.effectiveSegments.length!==first.segments.length||first.effectiveSegments.some((t,i)=>t!==first.segments[i])) return null
    const problem=grouping.problems[0]
    if (grouping.problems.length!==1||problem.fieldNumber!=='314'||problem.lineIndex!==first.lineIndex
      ||problem.segmentIndex!==lin.index||problem.reason!=='global_sequence_must_increment_from_one') return null
    // Count all supplied LI selectors; a header/duplicate/padded qualifier must
    // not disappear through normalized matching. This is not request authority.
    const lis=segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,una)[0]?.trim().toUpperCase()==='LI')
    if (lis.length!==1) return null
    const li=lis[0],parts=segmentComposite(li,1,una),position=first.segments.indexOf(li),nad=first.segments.findIndex(t=>t.tag==='NAD')
    if (position<0||nad>=0&&position>=nad||segmentElementCount(li,una)!==1||parts.length!==2||parts[0]!=='LI'
      ||!parts[1]||parts[1]!==parts[1].trim()||segmentUntrimmedRaw(li)!==`RFF${separator}LI${component}${encode(parts[1])}`) return null
  } else return null

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
