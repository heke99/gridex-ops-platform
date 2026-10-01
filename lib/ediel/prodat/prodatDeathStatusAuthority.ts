import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna} from '@/lib/ediel/core/una'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {copyDeathSelection,type DeathSelection} from './prodatDeathStatus'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
type Row={id?:string|null;direction?:string|null;company_id?:string|null;environment?:string|null;intent_id?:string|null;communication_route_id?:string|null;message_code?:string|null;message_family?:string|null;raw_payload?:string|null;parsed_payload?:unknown}
export type CustomerEventCertificationQualification=Readonly<{sourceKind:'independently_classified_fixture';declarationId:string;fixtureRegistrationId:string;runId:string;expectedOutcome:'positive'|'negative';expectedDiagnosticCodes:readonly string[];authorizesBusinessEffect:false}>
type LifeEventContextBasis={kind:'customer_life_event';companyId:string;environment:'test'|'production';rawPayload:string;sourceEventId:string;sourceRevision:string;sourceDigest:string;businessContext:'death'|'bankruptcy'|'other_masterdata';bilateralCapabilityVerified:boolean;selection:DeathSelection}
export type DeathStatusValidationContext=Readonly<LifeEventContextBasis&(
 {direction:'outbound';code:'Z09';certification?:never;intentId:string;routeId:string}|{direction:'outbound';code:'Z09';certification:CustomerEventCertificationQualification;intentId:string|null;routeId:string}|{direction:'inbound';code:'Z06';certification?:never;sourceMessageId:string;sourceContextReceiptId:string;sourceContextFactsHash:string})>
const qualified=new WeakSet<object>()
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.freeze(v);for(const child of Object.values(v))freeze(child)}return v}
/** Trusted server source resolver only. Pure selection/serialized metadata is
 * deliberately not an authority context and cannot survive a copy/reload. */
export function bindDeathStatusSourceContext(input:DeathStatusValidationContext):DeathStatusValidationContext{
 const cert=input.certification,uuid=(v:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
 const sourceOnly=Boolean(cert&&cert.sourceKind==='independently_classified_fixture'&&cert.authorizesBusinessEffect===false&&[cert.declarationId,cert.fixtureRegistrationId,cert.runId].every(uuid)&&input.direction==='outbound'&&input.environment==='test'&&input.code==='Z09'&&Array.isArray(cert.expectedDiagnosticCodes)&&cert.expectedDiagnosticCodes.every(v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v))&&(cert.expectedOutcome==='positive'?cert.expectedDiagnosticCodes.length===0:cert.expectedOutcome==='negative'&&cert.expectedDiagnosticCodes.length>0&&cert.expectedDiagnosticCodes.length<=256))
 if(cert&&!sourceOnly)throw new Error('customer_life_event_certification_context_invalid')
 if(input.kind!=='customer_life_event'||!input.companyId||!input.sourceEventId||!input.sourceRevision||!/^([a-f0-9]{64})$/.test(input.sourceDigest)||!input.rawPayload||!['test','production'].includes(input.environment)||!['death','bankruptcy','other_masterdata'].includes(input.businessContext)||input.businessContext!=='death'&&!input.bilateralCapabilityVerified&&!sourceOnly
  ||input.direction==='outbound'&&(input.code!=='Z09'||(!sourceOnly&&!input.intentId)||(sourceOnly&&input.intentId!==null&&(typeof input.intentId!=='string'||!input.intentId))||!input.routeId)||input.direction==='inbound'&&(input.code!=='Z06'||!input.sourceMessageId||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(input.sourceContextReceiptId)||!/^[a-f0-9]{64}$/.test(input.sourceContextFactsHash))||!['inbound','outbound'].includes(input.direction))throw new Error('customer_life_event_source_context_invalid')
 const result=freeze({...input,selection:copyDeathSelection(input.selection)})
 qualified.add(result);return result
}
export function isQualifiedDeathStatusContext(value:unknown):value is DeathStatusValidationContext{return Boolean(value&&typeof value==='object'&&qualified.has(value))}
export function assertDeathStatusContextMatches(row:Row,context:DeathStatusValidationContext){
 if(!isQualifiedDeathStatusContext(context)||row.raw_payload!==context.rawPayload||row.message_code!==context.code||row.company_id!==context.companyId||row.environment!==context.environment||row.direction!==context.direction
  ||context.direction==='outbound'&&(row.intent_id!==context.intentId||row.communication_route_id!==context.routeId)||context.direction==='inbound'&&row.id!==context.sourceMessageId)throw new Error('customer_life_event_source_context_mismatch')
}
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Separate producer policy: eligible persisted sources are not qualified.
 * Never use this guard for inbound or pure protocol validation. */
export function deathStatusSendIssue(row:Row,context?:DeathStatusValidationContext):EdielRulebookIssue|null{
 if(context){
  if(context.direction!=='outbound')return {scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED',title:'Fel riktning för kundstatuskälla',description:'Mottagen source authority får inte auktorisera en utgående producent.',fieldPath:'CCI++Z17/CAV'}
  try{assertDeathStatusContextMatches(row,context)}catch{return {scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED',title:'Kundstatus saknar kvalificerad utgående producent',description:'Aktuell fristående livshändelsekälla matchar inte egna frysta meddelandebytes och scope.',fieldPath:'CCI++Z17/CAV'}}
  const own=tokenizeEdifact(row.raw_payload??'')
  const issues=validateProdatDeathStatus({code:context.code,rawSegments:own.segments.map(s=>s.raw),una:own.una,direction:'outbound',facts:{deathStatus:context.selection}}).filter(i=>i.blocking||i.severity==='error')
  // The ordinary national validator still reports this field finding. Only
  // its exact genuine negative fixture may cross this source-only send guard;
  // the canonical fixture owner separately requires the whole diagnostic set.
  return issues.find(i=>!(context.certification?.expectedOutcome==='negative'&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='310'&&context.certification.expectedDiagnosticCodes.includes(i.code)))??null
 }
 const raw=(row.raw_payload??'').trimStart(),advice=parseUna(raw),literal=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 const r=literal(advice.releaseCharacter),t=literal(advice.segmentTerminator),e=literal(advice.dataElementSeparator)
 const header=new RegExp(`(?:^|(?<!${r})(?:${r}${r})*${t})\\s*(?:UNB|UNH|BGM)${e}`,'i')
 const data=record(row.parsed_payload),policy=record(data.canonicalPolicy),code=String(row.message_code??'').toUpperCase()
 const reason=String(data.reasonForTransaction??data.transactionSubtype??policy.subtype??'').toUpperCase()
 const selected=code==='Z05'&&['LK','Z23','Z05LK'].includes(reason)||['Z06','Z09'].includes(code)&&['E','E34',`${code}E`].includes(reason)
 const hold=():EdielRulebookIssue=>({scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED',title:'Kundstatus saknar kvalificerad utgående producent',description:'Den valda Z05LK/Z06E-bedömningen eller Z09E-producenten saknar kvalificerad beständig källa. Detta är en sändgräns, inte ett inkommande protokollfel.',fieldPath:'CCI++Z17/CAV'})
 if(selected)return hold()
 if(!raw.toUpperCase().startsWith('UNA')&&!header.test(raw))return null
 const wire=tokenizeEdifact(raw);let family=String(row.message_family??'PRODAT').toUpperCase(),ownCode=code,inCommon=false
 for(const token of wire.segments){
  if(token.tag==='UNH'){family=segmentComposite(token,2,wire.una)[0]??'';ownCode='';inCommon=false}
  if(token.tag==='BGM')ownCode=segmentComposite(token,1,wire.una)[0]??''
  if(token.tag==='LIN')inCommon=true
  if(['RFF','NAD','UNT','UNZ'].includes(token.tag))inCommon=false
  if(family==='PRODAT'&&inCommon&&token.tag==='CCI'&&segmentComposite(token,2,wire.una)[0]==='Z13'){
   const next=wire.segments[token.index+1],value=next?.tag==='CAV'?segmentComposite(next,1,wire.una)[0]:null
   if(ownCode==='Z05'&&value==='Z23'||['Z06','Z09'].includes(ownCode)&&value==='E34')return hold()
  }
 }
 // Invalid own scope and forbidden310 remain protected, without holding all F/G/D.
 return validateProdatDeathStatus({code,rawSegments:wire.segments.map(s=>s.raw),una:wire.una}).find(i=>i.blocking||i.severity==='error')??null
}
export function assertDeathStatusSendBoundary(row:Row,context?:DeathStatusValidationContext){const issue=deathStatusSendIssue(row,context);if(issue)throw new Error(`${issue.code}: ${issue.description}`)}
