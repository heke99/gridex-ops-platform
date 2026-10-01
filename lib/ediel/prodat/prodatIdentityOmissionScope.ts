import {segmentComposite, segmentElementCount} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES} from './prodat26AFieldMatrix'
import {resolveProdatSourceSubtypeRequirement} from './prodatSubtypeRequirement'
import {PRODAT_SUBTYPE_RULES} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {prodatEndUserWireSubtype} from '@/lib/ediel/rulebook/prodatEndUserPolicy'
import type {ProdatRegisterGroup} from './prodatRegisterGroups'

/** Derivative of the existing field209 matrix and subtype owner. Omission
 * preserves a physical LIN scope; it never supplies an object or business fact. */
export function prodatIdentityOmissionCases() {
  const field=PRODAT_26A_FIELD_MATRIX.find(row=>row.fieldNumber==='209')!
  return PRODAT_SUBTYPE_RULES.flatMap(rule=>rule.allowedMessageCodes.flatMap(code=>{
    const requirement=field.requirements[PRODAT_26A_MESSAGE_CODES.indexOf(code)]
    const outcome=requirement==='D'?resolveProdatSourceSubtypeRequirement({messageCode:code,fieldNumber:'209',subtype:rule.subtype}):null
    return requirement==='-'||outcome==='forbidden'?[{messageCode:code,transactionReason:rule.transactionReasonCode}]:[]
  }))
}

/** Exact absent C212, valid mandatory LIN314 and one actual own field223.
 * Partial identities and register chains cannot borrow omission privileges. */
export function isProdatIdentityOmissionScope(code:string,group:ProdatRegisterGroup,una:EdifactServiceStringAdvice):boolean {
  const lin=group.segments[0]
  if(group.itemId!==null||group.identityAgency!==null||!group.validRegisterChain||group.registerCount!==1
    ||group.registerIndex!==null||lin?.tag!=='LIN'||segmentElementCount(lin,una)>3
    ||segmentComposite(lin,3,una).some(value=>value!==''))return false
  const sequence=segmentComposite(lin,1,una)
  if(sequence.length!==1||!/^\d{1,6}$/.test(sequence[0])||Number(sequence[0])<1)return false
  const reasonCci=group.segments.findIndex(token=>token.tag==='CCI'&&segmentComposite(token,2,una)[0]==='Z13')
  const reason=reasonCci<0?undefined:segmentComposite(group.segments[reasonCci+1],1,una)[0]
  if(!reason||reason!==reason.trim())return false
  const subtype=prodatEndUserWireSubtype(code,group.segments,una)
  return subtype!==null&&PRODAT_SUBTYPE_RULES.some(rule=>rule.subtype===subtype
    &&prodatIdentityOmissionCases().some(entry=>entry.messageCode===code&&entry.transactionReason===rule.transactionReasonCode))
}
