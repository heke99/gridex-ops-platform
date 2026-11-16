import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type ProdatPhysicalOutcomeReceipt=Readonly<{
 companyId:string;environment:'test'|'production';ackMessageId:string;sourceMessageId:string;
 ackPayloadHash:string;sourcePayloadHash:string;sourceProjectionVersion:Readonly<Record<string,string>>;
 physicalOutcomes:ReadonlyArray<Readonly<{storageScopeKey:string;outcome:'positive'|'negative';firstLineIndex:number;objectId:string|null;identityAgency:string|null;lineItemReference:string|null}>>
}>
/** Actual protected incoming ACK receipt. Physical LIN scope never becomes a
 * surrogate protocol LI. No parsed caller flag grants correction authority. */
export async function readInboundProdatPhysicalOutcomes(input:{actorUserId:string;ackMessage:EdielMessageRow;sourceMessage:EdielMessageRow}):Promise<ProdatPhysicalOutcomeReceipt|null>{
 const {ackMessage:a,sourceMessage:s}=input
 if(![input.actorUserId,a.id,s.id,a.company_id].every(isEvidenceUuid)||a.company_id!==s.company_id||a.environment!==s.environment||!['test','production'].includes(a.environment)
  ||a.direction!=='inbound'||a.message_family!=='APERAK'||s.direction!=='outbound'||s.message_family!=='PRODAT'||!a.raw_payload||!s.raw_payload)throw Error('ack_prodat_physical_read_scope_required')
 const {data,error}=await supabaseService.rpc('ediel_read_inbound_prodat_physical_outcomes_v1' as never,{p_company_id:a.company_id,p_environment:a.environment,p_ack_message_id:a.id,p_source_message_id:s.id,p_actor_user_id:input.actorUserId} as never)
 if(error)throw error
 if(data===null)return null
 const r:unknown=data
 if(!isEvidenceRecord(r)||r.version!==1||r.companyId!==a.company_id||r.environment!==a.environment||r.ackMessageId!==a.id||r.sourceMessageId!==s.id
  ||r.ackPayloadHash!==evidenceHash(a.raw_payload)||r.sourcePayloadHash!==evidenceHash(s.raw_payload)||!Array.isArray(r.physicalOutcomes)||!r.physicalOutcomes.length||!isEvidenceRecord(r.sourceProjectionVersion)||Object.keys(r.sourceProjectionVersion).length!==4||!Object.entries(r.sourceProjectionVersion).every(([key,value])=>/^lib\/ediel\/(prodat|rulebook)\/prodat(RegisterGroups|RegisterFields|26AFieldMatrix|RegisterPolicy)\.ts$/.test(key)&&typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))throw Error('ack_prodat_physical_receipt_invalid')
 const outcomes=r.physicalOutcomes.map((x:unknown)=>{
  if(!isEvidenceRecord(x)||typeof x.reference!=='string'||!x.reference||!['positive','negative'].includes(String(x.outcome))||!isEvidenceRecord(x.physicalReference))throw Error('ack_prodat_physical_receipt_invalid')
  const p=x.physicalReference
  if(!Number.isSafeInteger(p.firstLineIndex)||Number(p.firstLineIndex)<0||![p.objectId,p.identityAgency,p.lineItemReference].every(v=>v===null||typeof v==='string'&&v.length>0)
   ||p.lineItemReference===null&&x.outcome!=='negative')throw Error('ack_prodat_physical_receipt_invalid')
  return Object.freeze({storageScopeKey:x.reference,outcome:x.outcome as 'positive'|'negative',firstLineIndex:p.firstLineIndex as number,objectId:p.objectId as string|null,identityAgency:p.identityAgency as string|null,lineItemReference:p.lineItemReference as string|null})
 })
 if(new Set(outcomes.map(x=>x.firstLineIndex)).size!==outcomes.length)throw Error('ack_prodat_physical_receipt_invalid')
 return Object.freeze({companyId:r.companyId as string,environment:r.environment as 'test'|'production',ackMessageId:r.ackMessageId as string,sourceMessageId:r.sourceMessageId as string,ackPayloadHash:r.ackPayloadHash as string,sourcePayloadHash:r.sourcePayloadHash as string,sourceProjectionVersion:Object.freeze({...r.sourceProjectionVersion as Record<string,string>}),physicalOutcomes:Object.freeze(outcomes)})
}
