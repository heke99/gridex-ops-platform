import type { EdielBusinessExpectation, EdielBusinessExpectationScope } from '@/lib/ediel/businessExpectations'
import { readEdielBusinessExpectations } from '@/lib/ediel/businessExpectations'
import { readEdielMeteringMethodExpectations } from '@/lib/ediel/meteringMethodExpectations'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { tenantDb } from '@/lib/supabase/tenantDb'

type Source = Pick<EdielMessageRow,'id'|'company_id'|'environment'|'direction'|'message_family'|'message_code'|'status'|'requires_contrl'|'contrl_status'|'contrl_due_at'|'requires_aperak'|'aperak_status'>
export type EdielProcessActionVisibility = Readonly<{canRead:boolean;canReview:boolean;canPrepare:boolean}>
export type EdielProcessNextAction = Readonly<{
  version:1;sourceMessageId:string;cause:'source_context_held'|'business_response_pending'|'business_response_received'|'business_response_rejected'|'business_watch_overdue'|'technical_rejection';
  responsibility:'counterparty'|'tenant_operator';waitingFor:readonly string[];blockers:readonly string[];
  allowedActions:readonly ('read_source'|'review_case')[];summary:string;
  timeBasis:Readonly<{anchor:'actual_accepted_smtp_observed_at'|'z09_validity_day';anchorAt:string|null;businessDueAt:string|null;technicalDueAt:string|null;remoteReceiptKnown:false;timerKind:'internal_sender_watch'|'untimed_business_response'|'source_validity_day_watch'|null;validityDay?:string|null;dueDay?:string|null;actualAcceptedAt?:string|null}>;
  authorizesProviderEntry:false;automaticResendAllowed:false;
}>
const responses:Readonly<Record<string,string>>=Object.freeze({Z01:'Z02',Z13:'Z14',Z18:'Z15'})
const timestamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null

/** Read-only display of an actual native owner decision, never operation
 * authorization. Each form/API/dispatch keeps its own fresh permission/source
 * gates. Business response and technical/application ACK watches are parallel. */
export function deriveEdielProcessNextAction(input:{companyId:string;message:Source;expectation:EdielBusinessExpectation;evaluatedAt:string;access:EdielProcessActionVisibility}):EdielProcessNextAction{
 const {message:m,expectation:e,access}=input,metadata=e.metadata&&typeof e.metadata==='object'?e.metadata:{}
 const anchorAt=timestamp(metadata.anchorAt),businessDueAt=timestamp(e.due_at),technicalDueAt=timestamp(m.contrl_due_at),evaluatedAt=timestamp(input.evaluatedAt)
 const sameScope=m.company_id===input.companyId
 const timerKind=metadata.timerKind==='internal_sender_watch'||metadata.timerKind==='untimed_business_response'?metadata.timerKind:null
 const visible=access.canRead&&sameScope
 const result=(cause:EdielProcessNextAction['cause'],responsibility:EdielProcessNextAction['responsibility'],waitingFor:string[],blockers:string[],summary:string):EdielProcessNextAction=>Object.freeze({
  version:1,sourceMessageId:m.id,cause,responsibility,waitingFor:Object.freeze(waitingFor),blockers:Object.freeze(blockers),summary,
  allowedActions:Object.freeze(visible?['read_source' as const,...(access.canReview&&blockers.length?['review_case' as const]:[])]:[]),
  timeBasis:Object.freeze({anchor:'actual_accepted_smtp_observed_at' as const,anchorAt,businessDueAt,technicalDueAt,remoteReceiptKnown:false as const,timerKind}),authorizesProviderEntry:false,automaticResendAllowed:false,
 })
 if(!sameScope||m.direction!=='outbound'||m.message_family!=='PRODAT'||responses[m.message_code??'']!==e.expected_code||e.source_message_id!==m.id
  ||!evaluatedAt||!anchorAt||Date.parse(evaluatedAt)<Date.parse(anchorAt)||metadata.anchorType!=='actual_accepted_smtp_observed_at'||metadata.remoteReceiptKnown!==false
  ||!['pending','fulfilled','rejected','manual_review'].includes(e.status)||!timerKind
  ||(timerKind==='internal_sender_watch'&&(!businessDueAt||Date.parse(businessDueAt)<Date.parse(anchorAt)))
  ||(timerKind==='untimed_business_response'&&e.due_at!==null)
  ||(m.requires_contrl===true&&m.contrl_status==='pending'&&!technicalDueAt))
  return result('source_context_held','tenant_operator',[],['source_owned_process_context_required'],'Kontrollera ärendets källbeslut och tidsgrund innan nästa steg prövas.')
 const technicalPending=m.requires_contrl===true&&m.contrl_status==='pending'
 const applicationPending=m.requires_aperak===true&&m.aperak_status==='pending'
 const ackWaiting=[...(technicalPending?['CONTRL']:[]),...(applicationPending?['APERAK']:[])]
 const technicalOverdue=technicalPending&&technicalDueAt!==null&&Date.parse(technicalDueAt)<=Date.parse(evaluatedAt)
 const technicalBlockers=technicalOverdue?['technical_sender_watch_overdue']:[]
 if(e.status==='rejected')return result('business_response_rejected','tenant_operator',ackWaiting,['business_response_rejected',...technicalBlockers],'Granska det källkvalificerade negativa affärssvaret. Kvittensbevakning hanteras separat; ingen automatisk omsändning.')
 if(m.requires_contrl===true&&m.contrl_status==='failed')return result('technical_rejection','tenant_operator',[],['technical_response_rejected'],'Granska den faktiska tekniska avvisningen och originalet. Ett nytt skick kräver en separat aktuell prövning.')
 if(m.requires_aperak===true&&m.aperak_status==='failed')return result('technical_rejection','tenant_operator',[e.expected_code],['application_response_rejected',...technicalBlockers],'Granska den faktiska negativa APERAK-kvittensen. Affärssvaret prövas separat; ingen automatisk omsändning.')
 if(e.status==='fulfilled')return result('business_response_received',ackWaiting.length&&!technicalOverdue?'counterparty':'tenant_operator',ackWaiting,technicalBlockers,
  technicalOverdue?'Affärssvaret är kvalificerat. Granska den separata tekniska sändarbevakningen.':'Affärssvaret är kvalificerat. Fortsatt process prövas från sitt eget källbeslut; eventuell kvittens bevakas separat.')
 const overdue=e.status==='manual_review'||businessDueAt!==null&&Date.parse(businessDueAt)<=Date.parse(evaluatedAt)
 const businessLabel=e.expected_code==='Z02'?'Z02_or_negative_APERAK':e.expected_code
 if(overdue)return result('business_watch_overdue','tenant_operator',[businessLabel,...ackWaiting],['business_sender_watch_overdue',...technicalBlockers],
  'Granska uteblivet kvalificerat affärssvar och den egna sändarbevakningen. SMTP-klockan styr intern uppföljning; motpartens mottagningstid är inte känd. Ingen automatisk omsändning.')
 return result('business_response_pending',technicalOverdue?'tenant_operator':'counterparty',[businessLabel,...ackWaiting],technicalBlockers,
  `Invänta ${e.expected_code==='Z02'?'Z02 eller negativ APERAK':e.expected_code} från motparten. ${technicalPending?'CONTRL bevakas parallellt. ':''}${applicationPending?'APERAK bevakas parallellt. ':''}${technicalOverdue?'Granska den separata tekniska sändarbevakningen. ':''}Tidsgrunden är faktisk SMTP-acceptans för intern uppföljning; ingen automatisk omsändning.`)
}

const calendarDay=(value:unknown):string|null=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
 const instant=Date.parse(`${value}T00:00:00Z`)
 return Number.isFinite(instant)&&new Date(instant).toISOString().slice(0,10)===value?value:null
}
/** F/G watches are anchored to the qualified original's validity day. Actual
 * SMTP acceptance proves sending and remains a separate prerequisite. The
 * native due day and instant are displayed without deriving a new deadline. */
export function deriveEdielMeteringMethodProcessNextAction(input:Parameters<typeof deriveEdielProcessNextAction>[0]):EdielProcessNextAction{
 const {message:m,expectation:e,access}=input,meta=e.metadata&&typeof e.metadata==='object'?e.metadata:{}
 const validityDay=calendarDay(meta.validityDay),dueDay=calendarDay(meta.dueDay),acceptedAt=timestamp(meta.actualAcceptedAt)
 const evaluatedAt=timestamp(input.evaluatedAt),businessDueAt=timestamp(e.due_at),technicalDueAt=timestamp(m.contrl_due_at)
 const visible=access.canRead&&m.company_id===input.companyId
 const result=(cause:EdielProcessNextAction['cause'],responsibility:EdielProcessNextAction['responsibility'],waitingFor:string[],blockers:string[],summary:string):EdielProcessNextAction=>Object.freeze({
  version:1,sourceMessageId:m.id,cause,responsibility,waitingFor:Object.freeze(waitingFor),blockers:Object.freeze(blockers),summary,
  allowedActions:Object.freeze(visible?['read_source' as const,...(access.canReview&&blockers.length?['review_case' as const]:[])]:[]),
  timeBasis:Object.freeze({anchor:'z09_validity_day' as const,anchorAt:validityDay,validityDay,dueDay,actualAcceptedAt:acceptedAt,businessDueAt,technicalDueAt,
   remoteReceiptKnown:false as const,timerKind:'source_validity_day_watch' as const}),authorizesProviderEntry:false,automaticResendAllowed:false,
 })
 if(m.company_id!==input.companyId||m.direction!=='outbound'||m.message_family!=='PRODAT'||m.message_code!=='Z09'||e.expected_code!=='Z06'||e.source_message_id!==m.id
  ||meta.anchorType!=='z09_validity_day'||meta.timerKind!=='source_validity_day_watch'||meta.timerRuleId!=='TM-METHOD40'
  ||meta.remoteReceiptKnown!==false||meta.automaticResendAllowed!==false||meta.authorizesMarketEffects!==false
  ||meta.observationCriterion!=='same_applied_own_Z06_explicit_method_customer_point_agency_parties_and_not_before_validity_day'
  ||!validityDay||!dueDay||dueDay<validityDay||!businessDueAt||businessDueAt.slice(0,10)<dueDay||!acceptedAt||!evaluatedAt||evaluatedAt<acceptedAt
  ||!['pending','fulfilled','rejected','manual_review'].includes(e.status)||(m.requires_contrl===true&&m.contrl_status==='pending'&&!technicalDueAt))
  return result('source_context_held','tenant_operator',[],['source_owned_process_context_required'],'Kontrollera det källbundna F/G-originalet, giltighetsdagen och den faktiska sändningskvittensen.')
 const technicalPending=m.requires_contrl===true&&m.contrl_status==='pending',applicationPending=m.requires_aperak===true&&m.aperak_status==='pending'
 const ackWaiting=[...(technicalPending?['CONTRL']:[]),...(applicationPending?['APERAK']:[])]
 const technicalOverdue=technicalPending&&technicalDueAt!==null&&technicalDueAt<=evaluatedAt
 const blockers=technicalOverdue?['technical_sender_watch_overdue']:[]
 if(e.status==='rejected')return result('business_response_rejected','tenant_operator',ackWaiting,['business_response_rejected',...blockers],'Granska det källkvalificerade negativa affärssvaret. Kvittensbevakning hanteras separat; ingen automatisk omsändning.')
 if(m.requires_contrl===true&&m.contrl_status==='failed')return result('technical_rejection','tenant_operator',['Z06'],['technical_response_rejected'],'Granska den faktiska tekniska avvisningen. Den fyller inte den separata Z06-bevakningen.')
 if(m.requires_aperak===true&&m.aperak_status==='failed')return result('technical_rejection','tenant_operator',['Z06',...(technicalPending?['CONTRL']:[])],['application_response_rejected',...blockers],'Granska den faktiska negativa APERAK-kvittensen. Den fyller inte den separata Z06-bevakningen.')
 if(e.status==='fulfilled')return result('business_response_received',ackWaiting.length&&!technicalOverdue?'counterparty':'tenant_operator',ackWaiting,blockers,'Det egna tillämpade Z06-svaret är kvalificerat. Eventuell teknisk kvittens bevakas separat.')
 if(e.status==='manual_review'||businessDueAt<=evaluatedAt)return result('business_watch_overdue','tenant_operator',['Z06',...ackWaiting],['business_source_validity_watch_overdue',...blockers],'Granska uteblivet kvalificerat Z06-svar. Den egna bevakningen utgår från originalets giltighetsdag; ingen automatisk omsändning.')
 return result('business_response_pending',technicalOverdue?'tenant_operator':'counterparty',['Z06',...ackWaiting],blockers,'Invänta det egna tillämpade Z06-svaret från motparten. Bevakningen utgår från originalets giltighetsdag. CONTRL och APERAK prövas separat; ingen automatisk omsändning.')
}

const canonicalJson=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)

/** Actual private owner read precedes tenant-scoped source reads. A caller
 * cannot select another tenant's expectation through a guessed message ID. */
export async function readEdielProcessNextActions(input:EdielBusinessExpectationScope&{evaluatedAt:string;access:EdielProcessActionVisibility;messageIds?:readonly string[]}):Promise<ReadonlyMap<string,EdielProcessNextAction>>{
 const scope={companyId:input.companyId,environment:input.environment,actorUserId:input.actorUserId,limit:100}
 const requested=input.messageIds?[...new Set(input.messageIds)]:null
 if(requested&&requested.length>100)throw new Error('ediel_process_projection_scope_limit')
 // Exact requested sources avoid silently hiding new requests behind an old
 // company's first100 watches. No UI visibility flags enter the owner RPC.
 const owners=await Promise.all([readEdielBusinessExpectations,readEdielMeteringMethodExpectations].map(read=>requested?
  Promise.all(requested.map(messageId=>read({...scope,messageId}))).then(rows=>rows.flat()):read(scope)))
 const rows:EdielBusinessExpectation[]=[]
 for(const ownerRows of owners){
  const seen=new Set<string>()
  for(const row of ownerRows){
   if(typeof row.source_message_id!=='string'||requested&&!requested.includes(row.source_message_id))continue
   if(seen.has(row.source_message_id))throw new Error('ediel_process_projection_expectation_ambiguous')
   seen.add(row.source_message_id)
   const prior=rows.find(existing=>existing.source_message_id===row.source_message_id)
   if(prior&&canonicalJson(prior)!==canonicalJson(row))throw new Error('ediel_process_projection_expectation_ambiguous')
   if(!prior)rows.push(row)
  }
 }
 const selected=rows.filter(row=>typeof row.source_message_id==='string'&&(!requested||requested.includes(row.source_message_id)))
 const ids=[...new Set(selected.map(row=>row.source_message_id))]
 if(!ids.length)return new Map()
 const sourceQuery=tenantDb(input.companyId).from('ediel_messages')
  .select('id,company_id,environment,direction,message_family,message_code,status,requires_contrl,contrl_status,contrl_due_at,requires_aperak,aperak_status') as {
   in:(column:string,values:readonly string[])=>PromiseLike<{data:Source[]|null;error:unknown}>
  }
 const {data,error}=await sourceQuery.in('id',ids)
 if(error)throw error
 const sourceRows=data??[],result=new Map<string,EdielProcessNextAction>()
 for(const row of selected){
  const matching=sourceRows.filter(source=>source.id===row.source_message_id&&source.company_id===input.companyId&&source.environment===input.environment)
  if(matching.length!==1)throw new Error('ediel_process_projection_exact_source_required')
  if(result.has(row.source_message_id))throw new Error('ediel_process_projection_expectation_ambiguous')
  const derive=matching[0].message_code==='Z09'?deriveEdielMeteringMethodProcessNextAction:deriveEdielProcessNextAction
  result.set(row.source_message_id,derive({companyId:input.companyId,message:matching[0],expectation:row,evaluatedAt:input.evaluatedAt,access:input.access}))
 }
 return result
}

const reviewIntents=Object.freeze(['final_metering_and_billing','supply_continuation_review','meter_change_review','masterdata_update_review','ediel_unexpected_direction'] as const)
export type EdielReviewProcessDecision=Readonly<{
 version:1;sourceMessageId:string;cause:string;responsibility:'tenant_operator';summary:string;
 timeBasis:Readonly<{anchor:'actual_inbound_admission';admittedAt:string|null;protocolDeadline:null}>;
 blockers:readonly string[];candidateActions:readonly ['read_source','review_case'];authorizesProviderEntry:false;
}>
/** Created only beside the actual inbound state decision. Admission is kept
 * distinct from document/effective time; an absent anchor stays held. These
 * are review candidates, never a current actor's permission grant. */
export function deriveEdielReviewProcessDecision(input:{message:Pick<EdielMessageRow,'id'|'message_received_at'>;reviewIntent?:string;nextAction?:string|null}):EdielReviewProcessDecision{
 const admittedAt=timestamp(input.message.message_received_at)
 const cause=reviewIntents.includes(input.reviewIntent as typeof reviewIntents[number])?input.reviewIntent!:'source_business_review'
 return Object.freeze({version:1,sourceMessageId:input.message.id,cause,responsibility:'tenant_operator',
  summary:admittedAt&&input.nextAction?.trim()?input.nextAction.trim():'Kontrollera källbeslutets mottagningstid och granskningsorsak innan fortsatt åtgärd.',
  timeBasis:Object.freeze({anchor:'actual_inbound_admission',admittedAt,protocolDeadline:null}),
  blockers:Object.freeze(admittedAt?[cause]:['actual_admission_time_required']),candidateActions:Object.freeze(['read_source','review_case'] as const),authorizesProviderEntry:false})
}

/** Persisted display metadata must still agree with the actual tenant source
 * admission. It cannot invent a clock, reference or current actor grant. */
export function readPersistedEdielReviewProcessDecision(value:unknown,input:Parameters<typeof deriveEdielReviewProcessDecision>[0]):EdielReviewProcessDecision|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const row=value as Record<string,unknown>,expected=deriveEdielReviewProcessDecision(input)
 const basis=row.timeBasis
 if(!basis||typeof basis!=='object'||Array.isArray(basis))return null
 const time=basis as Record<string,unknown>
 if(row.version!==1||row.sourceMessageId!==expected.sourceMessageId||row.cause!==expected.cause||row.responsibility!=='tenant_operator'
  ||row.summary!==expected.summary||row.authorizesProviderEntry!==false||time.anchor!=='actual_inbound_admission'
  ||time.admittedAt!==expected.timeBasis.admittedAt||time.protocolDeadline!==null
  ||JSON.stringify(row.blockers)!==JSON.stringify(expected.blockers)||JSON.stringify(row.candidateActions)!==JSON.stringify(expected.candidateActions))return null
 return expected
}
