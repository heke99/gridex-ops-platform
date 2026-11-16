import {prepareCustomerLifeEventCertificationDraftContext,prepareCustomerEventTestOriginal,isQualifiedCustomerEventTestOriginal,type SourceQualifiedCustomerEventTestOriginal} from '@/lib/ediel/production/lifeEventCertificationSource'
import {isQualifiedDeathStatusContext,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import type {EdielTgtDraftBuildResult} from './tgtEdifact.part-1'
import {revalidateEdielTgtCustomerLifeEventDraft} from './tgtEdifact.part-4'

/** A test original has its own protected run identity; no internal business
 * intent is minted for it. Classification grants no customer/transport effect. */
export async function prepareTgtCustomerLifeEventSource(input:{draft:EdielTgtDraftBuildResult;companyId:string;runId:string;stepNo:number;actorUserId:string}):Promise<DeathStatusValidationContext|undefined>{
 const m=input.draft.messageInput;if(m.messageFamily!=='PRODAT'||m.messageCode!=='Z09')return undefined
 if(m.companyId!==input.companyId||m.environment!=='test'||m.direction!=='outbound'||!m.rawPayload||!m.communicationRouteId)throw new Error('tgt_customer_event_source_scope_required')
 const context=await prepareCustomerLifeEventCertificationDraftContext({companyId:input.companyId,runId:input.runId,stepNo:input.stepNo,actorUserId:input.actorUserId,rawPayload:m.rawPayload,intentId:m.intentId??null,routeId:m.communicationRouteId})
 if(context===undefined)return undefined
 if(!isQualifiedDeathStatusContext(context))throw new Error(`tgt_customer_event_independent_classification_held:${context.missing.join(',')}`)
 revalidateEdielTgtCustomerLifeEventDraft(input.draft,context);return context
}

export async function prepareTgtCustomerEventOriginal(input:{companyId:string;runId:string;stepNo:number;actorUserId:string;family:string;code:string}):Promise<SourceQualifiedCustomerEventTestOriginal|undefined>{
 if(input.family!=='PRODAT'||input.code!=='Z09')return undefined
 const result=await prepareCustomerEventTestOriginal(input);if(result===undefined)return undefined
 if(!isQualifiedCustomerEventTestOriginal(result))throw Error(`tgt_customer_event_independent_classification_held:${result.missing.join(',')}`)
 return result
}
