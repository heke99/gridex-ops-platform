import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'

export type BilateralClosureBasis=Readonly<{status:'authorized';version:1;owner:'immutable-bilateral-prodat-closure-operation-v1';companyId:string;actorUserId:string;environment:'test'|'production';operationId:string;periodId:string;profileId:string;customerId:string;siteId:string;pointId:string;contractId:string;contractHash:string;externalPoint:string;identityAgency:'9';gridArea:string;legalActorId:string;legalSenderId:string;legalReceiverId:string;sourceHash:string;sourceGrammarHash:string;effectiveAt:string;lineItemReference:string;documentReference:string;customerIdentity:Readonly<{id:string;qualifier:'SE1'|'SE2';agency:'260'}>}>
export type BilateralClosureHeld={status:'held';missing:string[]}
const qualified=new WeakSet<object>()
export function isQualifiedBilateralClosureBasis(value:unknown):value is BilateralClosureBasis{return !!value&&typeof value==='object'&&qualified.has(value)}

/** IDs select an actual native operation. Only its protected read can bind the
 * draft; the native atomic original rechecks the same scope under graph locks. */
export async function readBilateralClosureOperation(input:{companyId:string;actorUserId:string;operationId:string}):Promise<BilateralClosureBasis|BilateralClosureHeld>{
 const{data,error}=await supabaseService.rpc('ediel_read_bilateral_prodat_closure_operation_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_operation_id:input.operationId});if(error)throw error
 if(data===null)return {status:'held',missing:['actual_current_own_supply_and_authenticated_reviewed_lk_agreement']}
 const b=data as Partial<BilateralClosureBasis>,identity=b.customerIdentity,hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),text=(value:unknown,max=35)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value)
 const reference='LK'+input.operationId.replaceAll('-','')
 if(b.status!=='authorized'||b.version!==1||b.owner!=='immutable-bilateral-prodat-closure-operation-v1'||b.companyId!==input.companyId||b.actorUserId!==input.actorUserId||b.operationId!==input.operationId||!['companyId','actorUserId','operationId','periodId','profileId','customerId','siteId','pointId','contractId','legalActorId'].every(key=>isEvidenceUuid(b[key as keyof BilateralClosureBasis]))||!['test','production'].includes(b.environment??'')||!hash(b.contractHash)||!hash(b.sourceHash)||!hash(b.sourceGrammarHash)||!text(b.externalPoint)||b.identityAgency!=='9'||!text(b.gridArea)||!text(b.legalSenderId)||!text(b.legalReceiverId)||b.lineItemReference!==reference||b.documentReference!==reference||!b.effectiveAt||!/(?:Z|[+-]\d{2}:\d{2})$/.test(b.effectiveAt)||!Number.isFinite(Date.parse(b.effectiveAt))||Date.parse(b.effectiveAt)%60000!==0||!identity||!text(identity.id)||!['SE1','SE2'].includes(identity.qualifier)||identity.agency!=='260')throw Error('bilateral_closure_operation_result_invalid')
 const basis=Object.freeze({...b,customerIdentity:Object.freeze({...identity})}) as BilateralClosureBasis;qualified.add(basis);return basis
}

export async function prepareBilateralClosureOperation(input:{companyId:string;actorUserId:string;supplyPeriodId:string;effectiveAt:string}):Promise<BilateralClosureBasis|BilateralClosureHeld>{
 if(!isEvidenceUuid(input.companyId)||!isEvidenceUuid(input.actorUserId)||!isEvidenceUuid(input.supplyPeriodId)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(input.effectiveAt)||!Number.isFinite(Date.parse(input.effectiveAt))||Date.parse(input.effectiveAt)%60000!==0)throw Error('bilateral_closure_operation_selector_invalid')
 const{data,error}=await supabaseService.rpc('ediel_prepare_bilateral_prodat_closure_operation_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_supply_period_id:input.supplyPeriodId,p_effective_at:input.effectiveAt});if(error)throw error
 if(data?.status==='held'&&data.companyId===input.companyId&&Array.isArray(data.missing)&&data.missing.every((item:unknown)=>typeof item==='string'))return {status:'held',missing:data.missing}
 if(data?.status!=='prepared'||data.companyId!==input.companyId||!isEvidenceUuid(data.operationId))throw Error('bilateral_closure_operation_prepare_invalid')
 const basis=await readBilateralClosureOperation({...input,operationId:data.operationId})
 if(basis.status==='authorized'&&(basis.periodId!==input.supplyPeriodId||Date.parse(basis.effectiveAt)!==Date.parse(input.effectiveAt)))throw Error('bilateral_closure_operation_prepare_scope_mismatch')
 return basis
}

export function assertBilateralClosureRoute(b:BilateralClosureBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 if(!isQualifiedBilateralClosureBasis(b)||route.companyId!==b.companyId||route.environment!==b.environment||route.actor.tenantIdentity?.legalActorId!==b.legalActorId||route.actor.legalActorEdielId!==b.legalSenderId||route.receiverEdielId!==b.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier')||route.applicationReference!=='23-DDQ-PRODAT')throw Error('bilateral_closure_canonical_legal_route_mismatch')
}
