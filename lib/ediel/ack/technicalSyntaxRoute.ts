import {supabaseService} from '@/lib/supabase/service'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {technicalSyntaxAckQualification,type TechnicalSyntaxAckEvidence} from './technicalSyntaxAuthority'
import type {CommunicationRouteRow} from '@/lib/cis/types'
import type {EdielRouteRuntimeRow} from '@/lib/ediel/config'

export type TechnicalSyntaxAckRoute=Readonly<{
 kind:'technical_syntax_ack_route';companyId:string;environment:'test'|'production';sourceMessageId:string;sourceHash:string
 route:CommunicationRouteRow;routeRuntime:EdielRouteRuntimeRow
 senderEdielId:string;senderQualifier:string|null;senderSubAddress:string|null
 receiverEdielId:string;receiverQualifier:string|null;receiverSubAddress:string|null;receiverMessageSubAddress:string|null
 applicationReference:string;senderEmail:string;receiverEmail:string;mailbox:string;routeKey:string
 authorizesBusinessEffect:false
}>
const routes=new WeakSet<object>()
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}
const email=(value:unknown):value is string=>typeof value==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)

/** A prescribed syntax reply needs a configured technical route, not legal
 * role settings, the old message's email fields or a default APP. The actual
 * shared SMTP owner supplies its current account; secrets never enter the DTO. */
export async function readTechnicalSyntaxAckRoute(input:{evidence:TechnicalSyntaxAckEvidence;actorUserId:string}):Promise<TechnicalSyntaxAckRoute>{
 const e=technicalSyntaxAckQualification({evidence:input.evidence,companyId:input.evidence.companyId,environment:input.evidence.environment})
 if(!e)throw new Error('ediel_technical_ack_basis_required')
 await assertEdielTenantActor({companyId:e.companyId,actorUserId:input.actorUserId,permissionAnyOf:e.environment==='test'?['communication.write','ediel_testing.write']:['communication.write']})
 const smtp=assertEdielSmtpReadiness()
 if(!email(smtp.from))throw new Error('ediel_technical_ack_smtp_account_unqualified')
 const {data,error}=await supabaseService.rpc('ediel_read_technical_syntax_ack_route_v1',{
  p_company_id:e.companyId,p_actor_user_id:input.actorUserId,p_source_message_id:e.sourceMessageId,
  p_smtp_from:smtp.from,p_smtp_host:smtp.host,p_smtp_port:smtp.port,
 })
 if(error)throw new Error('ediel_technical_ack_route_unavailable',{cause:error})
 const value=data as TechnicalSyntaxAckRoute|null
 const original=e.originalUNB
 if(!value||value.kind!=='technical_syntax_ack_route'||value.companyId!==e.companyId||value.environment!==e.environment
  ||value.sourceMessageId!==e.sourceMessageId||value.sourceHash!==e.sourceHash||value.authorizesBusinessEffect!==false
  ||value.senderEdielId!==original.receiver[0]||value.senderQualifier!==(original.receiver[1]||null)||value.senderSubAddress!==(original.receiver[2]||null)
  ||value.receiverEdielId!==original.sender[0]||value.receiverQualifier!==(original.sender[1]||null)||value.receiverSubAddress!==(original.sender[2]||null)
  ||value.receiverMessageSubAddress!==value.receiverSubAddress||value.applicationReference!==original.applicationReference
  ||value.senderEmail!==smtp.from||value.mailbox!==smtp.from||!email(value.receiverEmail)
  ||value.route?.company_id!==e.companyId||value.routeRuntime?.company_id!==e.companyId
  ||value.routeRuntime?.communication_route_id!==value.route.id||value.routeRuntime.environment!==e.environment
  ||!value.route.is_active||!value.routeRuntime.is_enabled)throw new Error('ediel_technical_ack_route_scope_mismatch')
 const qualified=freeze(value);routes.add(qualified);return qualified
}

/** Exact server-read route capability; copies cannot become transport proof. */
export function technicalSyntaxAckRouteQualification(value:unknown,evidence:TechnicalSyntaxAckEvidence):TechnicalSyntaxAckRoute|null{
 if(!technicalSyntaxAckQualification({evidence,companyId:evidence.companyId,environment:evidence.environment})||!value||typeof value!=='object'||!routes.has(value))return null
 const route=value as TechnicalSyntaxAckRoute
 return route.companyId===evidence.companyId&&route.environment===evidence.environment&&route.sourceMessageId===evidence.sourceMessageId&&route.sourceHash===evidence.sourceHash?route:null
}
