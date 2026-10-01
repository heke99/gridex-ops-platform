import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
import type {AckFamily} from './ackPolicy'
import {assertNoTgtLeakageInProductionInput} from './productionGuards'

/** Only transport/display metadata and final canonical wire cross this port.
 * Native SQL supplies every source/owner/pack/operation/actor/resource binding.
 * Mint, INSERT, private consumption, intent receipt and created audit are one TX. */
export async function persistAtomicOutboundAck(input:CreateEdielMessageInput,authority:{
 sourceMessage:EdielMessageRow;companyId:string;environment:string;actorUserId:string;ackFamily:AckFamily;
 sequenceField:'relatedTransactionReference'|'utiltsErrSequenceToken'|null;sequenceValue:string|null;
 outcome:'positive'|'negative'|null;commonSmtp?:{from:string;host:string;port:number}
}):Promise<EdielMessageRow> {
 assertNoTgtLeakageInProductionInput(input)
 const keys=['rawPayload','messageVersion','processType','transportType','mailbox','senderEdielId','senderName','senderSubAddress',
  'receiverEdielId','receiverName','receiverSubAddress','senderEmail','receiverEmail','subject','fileName','mimeType',
  'interchangeReference','externalReference','correlationReference','transactionReference','applicationReference',
  'originalMessageId','originalTransactionId','originalMessageCode','communicationRouteId','routeProfileId',
  'parsedPayload','validationReport','requiresContrl','requiresAperak','syntaxCheckStatus','functionalCheckStatus',
  'messageCreatedAt','validatedAt','ackDueAt'] as const
 const draft=Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:'ediel_create_outbound_ack_atomic_v1',args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_create_outbound_ack_atomic_v1',{p_company_id:authority.companyId,p_environment:authority.environment,
  p_source_message_id:authority.sourceMessage.id,p_source_payload_hash:createHash('sha256').update(authority.sourceMessage.raw_payload??'','utf8').digest('hex'),
  p_actor_user_id:authority.actorUserId,p_ack_family:authority.ackFamily,p_sequence_field:authority.sequenceField,p_sequence_value:authority.sequenceValue,
  p_outcome:authority.outcome,p_draft:draft,p_common_smtp:authority.commonSmtp??null})
 if(error)throw error
 const result=data as {version?:unknown;sourceMessage?:EdielMessageRow;ackMessage?:EdielMessageRow}|null
 const source=result?.sourceMessage,ack=result?.ackMessage
 if(result?.version!==1||!source||source.id!==authority.sourceMessage.id||source.raw_payload!==authority.sourceMessage.raw_payload
  ||source.message_family!==authority.sourceMessage.message_family||source.message_code!==authority.sourceMessage.message_code
  ||source.company_id!==authority.sourceMessage.company_id||source.environment!==authority.environment||source.direction!=='inbound')throw Error('canonical_ack_actual_original_mismatch')
 if(!ack||!ack.id||ack.company_id!==authority.companyId||ack.environment!==authority.environment||ack.direction!=='outbound'
  ||ack.message_standard!=='edifact'||ack.message_family!==authority.ackFamily||ack.related_message_id!==source.id||!ack.raw_payload
  ||authority.sequenceField&&ack.parsed_payload?.[authority.sequenceField]!==authority.sequenceValue
  ||authority.outcome&&ack.ack_outcome!==authority.outcome)throw Error('canonical_ack_atomic_output_scope_mismatch')
 return ack
}
