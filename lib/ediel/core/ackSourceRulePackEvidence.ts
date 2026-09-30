import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type SourceBoundAckRulePackEvidence=Readonly<{
 rulePackId:string;messageProfileId:string;profileKey:string;version:string;sourceHash:string;snapshot:Readonly<Record<string,unknown>>
}>
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
 return {sourceMessage:source as unknown as EdielMessageRow,evidence:Object.freeze({rulePackId:pack.rulePackId,messageProfileId:pack.messageProfileId,profileKey:pack.profileKey,version:pack.version,sourceHash:pack.sourceHash,snapshot:Object.freeze({...snapshot})})}
}
