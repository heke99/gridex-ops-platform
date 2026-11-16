import {supabaseService} from '@/lib/supabase/service'
declare const preparationBrand:unique symbol
export type QualifiedBilateralProdatSwitchPreparation=Readonly<{version:1;owner:'immutable-bilateral-prodat-switch-preparation-v1';companyId:string;actorUserId:string;environment:'test'|'production';switchId:string;pointId:string;objectId:string;customerId:string;siteId:string;contractId:string;contractHash:string;requestedStartDate:string;senderEdielId:string;receiverEdielId:string;gridAreaCode:string;profileVersionId:string;rulePackId:string;messageProfileId:string;sourceVersion:string;sourceHash:string;sourceGrammarHash:string;[preparationBrand]:true}>
const issued=new WeakSet<QualifiedBilateralProdatSwitchPreparation>()
export type BilateralSwitchPreparationScope={companyId:string;actorUserId:string;environment:'test'|'production';switchId:string}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
/** Actual private archived profile and current own operation are read before
 * the first request/intent write. Native original persistence rechecks them. */
export async function qualifyBilateralProdatSwitchPreparation(scope:BilateralSwitchPreparationScope):Promise<QualifiedBilateralProdatSwitchPreparation>{
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_qualify_bilateral_prodat_switch_preparation_v1',{p_company_id:scope.companyId,p_switch_id:scope.switchId,p_actor_user_id:scope.actorUserId,p_environment:scope.environment})
 if(error)throw error
 const q=data as Record<string,unknown>|null
 if(!q)throw Error('bilateral_prodat_switch_current_profile_required')
 if(q.version!==1||q.owner!=='immutable-bilateral-prodat-switch-preparation-v1'||q.companyId!==scope.companyId||q.switchId!==scope.switchId||q.actorUserId!==scope.actorUserId||q.environment!==scope.environment
  ||!['companyId','actorUserId','switchId','pointId','customerId','siteId','contractId','profileVersionId','rulePackId','messageProfileId'].every(k=>uuid(q[k]))
  ||!['contractHash','sourceHash','sourceGrammarHash'].every(k=>typeof q[k]==='string'&&/^[a-f0-9]{64}$/.test(q[k] as string))
  ||typeof q.objectId!=='string'||!/^\d{18}$/.test(q.objectId)||typeof q.requestedStartDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.requestedStartDate)||!q.senderEdielId||!q.receiverEdielId||!q.gridAreaCode||q.sourceVersion!=='26.A:r3')throw Error('bilateral_prodat_switch_preparation_receipt_unqualified')
 const result=Object.freeze({...q}) as unknown as QualifiedBilateralProdatSwitchPreparation;issued.add(result);return result
}
export function bilateralProdatSwitchPreparationQualified(q:QualifiedBilateralProdatSwitchPreparation|null|undefined,scope:BilateralSwitchPreparationScope&{pointId:string;customerId:string;siteId:string;contractId:string;requestedStartDate:string;senderEdielId:string;receiverEdielId:string}):boolean{
 return Boolean(q&&issued.has(q)&&q.companyId===scope.companyId&&q.actorUserId===scope.actorUserId&&q.environment===scope.environment&&q.switchId===scope.switchId&&q.pointId===scope.pointId&&q.customerId===scope.customerId&&q.siteId===scope.siteId&&q.contractId===scope.contractId&&q.requestedStartDate===scope.requestedStartDate&&q.senderEdielId===scope.senderEdielId&&q.receiverEdielId===scope.receiverEdielId)
}
