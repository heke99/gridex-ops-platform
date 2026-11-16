import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalInheritedAckPolicy,type CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'

export type SourceBoundAckRulePackEvidence=Readonly<{
 rulePackId:string;messageProfileId:string;profileKey:string;version:string;sourceHash:string;snapshot:Readonly<Record<string,unknown>>
}>
declare const outboundAckQualificationBrand: unique symbol
export type SourceQualifiedOutboundAck=Readonly<{
 sourceMessage:EdielMessageRow;evidence:SourceBoundAckRulePackEvidence;[outboundAckQualificationBrand]:true
}>
const sourceOwnerReads=new WeakSet<object>()
const qualifiedOutboundSources=new WeakMap<SourceQualifiedOutboundAck,{companyId:string;environment:string}>()
function freezeJson<T>(value:T):T {
 if(value&&typeof value==='object'){for(const child of Object.values(value))freezeJson(child);Object.freeze(value)}
 return value
}
function record(value:unknown):Record<string,unknown> | null{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null}
function uuid(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
/** The private source-match/capture authority returns the actual unique sent
 * original and its immutable named pack/checksum. Row JSON, current guide
 * re-selection and a caller-supplied source pointer never provide this basis. */
export async function readSourceBoundAckRulePackEvidence(message:EdielMessageRow):Promise<{sourceMessage:EdielMessageRow;evidence:SourceBoundAckRulePackEvidence}>{
 if(!uuid(message.id)||!uuid(message.company_id)||message.direction!=='inbound'||!['test','production'].includes(message.environment)||!message.raw_payload)throw new Error('ack_source_scope_unavailable')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:'gridex_read_inbound_ack_source_v1',args:{p_company_id:string;p_environment:string;p_ack_message_id:string})=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('gridex_read_inbound_ack_source_v1',{p_company_id:message.company_id,p_environment:message.environment,p_ack_message_id:message.id})
 if(error)throw error
 const result=record(data),source=record(result?.sourceMessage),pack=record(result?.sourceRulePackEvidence),snapshot=record(pack?.snapshot)
 if(result?.version!==1||!source||!uuid(source.id)||source.company_id!==message.company_id||source.environment!==message.environment||source.direction!=='outbound'||typeof source.raw_payload!=='string'||!source.raw_payload||!source.message_sent_at||!source.immutable_rendered_at)throw new Error('ack_actual_original_unavailable')
 if(!pack||!uuid(pack.rulePackId)||!uuid(pack.messageProfileId)||typeof pack.profileKey!=='string'||!pack.profileKey||typeof pack.version!=='string'||!pack.version||typeof pack.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(pack.sourceHash)||!snapshot)throw new Error('historical_rule_pack_basis_unavailable')
 const qualification=freezeJson({sourceMessage:structuredClone(source) as unknown as EdielMessageRow,evidence:structuredClone(pack) as SourceBoundAckRulePackEvidence})
 sourceOwnerReads.add(qualification);return qualification
}
function qualifyOutboundSource(data:unknown,companyId:string,environment:string):SourceQualifiedOutboundAck {
 const result=record(data),source=record(result?.sourceMessage),pack=record(result?.sourceRulePackEvidence),snapshot=record(pack?.snapshot)
 if(result?.version!==1||!source||!uuid(source.id)||source.company_id!==companyId||source.environment!==environment||source.direction!=='inbound'||source.message_standard!=='edifact'||typeof source.raw_payload!=='string'||!source.raw_payload)throw new Error('ack_actual_original_unavailable')
 if(!pack||!uuid(pack.rulePackId)||!uuid(pack.messageProfileId)||typeof pack.profileKey!=='string'||!pack.profileKey||typeof pack.version!=='string'||!pack.version||typeof pack.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(pack.sourceHash)||!snapshot
  ||snapshot.profileKey!==pack.profileKey||snapshot.profileVersionId!==pack.messageProfileId||snapshot.version!==pack.version||snapshot.checksum!==pack.sourceHash)throw new Error('historical_rule_pack_basis_unavailable')
 const qualification=freezeJson({sourceMessage:structuredClone(source) as unknown as EdielMessageRow,evidence:structuredClone(pack) as SourceBoundAckRulePackEvidence}) as SourceQualifiedOutboundAck
 qualifiedOutboundSources.set(qualification,{companyId,environment});sourceOwnerReads.add(qualification)
 return qualification
}
/** Pre-persistence kernel port. The protected RPC locks and returns the actual
 * inbound original together with its immutable basis. Reads never backfill,
 * choose today's pack or accept a caller's parsed source snapshot. */
export async function readSourceBoundOutboundAckRulePackEvidence(input:{companyId:string;environment:string;sourceMessageId:string}):Promise<SourceQualifiedOutboundAck> {
 if(!uuid(input.companyId)||!uuid(input.sourceMessageId)||!['test','production'].includes(input.environment))throw new Error('ack_source_scope_unavailable')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:'ediel_read_source_rule_pack_basis_v1',args:{p_company_id:string;p_message_id:string})=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_source_rule_pack_basis_v1',{p_company_id:input.companyId,p_message_id:input.sourceMessageId})
 if(error)throw error
 const qualification=qualifyOutboundSource(data,input.companyId,input.environment)
 if(qualification.sourceMessage.id!==input.sourceMessageId)throw new Error('ack_actual_original_unavailable')
 return qualification
}
/** Persisted sends resolve the original from the ACTUAL scoped ACK row inside
 * the same protected read, never from a caller's mutable related-message field. */
export async function readPersistedOutboundAckRulePackEvidence(message:EdielMessageRow):Promise<SourceQualifiedOutboundAck> {
 if(!uuid(message.id)||!uuid(message.company_id)||message.direction!=='outbound'||!['test','production'].includes(message.environment)||!message.raw_payload)throw new Error('ack_source_scope_unavailable')
 const rpc=supabaseService.rpc.bind(supabaseService) as unknown as (name:'ediel_read_outbound_ack_source_rule_pack_basis_v1',args:{p_company_id:string;p_environment:string;p_ack_message_id:string})=>PromiseLike<{data:unknown;error:unknown}>
 const {data,error}=await rpc('ediel_read_outbound_ack_source_rule_pack_basis_v1',{p_company_id:message.company_id,p_environment:message.environment,p_ack_message_id:message.id})
 if(error)throw error
 const result=record(data),actual=record(result?.ackMessage)
 if(!actual||actual.id!==message.id||actual.company_id!==message.company_id||actual.environment!==message.environment||actual.direction!=='outbound'||actual.raw_payload!==message.raw_payload)throw new Error('ack_actual_output_scope_mismatch')
 const qualification=qualifyOutboundSource(data,message.company_id,message.environment)
 if(actual.related_message_id!==qualification.sourceMessage.id)throw new Error('ack_actual_original_unavailable')
 return qualification
}
/** Only the exact returned capability is accepted. JSON copies lose this port;
 * the final wire must still pass the one canonical guide against this original. */
export function sourceQualifiedOutboundAck(input:{qualification?:SourceQualifiedOutboundAck|null;companyId?:string|null;environment?:string|null}):SourceQualifiedOutboundAck|null {
 const basis=input.qualification?qualifiedOutboundSources.get(input.qualification):null
 return basis&&basis.companyId===input.companyId&&basis.environment===input.environment?input.qualification!:null
}

/** The actual native-read object is the only source of inherited guide scope.
 * JSON snapshots, mutable row projections and copies cannot mint this port. */
export function sourceBoundAckCanonicalPolicy(input:{qualification:{sourceMessage:EdielMessageRow;evidence:SourceBoundAckRulePackEvidence};policy:CanonicalEdielPolicy}):CanonicalEdielPolicy{
 const q=input.qualification
 if(!sourceOwnerReads.has(q))throw new Error('ack_source_owner_qualification_required')
 const pack=record(q.evidence.snapshot.rulePack),profile=record(q.evidence.snapshot.messageProfile),sources=q.evidence.snapshot.guideSources
 if(!pack||!profile||!Array.isArray(sources)||pack.id!==q.evidence.rulePackId||profile.id!==q.evidence.messageProfileId||profile.rule_pack_id!==pack.id
  ||pack.source_hash!==q.evidence.sourceHash||typeof pack.family!=='string'||typeof pack.guide_version!=='string'||typeof pack.guide_revision!=='string')throw new Error('historical_rule_pack_guide_scope_unavailable')
 const raw=tokenizeEdifact(q.sourceMessage.raw_payload),unh=raw.segments.filter(s=>s.tag==='UNH'),bgm=raw.segments.filter(s=>s.tag==='BGM')
 const physicalFamily=segmentComposite(unh[0],2,raw.una)[0],originalCode=segmentComposite(bgm[0],1,raw.una)[0]
 if(unh.length!==1||(input.policy.family!=='CONTRL'&&(bgm.length!==1||physicalFamily!==pack.family))||(input.policy.family==='UTILTS_ERR'&&originalCode==='ERR'))throw new Error('canonical_ack_original_family_mismatch')
 return resolveCanonicalInheritedAckPolicy({policy:input.policy,originalFamily:pack.family,guideVersion:pack.guide_version,guideRevision:pack.guide_revision,originalVersion:q.evidence.version,originalCode})
}
