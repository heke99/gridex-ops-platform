import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {parseDeliveryStatusReport,type DeliveryStatusReport} from './dsnDisposition'

export type DsnSourceField='raw_email'|'body_text'|'attachment'
export type DsnObservation=Readonly<{observationId:string;attemptId:string;messageId:string;sourceHash:string;observedAt:string;
  transportCorrelation:'source_matched_unverified';authorizesResend:false;deliveryProven:false}>
export type DsnObservationProjection=Readonly<{version:1;companyId:string;messageId:string;authorizesResend:false;deliveryProven:false;
  observations:Array<{observationId:string;attemptId:string;observedAt:string;transportCorrelation:'source_matched_unverified';recipient:DeliveryStatusReport['recipients'][number]}>}>
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Consume the actual fetched MIME source. Returned message headers identify
 * candidates only; their company and delivery authenticity are never inferred. */
export async function recordDsnSourceObservation(input:{companyId:string;actorUserId:string;inboundEmailMessageId:string;
  sourceField:DsnSourceField;attachmentId?:string|null;rawSource:string}):Promise<DsnObservation|null>{
  if(![input.companyId,input.actorUserId,input.inboundEmailMessageId].every(value=>uuid.test(value))
    || input.sourceField==='attachment'&&!uuid.test(input.attachmentId ?? '')
    || input.sourceField!=='attachment'&&input.attachmentId)throw new Error('ediel_dsn_source_scope_required')
  const report=parseDeliveryStatusReport(input.rawSource)
  if(!report||report.issues.length||report.originalMessageIds.length!==1||report.recipients.length!==1)return null
  const sourceHash=createHash('sha256').update(input.rawSource,'utf8').digest('hex')
  const {data,error}=await supabaseService.rpc('ediel_record_dsn_source_observation_v1',{p_input:{
    companyId:input.companyId,actorUserId:input.actorUserId,inboundEmailMessageId:input.inboundEmailMessageId,
    sourceField:input.sourceField,attachmentId:input.attachmentId ?? null,sourceHash,report,
  }})
  const result=data as Partial<DsnObservation>&{version?:unknown}|null
  if(error||result?.version!==1||!uuid.test(result.observationId ?? '')||!uuid.test(result.attemptId ?? '')||!uuid.test(result.messageId ?? '')
    ||result.sourceHash!==sourceHash||!Number.isFinite(Date.parse(result.observedAt ?? ''))
    ||result.transportCorrelation!=='source_matched_unverified'||result.authorizesResend!==false||result.deliveryProven!==false)
    throw new Error('ediel_dsn_source_observation_unconfirmed',{cause:error})
  return Object.freeze(result as DsnObservation)
}

export async function readDsnSourceObservations(input:{companyId:string;actorUserId:string;messageId:string}):Promise<DsnObservationProjection>{
  if(!Object.values(input).every(value=>uuid.test(value)))throw new Error('ediel_dsn_source_scope_required')
  const {data,error}=await supabaseService.rpc('ediel_read_dsn_source_observations_v1',{p_company_id:input.companyId,
    p_actor_user_id:input.actorUserId,p_message_id:input.messageId})
  const result=data as DsnObservationProjection|null
  if(error||result?.version!==1||result.companyId!==input.companyId||result.messageId!==input.messageId
    ||result.authorizesResend!==false||result.deliveryProven!==false||!Array.isArray(result.observations)||result.observations.length>256
    ||result.observations.some(item=>!uuid.test(item.observationId)||!uuid.test(item.attemptId)
      ||!Number.isFinite(Date.parse(item.observedAt))||item.transportCorrelation!=='source_matched_unverified'||!item.recipient))
    throw new Error('ediel_dsn_source_observations_unavailable',{cause:error})
  return result
}
