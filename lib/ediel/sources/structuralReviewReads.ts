import {tenantDb} from '@/lib/supabase/tenantDb'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

type Result={data:unknown;error:unknown;count:number|null}
type ReviewQuery=PromiseLike<Result>&{eq(key:string,value:string):ReviewQuery;limit(n:number):ReviewQuery;abortSignal(signal:AbortSignal):ReviewQuery;maybeSingle():PromiseLike<Result>}
export function structuralReviewQuery(companyId:string,table:string,columns:string,count=false):ReviewQuery{
 return tenantDb(companyId).from(table).select(columns,count?{count:'exact'}:undefined) as ReviewQuery
}

export const STRUCTURAL_REVIEW_COLUMNS={
  metering_points:'id,company_id,customer_id,meter_point_id,site_id',
  supplier_switch_requests:'id,company_id,customer_id,metering_point_id,site_id,inbound_z04_message_id,status,confirmed_start_date,created_at,outbound_z03_message_id,rff_li_reference',
  customer_supply_periods:'id,company_id,customer_id,metering_point_id,source_message_id,status,start_date,end_date,source_switch_request_id',
  ediel_messages:'id,company_id,environment,direction,message_family,message_code,message_standard,created_at,message_sent_at,metering_point_id,customer_id,site_id',
} as const
export async function readStructuralReviewRow(table:keyof typeof STRUCTURAL_REVIEW_COLUMNS,companyId:string,id:string):Promise<Record<string,unknown>>{
  if(!isEvidenceUuid(companyId)||!isEvidenceUuid(id))throw new Error('structure_review_identity_invalid')
  const {data,error}=await structuralReviewQuery(companyId,table,STRUCTURAL_REVIEW_COLUMNS[table]).eq('id',id).abortSignal(AbortSignal.timeout(2000)).maybeSingle()
  if(error||!isEvidenceRecord(data)||data.id!==id||data.company_id!==companyId
    ||STRUCTURAL_REVIEW_COLUMNS[table].split(',').some(key=>!Object.hasOwn(data,key)||data[key]===undefined))throw new Error('structure_review_owner_unavailable')
  return structuredClone(data)
}
/** The legacy business graph has no namespace column. It can establish only
 * agency9; an unqualified numeric match must not approve agency89. */
export async function findStructuralReviewPoint(companyId:string,objectId:string):Promise<Record<string,unknown>>{
  const {data,error,count}=await structuralReviewQuery(companyId,'metering_points',STRUCTURAL_REVIEW_COLUMNS.metering_points,true).eq('meter_point_id',objectId).limit(2).abortSignal(AbortSignal.timeout(2000))
  if(error||count!==1||!Array.isArray(data)||data.length!==1||!isEvidenceRecord(data[0])||data[0].company_id!==companyId
    ||!isEvidenceUuid(data[0].id)||!isEvidenceUuid(data[0].site_id)||!isEvidenceUuid(data[0].customer_id))throw new Error('structure_review_point_ambiguous')
  return data[0]
}
