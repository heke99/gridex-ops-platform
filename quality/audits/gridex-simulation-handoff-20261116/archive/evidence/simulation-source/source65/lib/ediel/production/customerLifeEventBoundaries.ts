import {supabaseService} from '@/lib/supabase/service'
import type {CustomerLifeEventExportProjection} from './customerLifeEventExport'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
export type CustomerLifeEventBoundary={effectiveAt:string;sourceMessageId:string;customerVersion:number;projection:CustomerLifeEventExportProjection}
export async function readCustomerLifeEventBoundaries(input:{companyId:string;customerId:string;actorUserId:string;from:string;to:string}):Promise<CustomerLifeEventBoundary[]>{
 const from=Date.parse(input.from),to=Date.parse(input.to)
 if(![input.from,input.to].every(value=>/(?:Z|[+-]\d{2}:\d{2})$/.test(value))||!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error('customer_life_event_boundary_period_required')
 const{data,error}=await supabaseService.rpc('ediel_customer_life_event_boundaries_v1',{p_company_id:input.companyId,p_customer_id:input.customerId,p_actor_user_id:input.actorUserId,p_from:input.from,p_to:input.to})
 if(error)throw error
 if(data?.status==='held')throw Error('customer_life_event_boundary_source_held')
 if(data?.status!=='authorized'||data.companyId!==input.companyId||data.customerId!==input.customerId||Date.parse(data.from)!==from||Date.parse(data.to)!==to||!Array.isArray(data.boundaries))throw Error('customer_life_event_boundary_result_invalid')
 let previous=-Infinity
 for(const value of data.boundaries){
  const at=Date.parse(value.effectiveAt),projection=value.projection
  if(!Number.isFinite(at)||at<from||at>=to||at<=previous||!isEvidenceUuid(value.sourceMessageId)||!Number.isSafeInteger(value.customerVersion)||value.customerVersion<1||projection?.status!=='authorized'||projection.companyId!==input.companyId||projection.customerId!==input.customerId||Date.parse(projection.asOf)!==at||projection.sourceMessageId!==value.sourceMessageId||projection.customerVersion!==value.customerVersion||!projection.customerFields||!projection.endUserMasterdata)throw Error('customer_life_event_boundary_result_invalid')
  previous=at
 }
 return data.boundaries
}
