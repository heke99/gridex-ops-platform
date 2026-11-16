import type {CreateEdielMessageInput} from '@/lib/ediel/types'
import {bindCustomerMasterdataValidationContext,isQualifiedCustomerMasterdataProjection,type CustomerMasterdataValidationContext,type SourceQualifiedCustomerMasterdataProjection} from '@/lib/ediel/production/customerMasterdataSource'

type DraftSource=Readonly<{projection:SourceQualifiedCustomerMasterdataProjection;companyId:string;customerId:string;environment:'test'|'production';rawPayload:string}>
const draftSources=new WeakMap<CreateEdielMessageInput,DraftSource>()

/** Only the exact producer result carries its protected read. A JSON preview or
 * copy does not grant authority; native original/current-source checks remain
 * mandatory after the actual intent and route have been established. */
export function rememberCustomerMasterdataDraft(draft:CreateEdielMessageInput,projection:SourceQualifiedCustomerMasterdataProjection|null|undefined):CreateEdielMessageInput{
 if(!projection)return draft
 if(!isQualifiedCustomerMasterdataProjection(projection)||draft.direction!=='outbound'||draft.messageFamily!=='PRODAT'||draft.companyId!==projection.companyId||draft.customerId!==projection.customerId||!draft.rawPayload||(draft.environment!=='test'&&draft.environment!=='production')||projection.environment!==null&&projection.environment!==draft.environment)throw Error('customer_masterdata_draft_source_unqualified')
 draftSources.set(draft,Object.freeze({projection,companyId:draft.companyId,customerId:draft.customerId,environment:draft.environment,rawPayload:draft.rawPayload}));return draft
}

export function bindCustomerMasterdataDraftContext(input:{draft:CreateEdielMessageInput;companyId:string;environment:'test'|'production';routeId:string}):CustomerMasterdataValidationContext|undefined{
 const source=draftSources.get(input.draft)
 if(!source)return undefined
 const draft=input.draft
 if(input.companyId!==source.companyId||input.environment!==source.environment||draft.companyId!==source.companyId||draft.customerId!==source.customerId||draft.environment!==source.environment||draft.rawPayload!==source.rawPayload||!draft.intentId||draft.communicationRouteId&&draft.communicationRouteId!==input.routeId)throw Error('customer_masterdata_draft_binding_changed')
 return bindCustomerMasterdataValidationContext({kind:'customer_masterdata',...source,intentId:draft.intentId,routeId:input.routeId})
}
