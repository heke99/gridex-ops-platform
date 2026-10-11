import {segmentComposite,segmentElementCount,segmentUntrimmedRaw} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {prodatRegisterGroups, type ProdatRegisterGroup} from './prodatRegisterGroups'
import {prodatRegisterFieldState} from './prodatRegisterFields'
import {prodatCharacteristicValues} from './prodatCharacteristicFields'
import {evaluateProdatTransactionReason} from './prodatTransactionReason'
import {prodatErrorOccurrence, validProdatWireDiagnostic, type ProdatDiagnostic} from './prodatFieldDiagnostic'

type Input = {code: string; group: ProdatRegisterGroup; rawSegments: readonly string[]; una: EdifactServiceStringAdvice}
const reference = (group: ProdatRegisterGroup, una: EdifactServiceStringAdvice) => {
  const party = group.segments.findIndex(token => token.tag === 'NAD')
  const refs = group.segments.slice(0, party < 0 ? undefined : party)
    .filter(token => token.tag === 'RFF' && segmentComposite(token, 1, una)[0] === 'LI')
  const parts = refs.length === 1 ? segmentComposite(refs[0], 1, una) : []
  return parts.length === 2 && /^[^\x00-\x1f\x7f]{1,128}$/.test(parts[1]) && parts[1] === parts[1].trim() ? parts[1] : null
}

/** Physical serialization boundary for a rejected Z05 H/L or exact Z04 H identity.
 * This is not lawful identity omission, a field decision or accepted authority.
 * Keep each null identity keyed by its exact first LIN and unique own LI.
 */
export function isProdatRejectedIdentityScope(input: Input): boolean {
  if (input.code === 'Z04') return isRejectedZ04HIdentityScope(input)
  if (input.code !== 'Z05' || input.group.itemId !== null) return false
  const all = prodatRegisterGroups(input.rawSegments, input.una, input.code)
  const bgms = all.tokens.filter(token => token.tag === 'BGM')
  if (all.tokens.filter(token => token.tag === 'UNH').length !== 1 || bgms.length !== 1
    || segmentComposite(bgms[0], 1, input.una)[0] !== input.code
    || all.problems.some(problem => problem.fieldNumber === '314')) return false
  const own = all.groups.find(group => group.lineIndex === input.group.lineIndex
    && group.segments[0].index === input.group.segments[0]?.index && group.segments[0].raw === input.group.segments[0]?.raw)
  if (!own || own.messageIndex !== 0 || own.itemId !== null || own.identityAgency !== input.group.identityAgency
    || own.lineNumber !== input.group.lineNumber || !own.validRegisterChain || own.registerCount !== 1
    || own.registerPosition !== 1 || own.registerIndex !== null) return false
  const state = prodatRegisterFieldState('209', own.segments, input.una)
  if (!state || state.value !== null || state.present && !state.malformed) return false
  const reasons = prodatCharacteristicValues('223', all.tokens, input.una)
  if (reasons.length !== all.groups.length || !['Z25', 'Z22'].includes(reasons[0])
    || reasons.some(reason => reason !== reasons[0])
    || evaluateProdatTransactionReason({rawSegments: input.rawSegments, una: input.una, code: input.code}).issues.length) return false
  const li = reference(own, input.una)
  return li !== null && all.groups.filter(group => reference(group, input.una) === li).length === 1
}

/** The projection/negative-response edge additionally needs the real typed209
 * finding, its exact physical occurrence and submitted failure evidence.
 */
export function hasProdatRejectedIdentityDiagnostic(input: Input, diagnostic: ProdatDiagnostic | undefined): boolean {
  if (!validProdatWireDiagnostic(diagnostic) || diagnostic.kind !== 'field' || diagnostic.fieldNumber !== '209'
    || diagnostic.occurrence.scope === 'header' || !isProdatRejectedIdentityScope(input)) return false
  const state = prodatRegisterFieldState('209', input.group.segments, input.una)!
  if (diagnostic.errorKind !== (state.malformed ? 'invalid' : 'missing')
    || diagnostic.errorKind === 'invalid' && JSON.stringify(diagnostic.failureEvidence) !== JSON.stringify(state.failureEvidence)) return false
  const actual = prodatErrorOccurrence({code: input.code, rawSegments: input.rawSegments, una: input.una},
    [], diagnostic.occurrence.scope, input.group.lineIndex)
  return !!actual && (['scope', 'messageReference', 'lineIndex', 'lineNumber', 'registerPosition', 'objectId', 'identityAgency', 'lineItemReference'] as const)
    .every(key => diagnostic.occurrence[key] === actual[key])
    && (['objectId', 'lineItemReference', 'customerId'] as const).every(key => {
      const submitted = diagnostic.occurrence.ownReferences?.[key], physical = actual.ownReferences?.[key]
      return !!submitted && !!physical && submitted.kind === physical.kind
        && (submitted.kind !== 'present' || physical.kind === 'present' && submitted.value === physical.value)
    })
}

/** Rejected-only serialization of an exact recognizable original Z04 H LIN.
 * No lawful identity omission or accepted source/object is supplied. */
function isRejectedZ04HIdentityScope(input:Input):boolean {
 const all=prodatRegisterGroups(input.rawSegments,input.una,'Z04')
 if(all.groups.length!==1||all.problems.length)return false
 const own=all.groups[0],lin=own.segments[0]
 const unb=all.tokens.filter(token=>token.tag==='UNB'),unh=all.tokens.filter(token=>token.tag==='UNH'),bgm=all.tokens.filter(token=>token.tag==='BGM')
 if(unb.length!==1||unh.length!==1||bgm.length!==1
  ||segmentComposite(unb[0],7,input.una).join(':')!=='23-DDQ-PRODAT'
  ||segmentComposite(unh[0],2,input.una).join(':')!=='PRODAT:D:97A:UN:E2SE6A'
  ||segmentComposite(bgm[0],1,input.una).join(':')!=='Z04'||bgm[0].index>=lin.index
  ||own.messageIndex!==0||own.itemId!==null||own.identityAgency!==input.group.identityAgency
  ||own.lineIndex!==input.group.lineIndex||own.segments[0].index!==input.group.segments[0]?.index
  ||own.segments[0].raw!==input.group.segments[0]?.raw||own.lineNumber!=='1'
  ||!own.validRegisterChain||own.registerCount!==1||own.registerPosition!==1||own.registerIndex!==null)return false
 const item=segmentComposite(lin,3,input.una),number=segmentComposite(lin,1,input.una),state=prodatRegisterFieldState('209',own.segments,input.una)
 if(segmentElementCount(lin,input.una)!==3||number.length!==1||number[0]!=='1'||item.length!==4
  ||item.slice(0,3).some(component=>component!=='')||!['9','89'].includes(item[3])
  ||!state?.present||state.value!==null||!state.malformed)return false
 const selectors=all.tokens.filter(token=>token.tag==='CCI'&&(segmentComposite(token,2,input.una)[0]??'').trim().toUpperCase()==='Z13')
 if(selectors.length!==1)return false
 const cci=selectors[0],index=own.segments.indexOf(cci),cav=own.segments[index+1],parent=own.segments.findIndex(token=>token.tag==='RFF'||token.tag==='NAD')
 if(index<0||parent>=0&&index>=parent||segmentUntrimmedRaw(cci)!==`CCI${input.una.dataElementSeparator}${input.una.dataElementSeparator}Z13`
  ||!cav||cav.tag!=='CAV'||own.segments[index+2]?.tag==='CAV'
   )return false
 const reason=segmentComposite(cav,1,input.una)
 if(segmentElementCount(cav,input.una)!==1||reason.length>5||reason[0]!=='Z25'||reason.slice(1).some(value=>value!=='')
  ||segmentUntrimmedRaw(cav)!==`CAV${input.una.dataElementSeparator}Z25${input.una.componentDataElementSeparator.repeat(reason.length-1)}`)return false
 return reference(own,input.una)!==null
}
