import {createEdielMessageEvent,getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {applyInboundProdatZ02ToCustomerInfoRequest} from '@/lib/onboarding/inboundEdielLinking'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'

export type InboundFacilityRecognitionResult={
 status:'completed'|'manual_review'|'skipped';reason:string;requestId:string|null
 customerId:string|null;customerSiteId:string|null;facilityId:string|null;meteringPointId:string|null
}
const result=(status:InboundFacilityRecognitionResult['status'],reason:string,requestId:string|null=null):InboundFacilityRecognitionResult=>({
 status,reason,requestId,customerId:null,customerSiteId:null,facilityId:null,meteringPointId:null,
})

/** Operational recognition delegates to the same protected Z02 job/atomic
 * source owner as reception. Parsed metadata and the first point found in
 * another message cannot complete a lookup or start a supplier switch. */
export async function recognizeInboundFacilityData(input:{actorUserId:string;edielMessageId:string}):Promise<InboundFacilityRecognitionResult>{
 const message=await getEdielMessageById(input.edielMessageId)
 if(!message)return result('skipped','message_not_found')
 if(message.direction!=='inbound'||!message.company_id)return result('skipped','not_inbound_or_company_missing')
 await assertEdielTenantActor({companyId:message.company_id,actorUserId:input.actorUserId,permission:'communication.write'})
 const wire=tokenizeEdifact(message.raw_payload),headers=wire.segments.filter(token=>token.tag==='UNH'),bgms=wire.segments.filter(token=>token.tag==='BGM')
 const actualZ02=message.message_standard==='edifact'&&message.message_family==='PRODAT'&&message.message_code==='Z02'
  &&headers.length===1&&segmentComposite(headers[0],2,wire.una)[0]==='PRODAT'
  &&bgms.length===1&&segmentComposite(bgms[0],1,wire.una)[0]==='Z02'
 if(!actualZ02){
  await createEdielMessageEvent({actorUserId:input.actorUserId,edielMessageId:message.id,eventType:'manual_note',eventStatus:'warning',
   message:'Anläggningsuppgifter inväntar ett källbundet Z02-svar till rätt uppgiftsbegäran.',
   payload:{recognition:'source_qualified_z02_required'}})
  return result('manual_review','source_qualified_z02_required')
 }
 const applied=await applyInboundProdatZ02ToCustomerInfoRequest({actorUserId:input.actorUserId,message})
 return result(applied.applied?'completed':'manual_review',applied.applied?'source_qualified_z02_applied':applied.reason??'source_qualified_z02_held',applied.targetId)
}
