import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {findProdatSubtypeRule} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {PRODAT_26A_MESSAGE_CODES} from './prodat26AFieldMatrix'
import {prodatCharacteristicValues} from './prodatCharacteristicFields'
import {prodatFieldDiagnostic,prodatLocalDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatDiagnostics} from './prodatDiagnosticProjection'
import {prodatRegisterRuleScopes} from './prodatRegisterGroups'
import {prodatRegisterTokens} from './prodatRegisterFields'

const sourceRule='PRODAT26A:§2.6:P64–65:annex4:P122:223'

/** P field223 is physical SG14 data, not an internal subtype alias. Shared by
 * policy-success, policy-failure and public ACK consumers; no policy snapshot
 * can supply another object's reason or references. Full syntax runs earlier. */
export function evaluateProdatTransactionReason(input:{rawSegments:readonly string[];una?:EdifactServiceStringAdvice;code?:string|null}){
 const una=input.una??parseUna(null),tokens=prodatRegisterTokens(input.rawSegments,una)
 const bgms=tokens.filter(t=>t.tag==='BGM'),firstLin=tokens.findIndex(t=>t.tag==='LIN')
 const code=bgms.length===1?segmentComposite(bgms[0],1,una)[0]?.trim().toUpperCase()??'':bgms.length===0&&!tokens.some(t=>t.tag==='UNH')?input.code??'':''
 const issues:EdielRulebookIssue[]=[]
 const held=(reason:string)=>({severity:'error' as const,blocking:true,code:'PRODAT_TRANSACTION_REASON_SCOPE_UNQUALIFIED',
  title:'Transaktionstyp kräver egen källomfattning',description:reason,prodatDiagnostic:prodatLocalDiagnostic('internal',sourceRule,reason)})
 if(tokens.filter(t=>t.tag==='UNH').length>1||bgms.length>1||bgms.length===1&&firstLin>=0&&tokens.indexOf(bgms[0])>firstLin){
  issues.push(held('Field223 requires one own message and BGM before its LIN objects'))
 }else if(PRODAT_26A_MESSAGE_CODES.some(c=>c===code)){
  for(const scope of prodatRegisterRuleScopes('223',tokens,una,code)??[]){
   const cci=scope.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z13')
   const reasons=prodatCharacteristicValues('223',scope,una),parent=scope.findIndex(t=>['RFF','NAD'].includes(t.tag))
   const reason=cci.length===1&&reasons.length===1&&(parent<0||scope.indexOf(cci[0])<parent)?reasons[0]:null
   const known=reason?findProdatSubtypeRule(reason,code):null
   if(known?.transactionReasonCode===reason&&known.allowedMessageCodes.some(c=>c===code))continue
   const diagnostic=prodatFieldDiagnostic('223',cci.length===0?'missing':'invalid',
    {...input,code,una},scope.map(t=>t.raw),sourceRule)
   if(diagnostic.kind!=='field'||Object.values(diagnostic.occurrence.ownReferences??{}).some(ref=>ref.kind==='unavailable')){
    issues.push(held('Invalid field223 has no unambiguous own object/reference scope'))
   }else issues.push({severity:'error',blocking:true,code:'PRODAT_TRANSACTION_REASON_INVALID',
    title:'Transaktionstyp saknas eller är ogiltig',description:'Egen SG14/CCI Z13 kräver en fysisk transaktionskod tillåten för meddelandets BGM enligt P26.A bilaga4.',
    fieldPath:'CCI++Z13/CAV',prodatDiagnostic:diagnostic})
  }
 }
 return {code,issues,...projectProdatDiagnostics(issues)}
}
