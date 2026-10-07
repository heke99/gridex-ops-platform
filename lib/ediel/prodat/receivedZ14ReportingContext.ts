import {createHash} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {segmentComposite,segmentElementCount,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {gasWireMessages} from './prodatGasApplicability'
import {prodatRegisterGroups,type ProdatRegisterGroup} from './prodatRegisterGroups'
import {prodatFieldDiagnostic,prodatLocalDiagnostic,type DiagnosticInput} from './prodatFieldDiagnostic'
import {isProdatCalendarMinute} from './render/dates'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'

type Scope={lineIndex:number;objectId:string;identityAgency:string;lineItemReference:string;
 customer:{id:string;qualifier:string;agency:string};reason:'S17'|'S18'}
type Known={scope:Scope;classification:'private'|'nonprivate';
 term:{kind:'bounded';endMinute:string}|{kind:'indefinite'};
 purpose:{kind:'present';code:string}|{kind:'absent'}}
type Data={identity:string;payloadHash:string;actorUserId:string;readAtMs:number;redeemed:boolean;validated:boolean;objects:Known[];held:boolean}
/** Only this fresh protected READ creates a usable context. JSON/old contexts
 * cannot assert classification, request correspondence or received acceptance. */
export type ReceivedZ14ReportingContext={readonly kind:'received-z14-reporting-context'}
const contexts=new WeakMap<ReceivedZ14ReportingContext,Data>()
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex')
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const text=(v:unknown,empty=false):v is string=>typeof v==='string'&&(empty||v.length>0)
 &&v.length<=200&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v)
const nested=(m:EdielMessageRow)=>isEvidenceRecord(m.execution_context_snapshot)?m.execution_context_snapshot.receivedProdatContext:undefined
const identity=(m:EdielMessageRow)=>JSON.stringify([m.id,m.company_id,m.environment,
 m.direction,m.message_standard,m.message_family,m.message_code,
 (m as unknown as Record<string,unknown>).immutable_payload_hash,sha(m.raw_payload??''),m.message_received_at,nested(m)])
function scoped(group:ProdatRegisterGroup,una:ReturnType<typeof tokenizeEdifact>['una']):Scope|null{
 const own=group.segments,c=(tag:string,q:string)=>own.filter(t=>t.tag===tag&&segmentComposite(t,tag==='CCI'?2:1,una)[0]===q)
 const refs=c('RFF','LI'),customers=c('NAD','UD'),reasons=c('CCI','Z13')
 if(!group.itemId||!['9','89'].includes(group.identityAgency??'')||refs.length!==1||customers.length!==1||reasons.length!==1)return null
 const ref=segmentComposite(refs[0],1,una),customer=segmentComposite(customers[0],2,una)
 const cav=own[own.indexOf(reasons[0])+1],reason=cav?.tag==='CAV'?segmentComposite(cav,1,una):[]
 if(!text(ref[1])||!text(customer[0])||!text(customer[1]??'',true)||!text(customer[2])
  ||customer.length>3||ref.length>2||!['S17','S18'].includes(reason[0])||reason.slice(1).some(Boolean))return null
 return {lineIndex:group.lineIndex,objectId:group.itemId,identityAgency:group.identityAgency!,
  lineItemReference:ref[1],customer:{id:customer[0],qualifier:customer[1]??'',agency:customer[2]},reason:reason[0] as Scope['reason']}
}
function qualifiedObject(v:unknown,received:bigint):Known|null{
 if(!isEvidenceRecord(v)||!isEvidenceRecord(v.scope)||!isEvidenceRecord(v.scope.customer)
  ||!isEvidenceRecord(v.original)||!isEvidenceRecord(v.term)||!isEvidenceRecord(v.purpose))return null
 const s=v.scope,c=s.customer as Record<string,unknown>,o=v.original,t=v.term,p=v.purpose
 if(!Number.isSafeInteger(s.lineIndex)||Number(s.lineIndex)<0||!text(s.objectId)
  ||!['9','89'].includes(String(s.identityAgency))||!text(s.lineItemReference)
  ||!text(c.id)||!text(c.qualifier,true)||!text(c.agency)||!['S17','S18'].includes(String(s.reason))
  ||!['private','nonprivate'].includes(String(v.classification)))return null
 if(!['messageId','originIntentId','assignmentId','permissionId','acceptedAttemptId','evidenceId'].every(k=>isEvidenceUuid(o[k]))
  ||!hash(o.payloadHash)||!hash(o.evidenceSha256)||!Number.isSafeInteger(o.scopeBasisVersion)||Number(o.scopeBasisVersion)<1
  ||!text(o.evidenceVersion))return null
 const clocks=['originCreatedAt','sealedAt','acceptedObservedAt','evidenceReviewedAt','evidenceArchivedAt'].map(k=>parseSourceReceiptInstant(o[k]))
 if(clocks.some(clock=>clock===null||clock>received)||clocks[0]!>clocks[1]!||clocks[1]!>clocks[2]!
  ||clocks[4]!>clocks[3]!||clocks[3]!>clocks[0]!)return null
 if(t.kind!=='indefinite'&&(t.kind!=='bounded'||typeof t.endMinute!=='string'||!isProdatCalendarMinute(t.endMinute)))return null
 if(p.kind!=='absent'&&(p.kind!=='present'||!['B71','B72','B73','B74','B75','B76'].includes(String(p.code))))return null
 return {scope:{lineIndex:Number(s.lineIndex),objectId:s.objectId,identityAgency:String(s.identityAgency),
  lineItemReference:s.lineItemReference,customer:{id:c.id,qualifier:c.qualifier,agency:c.agency},reason:s.reason as Scope['reason']},
  classification:v.classification as Known['classification'],term:t.kind==='indefinite'?{kind:'indefinite'}:{kind:'bounded',endMinute:String(t.endMinute)},
  purpose:p.kind==='absent'?{kind:'absent'}:{kind:'present',code:String(p.code)}}
}
export async function loadReceivedZ14ReportingContext(message:EdielMessageRow,actorUserId:string):Promise<ReceivedZ14ReportingContext|undefined>{
 if(message.direction!=='inbound'||message.message_standard!=='edifact'||message.message_family!=='PRODAT'||message.message_code!=='Z14'||!message.raw_payload)return undefined
 const wire=tokenizeEdifact(message.raw_payload),messages=gasWireMessages(wire.segments,wire.una)
 if(messages.length!==1||messages[0].market!=='electricity'||messages[0].code!=='Z14')return undefined
 const {groups}=prodatRegisterGroups(wire.segments,wire.una,'Z14')
 if(!groups.some(g=>scoped(g,wire.una)))return undefined // N/unknown subtype never establishes positive reporting context.
 const context=Object.freeze({kind:'received-z14-reporting-context'} as const)
 const data:Data={identity:identity(message),payloadHash:sha(message.raw_payload),actorUserId,readAtMs:Date.now(),redeemed:false,validated:false,objects:[],held:true}
 contexts.set(context,data)
 try{
  const {data:b,error}=await supabaseService.rpc('gridex_ediel_received_z14_reporting_source_basis_v1',
   {p_source_message_id:message.id,p_actor_user_id:actorUserId}).abortSignal(AbortSignal.timeout(2000))
  data.readAtMs=Date.now()
  if(error) return context
  if(b===null)return undefined // Explicit non-service/unrelated origin; local U stays unqualified.
  const received=parseSourceReceiptInstant(message.message_received_at),born=nested(message)
  if(!isEvidenceRecord(b)||!isEvidenceRecord(born)||!isEvidenceUuid(actorUserId)||!isEvidenceUuid(message.company_id)
   ||received===null||b.companyId!==message.company_id||b.sourceMessageId!==message.id||b.environment!==message.environment
   ||b.sourcePayloadHash!==data.payloadHash||b.actorUserId!==actorUserId||!hash(b.sourceContextHash)
   ||!isDeepStrictEqual(b.sourceReceivedContext,born)||parseSourceReceiptInstant(b.sourceReceivedAt)!==received
   ||born.sourceMessageId!==message.id||born.companyId!==message.company_id||born.environment!==message.environment
   ||born.messageCode!=='Z14'||born.payloadHash!==data.payloadHash||born.version!==1||born.contextOrigin!=='database_insert'
   ||parseSourceReceiptInstant(born.sourceReceivedAt)!==received||parseSourceReceiptInstant(born.capturedAt)===null
   ||parseSourceReceiptInstant(born.capturedAt)!<received||parseSourceReceiptInstant(born.capturedAt)!>=(BigInt(Date.now())+BigInt(1))*BigInt(1000)
   ||!Number.isSafeInteger(b.evaluationUtcMs)||(BigInt(Number(b.evaluationUtcMs))+BigInt(1))*BigInt(1000)<=received
   ||Number(b.evaluationUtcMs)>Date.now()||!['qualified','held'].includes(String(b.status))
   ||!Array.isArray(b.objects)||b.objects.length>1000||!Array.isArray(b.heldObjects)||b.heldObjects.length>1000)return context
  const objects=b.objects.map((o:unknown)=>qualifiedObject(o,received))
  if(objects.some((o:Known|null)=>!o))return context
  const qualified=objects as Known[],keys=qualified.map(o=>JSON.stringify(o.scope))
  if(new Set(keys).size!==keys.length)return context
  data.objects=qualified;data.held=false
  // Explicit held/missing own scopes remain unmatched below. They cannot clear
  // independently qualified siblings or be promoted from supplied sender data.
  return context
 }catch{data.readAtMs=Date.now();return context}
}
export function receivedZ14ReportingContextForMessage(value:ReceivedZ14ReportingContext|undefined,message:EdielMessageRow,actorUserId?:string){
 const data=value&&contexts.get(value),now=Date.now()
 // Same bounded execution as the READ, one redemption, exact executing actor.
 // Historical business bounds are independent of this local capability life.
 if(!data||data.redeemed||data.actorUserId!==actorUserId||data.identity!==identity(message)
  ||now<data.readAtMs||now-data.readAtMs>2000)return undefined
 data.redeemed=true
 return value
}
/** Failure of THIS read's private-core redemption never falls back to a
 * positive local-U decision. Discard known facts; retain only a local hold. */
export function heldReceivedZ14ReportingContextForMessage(value:ReceivedZ14ReportingContext|undefined,message:EdielMessageRow,actorUserId?:string){
 const data=value&&contexts.get(value)
 if(!data||data.redeemed||data.actorUserId!==actorUserId||data.identity!==identity(message))return undefined
 data.objects=[];data.held=true;data.readAtMs=Date.now();data.redeemed=true
 return value
}
export function validateReceivedZ14ReportingContext(input:DiagnosticInput&{
 rawPayload?:string|null;context?:ReceivedZ14ReportingContext}):EdielRulebookIssue[]{
 const data=input.context&&contexts.get(input.context)
 if(!data||!data.redeemed||input.code!=='Z14')return []
 const wire=tokenizeEdifact(input.rawPayload??''),{groups}=prodatRegisterGroups(wire.segments,wire.una,'Z14')
 const issues:EdielRulebookIssue[]=[],rule='PRODAT26A:P17/21/43/49/74/119/123'
 const hold=(reason:string)=>issues.push({severity:'error',blocking:true,code:'PRODAT_RECEIVED_REPORTING_SOURCE_UNQUALIFIED',
  title:'Rapporteringens mottagarkälla saknas',description:reason,prodatDiagnostic:prodatLocalDiagnostic('local_unknown',rule,reason)})
 if(data.validated||Date.now()<data.readAtMs||Date.now()-data.readAtMs>2000){hold('Protected reporting context is not this exact field invocation');return issues}
 data.validated=true
 if(data.held||data.payloadHash!==sha(input.rawPayload??'')){hold('Fresh protected source READ could not qualify the exact received original');return issues}
 for(const group of groups){
  const scope=scoped(group,wire.una)
  // N has no positive reporting-field obligation; other national content is
  // controlled by existing subtype/grammar owners.
  if(!scope)continue
  const known=data.objects.filter(o=>isDeepStrictEqual(o.scope,scope))
  if(known.length!==1){hold('Independent original reporting facts unavailable for this own response scope');continue}
  const source=known[0],own=group.segments
  const field=(number:string,kind:'missing'|'invalid',reason:string)=>issues.push({severity:'error',blocking:true,
   code:`PRODAT_RECEIVED_REPORTING_${number}_${kind.toUpperCase()}`,title:'Rapporteringens kända eget krav är inte uppfyllt',
   description:reason,prodatDiagnostic:prodatFieldDiagnostic(number,kind,{...input,una:wire.una,rawSegments:wire.segments.map(t=>t.raw)},
    own.map(t=>t.raw),rule,group.lineIndex,'object')})
  const purposes=own.filter(t=>t.tag==='CCI'&&segmentComposite(t,2,wire.una)[0]==='Z24')
  const cav=purposes.length===1?own[own.indexOf(purposes[0])+1]:undefined
  const purpose=cav?.tag==='CAV'?segmentComposite(cav,1,wire.una):[]
  if(!purposes.length&&(source.classification==='private'||source.purpose.kind==='present'))field('323','missing','Known private/original purpose requires own reporting purpose')
  else if(purposes.length&&(purposes.length!==1||!purpose[0]||purpose[1]||purpose[2]||purpose.length>5||segmentElementCount(cav!,wire.una)!==1
   ||source.purpose.kind!=='present'||purpose[0]!==source.purpose.code))field('323','invalid','Own purpose differs from the actual immutable SENT original')
  const ends=own.filter(t=>t.tag==='DTM'&&segmentComposite(t,1,wire.una)[0]==='91')
  if(!ends.length&&source.term.kind==='bounded')field('321','missing','Independently declared bounded reporting requires own end')
  else if(ends.length){
   const p=ends.length===1?segmentComposite(ends[0],1,wire.una):[]
   if(ends.length!==1||p.length!==3||p[2]!=='203'||!isProdatCalendarMinute(p[1])||segmentElementCount(ends[0],wire.una)!==1
    ||source.term.kind==='bounded'&&p[1]>source.term.endMinute)field('321','invalid','Own Gregorian minute is malformed or exceeds independent reporting bound')
  }
 }
 return issues
}
