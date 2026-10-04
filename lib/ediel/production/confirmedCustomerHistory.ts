import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import type {AiListHistoryScope} from '@/lib/ediel/aiListHistory'
import type {StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
export type ConfirmedCustomerFacet={sourceMessageId:string;payloadHash:string;companyId:string;environment:'test'|'production';customerId:string;siteId:string;meteringPointId:string;supplyPeriodId:string;objectId:string;identityAgency:string;legalSender:string;legalReceiver:string;effectiveAt:string;marketMinute:string;availableAt:string;party:{id:string;qualifier:string;agency:string;name:string};authorityKind?:'bilateral';identityChangeAuthorized?:boolean}
export type ConfirmedCustomerHistory={owner:'confirmed-customer-facet-snapshot-v1';companyId:string;environment:'test'|'production';customerId:string;siteId:string;snapshotId:string;readsetHash:string;cutoffAt:string;versions:ConfirmedCustomerFacet[]}
const qualified=new WeakMap<ConfirmedCustomerHistory,string>()
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
/** Selectors identify the same immutable snapshot. They never supply source
 * parties, approval flags, customer versions or a second historical cutoff. */
export async function readConfirmedCustomerHistory(input:{scope:AiListHistoryScope;actorUserId:string;readset:StructuralReadset}):Promise<ConfirmedCustomerHistory>{
 const s=input.scope,t=input.readset.timeline,rpc=supabaseService.rpc.bind(supabaseService) as unknown as Rpc
 const{data,error}=await rpc('ediel_confirmed_customer_snapshot_v1',{p_company_id:s.companyId,p_actor_user_id:input.actorUserId,p_snapshot_id:t.snapshotId,p_readset_hash:t.readsetHash,p_customer_id:s.customerId,p_site_id:s.siteId})
 if(error)throw error
 const v=data as ConfirmedCustomerHistory
 if(!v||v.owner!=='confirmed-customer-facet-snapshot-v1'||v.companyId!==s.companyId||v.environment!==s.environment||v.customerId!==s.customerId||v.siteId!==s.siteId||v.snapshotId!==t.snapshotId||v.readsetHash!==t.readsetHash||Date.parse(v.cutoffAt)!==Date.parse(s.cutoffAt)||!Array.isArray(v.versions)||v.versions.length>1000)throw Error('confirmed_customer_history_unconfirmed')
 for(const row of v.versions){
  const source=input.readset.sources.find(x=>x.sourceMessageId===row.sourceMessageId)
  if(row.companyId!==s.companyId||row.environment!==s.environment||row.customerId!==s.customerId||row.siteId!==s.siteId||row.legalSender!==s.legalNetwork||row.legalReceiver!==s.legalSupplier||!source||source.payloadHash!==row.payloadHash||! /^[0-9]{12}$/.test(row.marketMinute)||!row.party||typeof row.party.id!=='string'||typeof row.party.name!=='string'||!row.party.name||!['SE1','SE2'].includes(row.party.qualifier)||row.party.agency!=='260'||!Number.isFinite(Date.parse(row.availableAt))||Date.parse(row.availableAt)>Date.parse(s.cutoffAt))throw Error('confirmed_customer_history_facet_invalid')
  if(row.identityChangeAuthorized!==undefined&&(row.authorityKind!=='bilateral'||row.identityChangeAuthorized!==true))throw Error('confirmed_customer_history_identity_authority_invalid')
 }
 qualified.set(v,hash(v));return v
}
/** No JSON copy, fixture marker or mutated RPC result is a read capability. */
export function isConfirmedCustomerHistoryQualified(value:unknown,scope:AiListHistoryScope,readset:StructuralReadset):value is ConfirmedCustomerHistory{
 if(!value||typeof value!=='object')return false;const v=value as ConfirmedCustomerHistory
 return qualified.get(v)===hash(v)&&v.companyId===scope.companyId&&v.environment===scope.environment&&v.customerId===scope.customerId&&v.siteId===scope.siteId&&v.snapshotId===readset.timeline.snapshotId&&v.readsetHash===readset.timeline.readsetHash&&Date.parse(v.cutoffAt)===Date.parse(scope.cutoffAt)
}
