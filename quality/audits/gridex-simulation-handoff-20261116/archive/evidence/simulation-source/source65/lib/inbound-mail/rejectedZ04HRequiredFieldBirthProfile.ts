import {segmentComposite,segmentElementCount,segmentUntrimmedRaw,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {prodatRegisterFieldState} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {BilateralSwitchBirthProfile} from '@/lib/inbound-mail/bilateralSwitchBirthProfile'

/** Catalog evidence for an exact single-register H original missing314 or209.
 * Actual invalid fields remain invalid; no accepted original, legal admission
 * or business capability is created. This does not alter the retained258 owner. */
export async function resolveRejectedZ04HRequiredFieldBirthProfile(input: {
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
  if (grouping.groups.length!==1) return null
  const [first]=grouping.groups
  if (first.messageIndex!==0||segments.indexOf(bgms[0])>segments.indexOf(first.segments[0])) return null
  // Only these recognizable rejected originals retain an independently
  // supplied H/Z25 selector. Preserve the missing source field as missing.
  const line=first.segments[0],identity=prodatRegisterFieldState('209',first.segments,una)
  const sequence=prodatRegisterFieldState('314',first.segments,una)
  const item=segmentComposite(line,3,una),number=segmentComposite(line,1,una)
  if (segmentElementCount(line,una)!==3||item.length!==4||item[1]!==''||item[2]!==''
    ||!['9','89'].includes(item[3])||number.length!==1) return null
  const missing314=number[0]===''&&sequence?.present===false&&!sequence.malformed
    &&identity?.present===true&&!identity.malformed&&item[0]===identity.value
    &&grouping.problems.length===1&&grouping.problems[0].fieldNumber==='314'
    &&grouping.problems[0].lineIndex===first.lineIndex
    &&grouping.problems[0].reason==='global_sequence_must_increment_from_one'
  const missing209=number[0]==='1'&&sequence?.value==='1'&&!sequence.malformed
    &&item[0]===''&&identity?.value===null&&identity.malformed
    &&first.validRegisterChain&&grouping.problems.length===0
  if (!missing314&&!missing209) return null

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
  if (parseSourceReceiptInstant(input.receivedAt)===null) throw Error('rejected_z04h_required_field_birth_receipt_clock_invalid')
  const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z04',transactionSubtype:'Z25',
    applicationReference:application[0],direction:'inbound',businessDate:stockholmBusinessDate(new Date(input.receivedAt))})
  if (association[4]!==evidence.unhAssociationCode) throw Error('rejected_z04h_required_field_birth_association_mismatch')
  if (!evidence.databaseProfileKey) throw Error('rejected_z04h_required_field_birth_database_profile_key_missing')
  return {canonical_rule_pack_id:evidence.rulePackId,rule_profile_key:evidence.databaseProfileKey,
    rule_profile_version_id:evidence.messageProfileId,rule_profile_version:evidence.originalVersion,rule_pack_checksum:evidence.sourceHash,
    rule_pack_snapshot:{...evidence.originalSnapshot,profileKey:evidence.databaseProfileKey,
      profileVersionId:evidence.messageProfileId,version:evidence.originalVersion,checksum:evidence.sourceHash}}
}
