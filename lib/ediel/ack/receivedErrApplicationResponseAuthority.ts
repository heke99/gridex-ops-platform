import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {readSourceBoundOutboundAckRulePackEvidence,type SourceQualifiedOutboundAck,type SourceBoundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'

declare const receivedErrResponseBrand:unique symbol
export type ReceivedErrApplicationResponseAuthority=Readonly<{
 sourceMessage:EdielMessageRow;evidence:SourceBoundAckRulePackEvidence;ackSourceQualification:SourceQualifiedOutboundAck
 transactions:readonly Readonly<{transactionIndex:number;transactionId:string}>[]
 canonicalAssessmentId:string;correlatedOriginalMessageId:string;sourceHash:string;authorizesBusinessEffect:false
 [receivedErrResponseBrand]:true
}>
const capabilities=new WeakSet<object>()
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}
const failure=()=>new Error('utilts_err_application_response_authority_unavailable')

/** Read only after the actual accepted correlation/application transaction.
 * Prospective capture belongs to that native owner; this read never creates
 * history, accepts a caller's status or chooses another/current guide. */
export async function readReceivedErrApplicationResponseAuthority(input:{message:EdielMessageRow;actorUserId:string}):Promise<ReceivedErrApplicationResponseAuthority>{
 const m=input.message
 if(!uuid(m.id)||!uuid(m.company_id)||!uuid(input.actorUserId)||m.direction!=='inbound'||m.message_family!=='UTILTS_ERR'||m.message_standard!=='edifact'||!['test','production'].includes(m.environment)||!m.raw_payload)throw failure()
 await assertEdielTenantActor({companyId:m.company_id,actorUserId:input.actorUserId,permissionAnyOf:['communication.write']})
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_received_err_application_response_authority_v1',{p_company_id:m.company_id,p_environment:m.environment,p_source_message_id:m.id,p_actor_user_id:input.actorUserId})
 if(error)throw new Error('utilts_err_application_response_authority_unavailable',{cause:error})
 const result=record(data),source=record(result?.sourceMessage)
 if(result?.version!==1||!source||source.id!==m.id||source.company_id!==m.company_id||source.environment!==m.environment||source.direction!=='inbound'||source.message_family!=='UTILTS_ERR'||source.message_standard!=='edifact'||source.raw_payload!==m.raw_payload
  ||result.authorizesBusinessEffect!==false||!uuid(result.canonicalAssessmentId)||!uuid(result.correlatedOriginalMessageId)||result.sourceHash!==createHash('sha256').update(m.raw_payload,'utf8').digest('hex')||!Array.isArray(result.transactions))throw failure()
 const wire=tokenizeEdifact(m.raw_payload),unh=wire.segments.filter(t=>t.tag==='UNH'),bgm=wire.segments.filter(t=>t.tag==='BGM')
 const ids=wire.segments.filter(t=>t.tag==='IDE').map(t=>segmentComposite(t,2,wire.una)[0])
 if(unh.length!==1||segmentComposite(unh[0],2,wire.una)[0]!=='UTILTS'||bgm.length!==1||segmentComposite(bgm[0],1,wire.una)[0]!=='ERR'||!ids.length||ids.some(id=>!id)||new Set(ids).size!==ids.length
  ||result.transactions.length!==ids.length||result.transactions.some((value,index)=>{const tx=record(value);return tx?.transactionIndex!==index||tx.transactionId!==ids[index]}))throw failure()
 const qualification=await readSourceBoundOutboundAckRulePackEvidence({companyId:m.company_id,environment:m.environment,sourceMessageId:m.id})
 if(qualification.sourceMessage.raw_payload!==m.raw_payload||JSON.stringify(qualification.evidence)!==JSON.stringify(result.sourceRulePackEvidence))throw failure()
 const capability=freeze({sourceMessage:qualification.sourceMessage,evidence:qualification.evidence,ackSourceQualification:qualification,
  transactions:structuredClone(result.transactions),canonicalAssessmentId:result.canonicalAssessmentId,correlatedOriginalMessageId:result.correlatedOriginalMessageId,
  sourceHash:result.sourceHash,authorizesBusinessEffect:false}) as ReceivedErrApplicationResponseAuthority
 capabilities.add(capability);return capability
}

/** Only the exact protected server-read token supplies the own ERR transaction
 * scope. It permits a prescribed application reply, never a business effect. */
export function receivedErrApplicationResponseQualification(input:{authority?:ReceivedErrApplicationResponseAuthority|null;message:EdielMessageRow}):ReceivedErrApplicationResponseAuthority|null{
 const a=input.authority,m=input.message
 return a&&capabilities.has(a)&&m.id===a.sourceMessage.id&&m.company_id===a.sourceMessage.company_id&&m.environment===a.sourceMessage.environment&&m.direction==='inbound'&&m.message_family==='UTILTS_ERR'&&m.raw_payload===a.sourceMessage.raw_payload?a:null
}
