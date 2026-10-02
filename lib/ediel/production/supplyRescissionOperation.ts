import {supabaseService} from '@/lib/supabase/service'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'

export type SupplyRescissionBasis=Readonly<{status:'authorized';version:1;owner:'immutable-national-supply-rescission-mandate-v1';companyId:string;actorUserId:string;environment:'test'|'production';mandateId:string;periodId:string;rulePackId:string;customerId:string;siteId:string;pointId:string;contractId:string;contractHash:string;externalPoint:string;identityAgency:'9';gridArea:string;legalActorId:string;legalSenderId:string;legalReceiverId:string;balanceResponsibleId:string;sourceHash:string;sourceGrammarHash:string;effectiveAt:string;lineItemReference:string;documentReference:string;customerIdentity:Readonly<{id:string;qualifier:'SE1'|'SE2';agency:'260'}>}>
export type SupplyRescissionHeld={status:'held';missing:string[]}
const qualified=new WeakSet<object>()
export function isQualifiedSupplyRescissionBasis(value:unknown):value is SupplyRescissionBasis{return !!value&&typeof value==='object'&&qualified.has(value)}

/** IDs select an actual native operation. Only its protected read can bind the
 * draft; the native atomic original rechecks the same scope under graph locks. */
export async function readSupplyRescissionMandate(input:{companyId:string;actorUserId:string;mandateId:string}):Promise<SupplyRescissionBasis|SupplyRescissionHeld>{
 const{data,error}=await (supabaseService.rpc.bind(supabaseService) as unknown as (name:'ediel_read_supply_rescission_mandate_v1',args:{p_company_id:string;p_actor_user_id:string;p_mandate_id:string})=>PromiseLike<{data:unknown;error:unknown}>)('ediel_read_supply_rescission_mandate_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_mandate_id:input.mandateId});if(error)throw error
 if(data===null)return {status:'held',missing:['actual_current_own_supply_and_authenticated_reviewed_legal_rescission_original']}
 const b=data as Partial<SupplyRescissionBasis>,identity=b.customerIdentity,hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),text=(value:unknown,max=35)=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\x00-\x1f\x7f]/.test(value)
 const reference='H'+input.mandateId.replaceAll('-','')
 if(b.status!=='authorized'||b.version!==1||b.owner!=='immutable-national-supply-rescission-mandate-v1'||b.companyId!==input.companyId||b.actorUserId!==input.actorUserId||b.mandateId!==input.mandateId||!['companyId','actorUserId','mandateId','periodId','rulePackId','customerId','siteId','pointId','contractId','legalActorId'].every(key=>isEvidenceUuid(b[key as keyof SupplyRescissionBasis]))||!['test','production'].includes(b.environment??'')||!hash(b.contractHash)||!hash(b.sourceHash)||!hash(b.sourceGrammarHash)||!text(b.externalPoint)||b.identityAgency!=='9'||!text(b.gridArea)||!text(b.legalSenderId)||!text(b.legalReceiverId)||!text(b.balanceResponsibleId)||b.lineItemReference!==reference||b.documentReference!==reference||!b.effectiveAt||!/(?:Z|[+-]\d{2}:\d{2})$/.test(b.effectiveAt)||!Number.isFinite(Date.parse(b.effectiveAt))||Date.parse(b.effectiveAt)%60000!==0||!identity||!text(identity.id)||!['SE1','SE2'].includes(identity.qualifier)||identity.agency!=='260')throw Error('supply_rescission_operation_result_invalid')
 const basis=Object.freeze({...b,customerIdentity:Object.freeze({...identity})}) as SupplyRescissionBasis;qualified.add(basis);return basis
}

export function assertSupplyRescissionRoute(b:SupplyRescissionBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){
 if(!isQualifiedSupplyRescissionBasis(b)||route.companyId!==b.companyId||route.environment!==b.environment||route.actor.tenantIdentity?.legalActorId!==b.legalActorId||route.actor.legalActorEdielId!==b.legalSenderId||route.receiverEdielId!==b.legalReceiverId||!route.actor.marketRoles.includes('electricity_supplier')||route.applicationReference!=='23-DDQ-PRODAT')throw Error('supply_rescission_canonical_legal_route_mismatch')
}
