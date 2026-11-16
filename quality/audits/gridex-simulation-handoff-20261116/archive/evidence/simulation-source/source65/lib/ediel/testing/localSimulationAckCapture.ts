import 'server-only'
import {createHash} from 'node:crypto'
import {buildAckDraftForSource} from '@/lib/ediel/ack'
import {executeLocalSimulation,requireLocalSimulation,requireLocalSimulationActor,type LocalSimulationContext,type AckResult} from './localSimulationContractAdmission'

/** Render the actual canonical body, but create no ordinary outbound message,
 * SMTP route, ACK foreign key, *_sent event or ordinary finalize operation. */
export async function captureLocalSimulationAck(context:LocalSimulationContext,params:Parameters<typeof buildAckDraftForSource>[0]):Promise<AckResult> {
  if(!params.actorUserId) throw new Error('local_simulation_authenticated_actor_required')
  requireLocalSimulationActor(context,params.actorUserId)
  const source=params.sourceMessage
  if(!source.company_id || source.environment!=='test' || source.direction!=='inbound' || !source.raw_payload) throw new Error('local_simulation_ack_source_invalid')
  const sourcePayloadSha256=createHash('sha256').update(source.raw_payload,'utf8').digest('hex')
  requireLocalSimulation(context,{companyId:source.company_id,sourceSha256:sourcePayloadSha256})
  const contrl=params.ackFamily==='CONTRL' && (!params.ackScope || params.ackScope==='message') && !params.relatedTransactionReference
  const positiveTransaction=params.ackFamily==='APERAK' && params.outcome==='positive' && params.ackScope==='transaction' && Boolean(params.relatedTransactionReference)
  if(!contrl && !positiveTransaction) throw new Error('gridex_local_test_unsupported_local_ack_variant')
  const draft=buildAckDraftForSource(params)
  const body=draft.rawPayload
  if(typeof body!=='string' || !body || Buffer.byteLength(body,'utf8')>2097152) throw new Error('local_simulation_ack_body_missing')
  const ackScope=params.ackScope ?? (params.relatedTransactionReference ? 'transaction' : 'message')
  if(ackScope!=='message' && ackScope!=='transaction') throw new Error('local_simulation_ack_scope_invalid')
  const protocolOutcome=params.outcome ?? 'positive'
  const receipt=await executeLocalSimulation(context,'ack_capture',{
    sourceMessageId:source.id,sourcePayloadSha256,ackFamily:params.ackFamily,protocolOutcome,ackScope,
    transactionReference:params.relatedTransactionReference ?? null,body,bodySha256:createHash('sha256').update(body,'utf8').digest('hex'),
    rendererSha256:'a2ac73f632c81a0c5cbab1aa680af396a43a453dbf9db86b33499aadf28157d5',
  },`ack:${source.id}:${params.ackFamily}:${protocolOutcome}:${ackScope}:${params.relatedTransactionReference ?? 'message'}`)
  const captured=receipt.result
  if(captured.sourceMessageId!==source.id || captured.sourcePayloadSha256!==sourcePayloadSha256 || captured.ackFamily!==params.ackFamily
    || captured.protocolOutcome!==protocolOutcome || captured.ackScope!==ackScope || captured.transactionReference!==(params.relatedTransactionReference ?? null)) throw new Error('local_simulation_ack_result_scope_invalid')
  if(!receipt.replayed && captured.bodySha256!==createHash('sha256').update(body,'utf8').digest('hex')) throw new Error('local_simulation_ack_result_scope_invalid')
  return captured
}
