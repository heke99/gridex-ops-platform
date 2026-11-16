import {supabaseService} from '@/lib/supabase/service'
import {assertEdielSmtpReadiness} from '@/lib/ediel/mailReadiness'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {technicalSyntaxAckQualification,type TechnicalSyntaxAckEvidence} from './technicalSyntaxAuthority'
import {prodatCommonHeaderRejectionQualification,commonHeaderReplyApplicationReference,type ProdatCommonHeaderRejectionEvidence} from './prodatCommonHeaderRejectionAuthority'
import type {TechnicalSyntaxAckRoute} from './technicalSyntaxRoute'

export type ProdatCommonHeaderNegativeAckRoute=Readonly<Omit<TechnicalSyntaxAckRoute,'kind'> & {kind:'prodat_common_header_negative_ack_route';smtpHost:string;smtpPort:number}>
const routes=new WeakSet<object>()
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value)}return value}
const equal=(a:readonly string[],b:readonly string[])=>JSON.stringify(a)===JSON.stringify(b)
const email=(value:unknown):value is string=>typeof value==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
/** Source-only common rejection uses its own APERAK route, while the separate
 * committed syntax owner supplies the exact original technical envelope. */
export async function readProdatCommonHeaderNegativeAckRoute(input:{evidence:ProdatCommonHeaderRejectionEvidence;technicalEvidence:TechnicalSyntaxAckEvidence;actorUserId:string}):Promise<ProdatCommonHeaderNegativeAckRoute>{
 const e=prodatCommonHeaderRejectionQualification({evidence:input.evidence,companyId:input.evidence.companyId,environment:input.evidence.environment})
 const t=technicalSyntaxAckQualification({evidence:input.technicalEvidence,companyId:input.evidence.companyId,environment:input.evidence.environment,sourceMessageId:input.evidence.sourceMessageId})
 if(!e||!t||t.syntaxDecision!=='accepted'||e.sourceHash!==t.sourceHash||e.syntaxAssessmentId!==t.syntaxAssessmentId
  ||!equal(e.identities.transport.senderComponents,t.originalUNB.sender)||!equal(e.identities.transport.receiverComponents,t.originalUNB.receiver)
  ||(e.identities.applicationReference??'')!==t.originalUNB.applicationReference)throw Error('ediel_common_header_route_basis_required')
 await assertEdielTenantActor({companyId:e.companyId,actorUserId:input.actorUserId,permissionAnyOf:e.environment==='test'?['communication.write','ediel_testing.write']:['communication.write']})
 const smtp=assertEdielSmtpReadiness()
 const {data,error}=await supabaseService.rpc('ediel_read_common_header_negative_ack_route_v1',{p_company_id:e.companyId,p_actor_user_id:input.actorUserId,p_source_message_id:e.sourceMessageId,p_smtp_from:smtp.from,p_smtp_host:smtp.host,p_smtp_port:smtp.port})
 if(error)throw Error('ediel_common_header_negative_route_unavailable',{cause:error})
 const r=data as ProdatCommonHeaderNegativeAckRoute|null,u=t.originalUNB
 if(!r||r.kind!=='prodat_common_header_negative_ack_route'||r.companyId!==e.companyId||r.environment!==e.environment||r.sourceMessageId!==e.sourceMessageId||r.sourceHash!==e.sourceHash||r.authorizesBusinessEffect!==false
  ||r.senderEdielId!==u.receiver[0]||r.senderQualifier!==(u.receiver[1]||null)||r.senderSubAddress!==(u.receiver[2]||null)||r.receiverEdielId!==u.sender[0]||r.receiverQualifier!==(u.sender[1]||null)||r.receiverSubAddress!==(u.sender[2]||null)
  ||r.receiverMessageSubAddress!==r.receiverSubAddress||r.applicationReference!==commonHeaderReplyApplicationReference(e)||r.senderEmail!==smtp.from||r.mailbox!==smtp.from||r.smtpHost!==smtp.host||r.smtpPort!==smtp.port||!email(r.receiverEmail)
  ||r.route?.company_id!==e.companyId||r.routeRuntime?.company_id!==e.companyId||r.routeRuntime?.communication_route_id!==r.route.id||r.routeRuntime.environment!==e.environment||!r.route.is_active||!r.routeRuntime.is_enabled
  ||(r.routeRuntime.message_family&&r.routeRuntime.message_family!=='APERAK')||(r.routeRuntime.business_code&&r.routeRuntime.business_code!=='APERAK'))throw Error('ediel_common_header_negative_route_scope_mismatch')
 const qualified=freeze(r);routes.add(qualified);return qualified
}
export function prodatCommonHeaderNegativeAckRouteQualification(value:unknown,evidence:ProdatCommonHeaderRejectionEvidence):ProdatCommonHeaderNegativeAckRoute|null{
 if(!prodatCommonHeaderRejectionQualification({evidence,companyId:evidence.companyId,environment:evidence.environment})||!value||typeof value!=='object'||!routes.has(value))return null
 const r=value as ProdatCommonHeaderNegativeAckRoute
 return r.companyId===evidence.companyId&&r.environment===evidence.environment&&r.sourceMessageId===evidence.sourceMessageId&&r.sourceHash===evidence.sourceHash?r:null
}
