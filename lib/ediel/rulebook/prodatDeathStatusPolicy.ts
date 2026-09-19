import {copyDeathSelection,deathCondition,type DeathEventObject} from '@/lib/ediel/prodat/prodatDeathStatus'
import {segmentComposite,segmentElementCount,type EdifactTokenizedSegment as Token} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna,type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterTokens} from '@/lib/ediel/prodat/prodatRegisterFields'
import {prodatCharacteristicValues} from '@/lib/ediel/prodat/prodatCharacteristicFields'
import {findProdatSubtypeRule} from './prodatSubtypeRegistry'
import type {ProdatDependentConditionFacts,ProdatDependentConditionStatus} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type {EdielRulebookIssue} from './rulebook'
export type DeathPolicyInput={code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;facts?:ProdatDependentConditionFacts|null;direction?:'inbound'|'outbound'}
export type DeathIssue=EdielRulebookIssue&{meteringPointId?:string|null;lineItemReference?:string|null}
/** Split actual messages before selecting own first-register common information. */
function messages(tokens:Token[]):Token[][]{const out:Token[][]=[];let current:Token[]=[];for(const t of tokens){if(t.tag==='UNH'&&current.length){out.push(current);current=[]}current.push(t);if(t.tag==='UNT'){out.push(current);current=[]}}if(current.length)out.push(current);return out}
export function evaluateProdatDeathStatus(input:DeathPolicyInput){
 const una=input.una??parseUna(null),tokens=prodatRegisterTokens(input.rawSegments,una),outbound=input.direction!=='inbound'
 const issues:DeathIssue[]=[],statuses=new Map<string,ProdatDependentConditionStatus>();let objects:DeathEventObject[]=[]
 const fail=(suffix:string,detail:string,occurrence?:{meteringPointId:string|null;lineItemReference:string|null},blocking=outbound)=>issues.push({...occurrence,scope:'prodat_dependent',severity:blocking?'error':'warning',blocking,code:`PRODAT_DEATH_STATUS_${suffix}`,title:'PRODAT kundstatus',description:`Fält310, P26.A s.71/112/119/122: ${detail}`,fieldPath:'CCI++Z17/CAV'})
 try{if(input.facts?.deathStatus!=null)objects=copyDeathSelection(input.facts.deathStatus).objects}catch{fail('EVIDENCE_INVALID','ogiltig lokal bedömning')}
 let aggregate:boolean|null=false,seenObject=false
 for(const message of messages(tokens)){
  if(!message.some(t=>['UNH','BGM','LIN'].includes(t.tag)))continue
  const unh=message.find(t=>t.tag==='UNH');if(unh&&segmentComposite(unh,2,una)[0]!=='PRODAT')continue
  const bgms=message.filter(t=>t.tag==='BGM'),code=bgms.length===1?segmentComposite(bgms[0],1,una)[0]:input.code
  if(!['Z05','Z06','Z09'].includes(code))continue
  const grouped=prodatRegisterGroups(message,una,code),first=grouped.groups.filter(g=>g.registerPosition===1||!g.validRegisterChain)
  if(outbound&&message.some(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z17'&&!first.some(g=>g.segments.includes(t))))fail('OCCURRENCE_INVALID','kundstatus ligger utanför eget första register',undefined,true)
  const header=message.slice(0,message.findIndex(t=>t.tag==='LIN'))
  const one=(scope:Token[],tag:string,q:string,position=1)=>{const s=scope.filter(t=>t.tag===tag&&segmentComposite(t,position,una)[0]===q);return s.length===1?segmentComposite(s[0],tag==='NAD'?2:position,una):[]}
  const same=(a:string[],b:string[])=>JSON.stringify(a)===JSON.stringify(b)
  if(!first.length){aggregate=null;if(outbound)fail('SCOPE_INVALID','eget LIN-objekt saknas');continue}
  for(const group of first){
   seenObject=true;const boundary=group.segments.findIndex(t=>['RFF','NAD'].includes(t.tag)),common=boundary<0?group.segments:group.segments.slice(0,boundary)
   const reasons=prodatCharacteristicValues('223',common,una),ccis=common.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z13')
   const reason=reasons.length===1&&ccis.length===1?reasons[0]:null,rule=reason?findProdatSubtypeRule(reason,code):null
   const subtype=rule?.transactionReasonCode===reason?rule?.subtype:null
   const nad=group.segments.findIndex(t=>t.tag==='NAD'),refs=nad<0?group.segments:group.segments.slice(0,nad),li=one(refs,'RFF','LI')[1]??null
   const occurrence={meteringPointId:group.itemId,lineItemReference:li}
   const scope=bgms.length<=1&&Boolean(group.itemId)&&['9','89'].includes(group.identityAgency??'')&&group.validRegisterChain&&Boolean(subtype)
   let fact=objects.find(o=>o.installation.id===group.itemId&&o.installation.agency===group.identityAgency)
   if(fact){const actor=(role:string,p:DeathEventObject['legalSupplier'])=>same(one(header,'NAD',role),[p.id,p.qualifier,p.agency])
    const customer=fact.customer
    if(fact.process.code!==code||fact.process.reason!==reason||li!==fact.lineItemReference||!same(one(group.segments,'NAD','UD'),[customer.id,customer.qualifier,customer.agency])||!actor('FR',fact.legalGridOwner)||!actor('DO',fact.legalSupplier)){
     fail('CONTEXT_MISMATCH','bedömningen tillhör inte eget objekt/kund/aktörer/LI/process',occurrence);fact=undefined
    }
   }
   const condition=scope?deathCondition(code,subtype,fact?.assessment):null
   aggregate=aggregate===null||condition===null?null:aggregate||condition
   if(!outbound&&condition===false)continue // p119 whole-field precedence, including qualifiers.
   if(!scope){fail('SCOPE_INVALID','egen funktion/orsak/objekt kan inte avgöras',occurrence);continue}
   if(outbound&&condition===null){fail('UNDETERMINED','oberoende dödsfallsbedömning saknas',occurrence);continue}
   const selected=group.segments.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,una)[0]==='Z17')
   if(outbound&&condition===false){if(selected.length)fail('FORBIDDEN','fältet får inte skickas för eget villkor',occurrence,true);continue}
   if(!selected.length){if(condition===true)fail('REQUIRED','Z41 saknas',occurrence,true);continue}
   if(selected.length!==1){fail('OCCURRENCE_INVALID','flera kundstatusförekomster',occurrence,true);continue}
   const cci=selected[0],index=group.segments.indexOf(cci),cav=group.segments[index+1],inCommon=common.includes(cci)
   if(!inCommon||cav?.tag!=='CAV'||group.segments[index+2]?.tag==='CAV'){fail('OCCURRENCE_INVALID','statusparet måste vara angränsande i eget SG14',occurrence,true);continue}
   const value=segmentComposite(cav,1,una)
   if(!value[0]){if(condition===true)fail('REQUIRED','Z41 saknas',occurrence,true)}else if(value[0]!=='Z41')fail('VALUE_INVALID','endast Z41 är giltigt',occurrence,true)
   // Adopted p119 qualifier interpretation; U supplied-content does not prove death.
   if(value[1]||value[2])fail('QUALIFIER_INVALID','1131/3055 ska vara tomma',occurrence,true)
   if(outbound&&(segmentComposite(cci,1,una).some(Boolean)||segmentComposite(cci,2,una).slice(1).some(Boolean)||value.slice(3).some(Boolean)||segmentElementCount(cci,una)>2||segmentElementCount(cav,una)>1))fail('UNUSED_COMPONENT','oanvända komponenter får inte skickas',occurrence,true)
  }
 }
 if(seenObject||['Z05','Z06','Z09'].includes(input.code))statuses.set('310',!seenObject||aggregate===null?'undetermined':aggregate?'required':'not_required')
 return {issues,statuses}
}
export function validateProdatDeathStatus(input:DeathPolicyInput){return evaluateProdatDeathStatus(input).issues}
/** Shared source mapping, retaining exact occurrence attribution. */
export function deathStatusAperakErrors(input:DeathPolicyInput){
 return validateProdatDeathStatus({...input,direction:'inbound'}).filter(i=>i.blocking||i.severity==='error').map(i=>({ercCode:i.code==='PRODAT_DEATH_STATUS_REQUIRED'?'41':'42',fieldCode:'310',text:i.description,referenceQualifier:i.meteringPointId?'Z07':null,referenceNumber:i.meteringPointId??null,lineItemReference:i.lineItemReference??null}))
}
