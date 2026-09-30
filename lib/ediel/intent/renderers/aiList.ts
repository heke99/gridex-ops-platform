import {buildAiListOutboundDraft} from '@/lib/ediel/aiList'
import {loadAiListOriginBasis} from '@/lib/ediel/aiListOrigination'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
export async function buildAiListIntentDraft(input:{intent:EdielMessageIntent;actorUserId:string;routeContext:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>}){
 const {intent,routeContext:route}=input
 if(intent.messageFamily!=='AI_LIST'||intent.messageCode!=='AI'||intent.senderEdielId!==route.senderEdielId||intent.receiverEdielId!==route.receiverEdielId||intent.communicationRouteId!==route.route.id||!intent.customerId||!intent.customerSiteId)throw new Error('ai_list_intent_route_customer_scope_mismatch')
 // Every new rendering opens its OWN current, bounded immutable source snapshot.
 // Intent payload is only a request; no serialized historical rows are trusted.
 const basis=await loadAiListOriginBasis({companyId:intent.companyId,actorUserId:input.actorUserId,environment:intent.environment,customerId:intent.customerId,siteId:intent.customerSiteId,meteringPointId:intent.meteringPointId,fromDate:String(intent.payload.fromDate),toDate:String(intent.payload.toDate)},route)
 if(intent.payload.expectedBalanceResponsibleEdielId&&basis.history.details.some(row=>row.balansansvarsId!==intent.payload.expectedBalanceResponsibleEdielId))throw new Error('ai_list_balance_responsible_source_mismatch')
 const draft=await buildAiListOutboundDraft({actorUserId:input.actorUserId,companyId:intent.companyId,listType:'AI',senderEdielId:route.senderEdielId,senderName:route.senderName,receiverEdielId:route.receiverEdielId,receiverName:route.receiverName,receiverEmail:route.receiverEmail,communicationRouteId:route.route.id,customerId:intent.customerId,siteId:intent.customerSiteId,meteringPointId:intent.meteringPointId,gridOwnerId:basis.site.grid_owner_id,fromDate:basis.request.fromDate,toDate:basis.request.toDate,details:basis.history.details,environment:intent.environment,mailbox:route.mailbox,routeDefaultMessageVersion:route.defaultMessageVersion})
 draft.intentId=intent.id;draft.sourceOperationId=intent.operationId;draft.routeProfileId=intent.routeProfileId
 draft.applicationReference=null;draft.interchangeReference=null;draft.externalReference=null;draft.correlationReference=null;draft.transactionReference=null
 draft.parsedPayload={...draft.parsedPayload,historyEvidence:basis.history.evidence}
 return {draft,basis}
}
