import {supabaseService} from '@/lib/supabase/service'
import {createHash} from 'node:crypto'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {readMeteringMethodChangeSource,assertMeteringMethodChangeCanonicalRoute,type MeteringMethodChangeBasis} from '@/lib/ediel/production/meteringMethodChangeSource'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'

export type RecoveryMeteringMethodBasis=MeteringMethodChangeBasis&{recoveryOperationId:string;originalMessageId:string;sourceOriginMessageId:string;correctedPayloadHash:string}
/** The established native operation selects its terminal event. A raw method,
 * customer flag or caller event ID cannot qualify the protected agreement. */
export async function loadRecoveryMeteringMethodContext(input:{companyId:string;operationId:string;actorUserId:string;rawPayload:string}):Promise<RecoveryMeteringMethodBasis|undefined>{
 if(![input.companyId,input.operationId,input.actorUserId].every(isEvidenceUuid)||!input.rawPayload)throw Error('metering_method_recovery_scope_required')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const args={p_company_id:input.companyId,p_operation_id:input.operationId,p_actor_user_id:input.actorUserId}
 const read=async()=>{const{data,error}=await rpc('ediel_metering_method_recovery_source_v1',args);if(error)throw error;if(data===null)return undefined
  if(!data||typeof data!=='object')throw Error('metering_method_recovery_result_invalid')
  const b=data as RecoveryMeteringMethodBasis
  if(b.status!=='authorized'){const missing=Reflect.get(data,'missing');throw Error(`metering_method_recovery_source_held:${Array.isArray(missing)?missing.join(','):'unknown'}`)}
  if(b.companyId!==input.companyId||b.recoveryOperationId!==input.operationId||![b.eventId,b.originalMessageId,b.sourceOriginMessageId].every(isEvidenceUuid)||b.correctedPayloadHash!==createHash('sha256').update(input.rawPayload,'utf8').digest('hex'))throw Error('metering_method_recovery_source_scope_invalid')
  return b}
 const{data:scope,error:scopeError}=await rpc('ediel_metering_method_recovery_scope_v1',args);if(scopeError)throw scopeError;if(scope===null)return undefined
 if(!scope||typeof scope!=='object'||Reflect.get(scope,'companyId')!==input.companyId||Reflect.get(scope,'recoveryOperationId')!==input.operationId||!isEvidenceUuid(Reflect.get(scope,'eventId'))||Reflect.get(scope,'correctedPayloadHash')!==createHash('sha256').update(input.rawPayload,'utf8').digest('hex'))throw Error('metering_method_recovery_source_scope_invalid')
 // Reuse the original genuine-event adapter: it qualifies the current dated
 // BRP structural source and contract intake before the final native recheck.
 const current=await readMeteringMethodChangeSource({companyId:input.companyId,eventId:Reflect.get(scope,'eventId') as string,actorUserId:input.actorUserId})
 if(current.status!=='authorized')throw Error(`metering_method_recovery_source_held:${current.missing.join(',')}`)
 const final=await read();if(!final||final.eventId!==current.eventId||final.sourceDigest!==current.sourceDigest||final.contractRevision!==current.contractRevision||final.brpEdielId!==current.brpEdielId||final.effectiveAt!==current.effectiveAt||final.method!==current.method||final.reason!==current.reason||final.customerId!==current.customerId||final.meteringPointId!==current.meteringPointId)throw Error('metering_method_recovery_current_source_changed')
 return final
}
export function assertRecoveryMeteringMethodRoute(b:RecoveryMeteringMethodBasis,route:Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>){assertMeteringMethodChangeCanonicalRoute(b,route)}
