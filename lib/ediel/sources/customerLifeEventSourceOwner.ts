import {supabaseService} from '@/lib/supabase/service'
import {isSourceCustomerLifeEventCommit,type SourceCustomerLifeEventCommit} from '@/lib/ediel/flows/sourceCustomerLifeEventCommit'
import type {SourceOwnerSeed,SourceObjectDecision} from './sourceOwnerPersistence'
import type {SourceObjectScope} from './sourceOwnerWire'
/** A committed native proof in the same primary source ledger. Mutable customer
 * metadata, ACK status or a restored serialized callback cannot mint a proof. */
export async function committedCustomerLifeEventOwners(seed:SourceOwnerSeed,commit:SourceCustomerLifeEventCommit,object:SourceObjectScope):Promise<Pick<SourceObjectDecision,'business'|'party'>|null>{
 if(!isSourceCustomerLifeEventCommit(commit)||commit.message.id!==seed.original.id||commit.message.raw_payload!==seed.original.raw_payload||commit.message.company_id!==seed.evidence.companyId||commit.message.environment!==seed.evidence.environment||commit.message.message_code!=='Z06')return null
 const{data,error}=await supabaseService.rpc('ediel_customer_life_event_committed_source_v1',{p_company_id:seed.evidence.companyId,p_message_id:seed.original.id,p_actor_user_id:commit.actorUserId}).abortSignal(AbortSignal.timeout(2000))
 if(error||data?.version!==1||data.sourceMessageId!==seed.original.id||data.sourcePayloadHash!==seed.evidence.sourcePayloadHash||data.companyId!==seed.evidence.companyId||data.environment!==seed.evidence.environment||data.rawPayload!==seed.original.raw_payload||!Array.isArray(data.scopes)||!Array.isArray(data.customerVersions))return null
 const scopes=data.scopes.filter((scope:Record<string,unknown>)=>scope.pointId===object.objectId&&scope.identityAgency===object.identityAgency)
 if(scopes.length!==1)return null
 const scope=scopes[0],versions=data.customerVersions.filter((v:Record<string,unknown>)=>v.customerId===scope.customerId)
 if(versions.length!==1||!Number.isSafeInteger(versions[0].version)||versions[0].version<1)return null
 const source={companyId:seed.evidence.companyId,environment:seed.evidence.environment,sourceMessageId:seed.original.id,sourcePayloadHash:seed.evidence.sourcePayloadHash}
 const stamp=new Date().toISOString()
 return {business:{version:1,owner:'inbound-customer-life-event-v1',coverage:'committed_customer_version_only',businessDisposition:'committed',graphNamespace:'source_bound_customer_history',sourceDisposition:'not_established',...source,object,customerId:scope.customerId,siteId:scope.siteId,meteringPointId:scope.meteringPointId,classification:scope.classification,customerVersion:versions[0].version,effectiveAt:scope.effectiveAt,sourceReceivedAt:seed.original.message_received_at,sourceObservedAt:data.observedAt,assessedAt:stamp},
  party:{version:1,owner:'received-source-party-binding-v1',ruleVersion:'1',source:{...source,receivedAt:seed.original.message_received_at},object,disposition:'accepted',reasons:[],frozenLegalContext:data.legalContext,assessedAt:stamp,completedAt:stamp}}
}
