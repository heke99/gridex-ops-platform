import{isEvidenceUuid}from'@/lib/ediel/utilts/durableSourceDiscovery'
import{ supabaseService }from'@/lib/supabase/service'
import type{CustomerLifeEventExportProjection}from'./customerLifeEventExport'
export type CustomerLifeEventPatch={effectiveAt:string;sourceMessageId:string;sourcePayloadHash:string;customerVersion:number;primaryAssessmentId:string;primaryFactsHash:string;appliedAt:string;availableAt:string;customerFields:CustomerLifeEventExportProjection['customerFields'];endUserMasterdata:CustomerLifeEventExportProjection['endUserMasterdata']}
/** Independent source deltas only. The consumer must qualify its own baseline;
 * empty patches are never authority for a prior customer identity/name. */
export async function readCustomerLifeEventPatches(input:{companyId:string;customerId:string;actorUserId:string;from:string;to:string;cutoff:string}):Promise<CustomerLifeEventPatch[]>{
 const from=Date.parse(input.from),to=Date.parse(input.to),cutoff=Date.parse(input.cutoff)
 if(![input.from,input.to,input.cutoff].every(value=>/(?:Z|[+-]\d{2}:\d{2})$/.test(value))||!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(cutoff)||from>=to)throw Error('customer_life_event_boundary_period_required')
 const{data,error}=await supabaseService.rpc('ediel_customer_life_event_patches_v1',{p_company_id:input.companyId,p_customer_id:input.customerId,p_actor_user_id:input.actorUserId,p_from:input.from,p_to:input.to,p_cutoff:input.cutoff});if(error)throw error
 if(data?.status==='held')throw Error('customer_life_event_patch_source_held')
 if(data?.status!=='authorized'||data.authorizesInitialCustomer!==false||data.companyId!==input.companyId||data.customerId!==input.customerId||Date.parse(data.from)!==from||Date.parse(data.to)!==to||Date.parse(data.cutoff)!==cutoff||(!Array.isArray(data.patches)||data.patches.length>1000))throw Error('customer_life_event_patch_result_invalid')
 let previous=-Infinity,version=0;const seen=new Set<number>()
 for(const p of data.patches){const at=Date.parse(p.effectiveAt)
  if(!Number.isFinite(at)||at<from||at>=to||at<previous||!isEvidenceUuid(p.sourceMessageId)||!isEvidenceUuid(p.primaryAssessmentId)||!/^[a-f0-9]{64}$/.test(p.sourcePayloadHash)||!/^[a-f0-9]{64}$/.test(p.primaryFactsHash)||!Number.isSafeInteger(p.customerVersion)||p.customerVersion<1||seen.has(p.customerVersion)||(at===previous&&p.customerVersion<=version)||!Number.isFinite(Date.parse(p.appliedAt))||!Number.isFinite(Date.parse(p.availableAt))||Date.parse(p.appliedAt)>cutoff||Date.parse(p.availableAt)>cutoff||!p.customerFields||!p.endUserMasterdata||Object.keys(p.customerFields).some(k=>!['name','full_name','company_name','org_number','personal_number'].includes(k))||Object.keys(p.endUserMasterdata).some(k=>!['name','street','postCode','city','country'].includes(k))||Object.values(p.customerFields).some(v=>v!==null&&typeof v!=='string')||Object.entries(p.endUserMasterdata).some(([k,v])=>k==='name'||k==='street'?!Array.isArray(v)||v.some(part=>typeof part!=='string'):v!==null&&typeof v!=='string'))throw Error('customer_life_event_patch_result_invalid')
  previous=at;version=p.customerVersion;seen.add(version)
 }return data.patches
}
