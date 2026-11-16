import {createHash} from 'node:crypto'
import {requireAdminActionAccess} from '@/lib/admin/guards'
import {requireCompanyOperationalForWrites} from '@/lib/tenant/governance'
import {createSupabaseServerClient} from '@/lib/supabase/server'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {prepareAndQueueMeteringMethodChangeZ09} from '@/lib/ediel/flows/prodatMeteringMethodChange'
import {prepareAndQueueProductionContractZ09} from '@/lib/ediel/flows/prodatProductionContract'

export const CONTRACT_ORIGINAL_MAX_BYTES=10*1024*1024
export const CONTRACT_ORIGINAL_TOTAL_MAX_BYTES=2*CONTRACT_ORIGINAL_MAX_BYTES
export const CONTRACT_ORIGINAL_KINDS=['masterdata_declaration','contract_requested_method','metering_method_event','production_contract_event'] as const
export type ContractOriginalKind=typeof CONTRACT_ORIGINAL_KINDS[number]
export type ContractOriginalSubmission={contractId:string;environment:'test'|'production';kind:ContractOriginalKind;agreementBase64:string;sourceBase64:string;issuerKeyId:string|null;representationId:string|null;signatureHex:string|null}
export type ContractOriginalArtifact={status:'archived'|'authorized'|'held'|'rejected';artifactId:string;kind:ContractOriginalKind;contractId:string;environment:'test'|'production';sourceId:string|null;sourceHash:string;agreementHash:string;claimsHash:string;nativeScope:Record<string,unknown>;claims:Record<string,unknown>;submittedBy:string;capturedAt:string;missing:string[]}
export type ContractOriginalReview={artifactId:string;sourceHash:string;agreementHash:string;claimsHash:string;decision:'approve'|'hold'|'reject';reason:string}
type ReviewResult={status:'authorized';artifactId:string;kind:ContractOriginalKind;sourceId:string;replay:boolean}|{status:'held'|'rejected';artifactId:string;kind:ContractOriginalKind;missing:string[]}
type Rpc=(name:string,params:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const kind=(v:unknown):v is ContractOriginalKind=>CONTRACT_ORIGINAL_KINDS.includes(v as ContractOriginalKind)
function uuid(v:unknown){if(!isEvidenceUuid(v))throw Error('contract_original_selector_invalid');return v}
function bytes(v:string){const b=Buffer.from(v,'base64');if(b.length<1||b.length>CONTRACT_ORIGINAL_MAX_BYTES||b.toString('base64')!==v)throw Error('contract_original_bytes_invalid');return b}
async function session(write=false,review=false){
 const actor=await requireAdminActionAccess({allOf:[write?'communication.write':'communication.read',write?'customers.write':'customers.read',write?'contracts.write':'contracts.read',...(review?['ediel.source.review']:[])]})
 if(!actor.companyId)throw Error('contract_original_current_tenant_required')
 if(write)await requireCompanyOperationalForWrites(actor.companyId)
 const client=await createSupabaseServerClient()
 return {companyId:actor.companyId,actorUserId:actor.userId,rpc:client.rpc.bind(client) as unknown as Rpc}
}
async function invoke(context:Awaited<ReturnType<typeof session>>,name:string,params:Record<string,unknown>){const{data,error}=await context.rpc(name,{p_company_id:context.companyId,p_actor_user_id:context.actorUserId,...params});if(error)throw error;return data}
function artifact(data:unknown,expectedId?:string):ContractOriginalArtifact{const r=record(data);if(!r||!['archived','authorized','held','rejected'].includes(String(r.status))||!isEvidenceUuid(r.artifactId)||expectedId&&r.artifactId!==expectedId||!kind(r.kind)||!hash(r.sourceHash)||!hash(r.agreementHash)||!hash(r.claimsHash)||!Array.isArray(r.missing)||r.missing.some(x=>typeof x!=='string')||!record(r.nativeScope)||!record(r.claims)||r.status==='authorized'&&!isEvidenceUuid(r.sourceId)||'agreementBase64'in r||'sourceBase64'in r)throw Error('contract_original_read_result_invalid');return r as unknown as ContractOriginalArtifact}
export async function contractOriginalScope(input:{contractId:string;environment:'test'|'production';kind:ContractOriginalKind}){uuid(input.contractId);if(!kind(input.kind)||!['test','production'].includes(input.environment))throw Error('contract_original_scope_invalid');const c=await session(true),r=record(await invoke(c,'ediel_contract_intake_scope_v1',{p_contract_id:input.contractId,p_environment:input.environment,p_kind:input.kind}));if(!r||r.companyId!==c.companyId||r.contractId!==input.contractId||r.kind!==input.kind)throw Error('contract_original_scope_result_invalid');return r}
export async function archiveContractOriginalSource(input:ContractOriginalSubmission){
 uuid(input.contractId);if(!kind(input.kind)||!['test','production'].includes(input.environment)||input.issuerKeyId!==null&&!isEvidenceUuid(input.issuerKeyId)||input.representationId!==null&&!isEvidenceUuid(input.representationId)||input.signatureHex!==null&&!hash(input.signatureHex))throw Error('contract_original_submission_invalid')
 const c=await session(true),pdf=bytes(input.agreementBase64),original=bytes(input.sourceBase64)
 if(pdf.length+original.length>CONTRACT_ORIGINAL_TOTAL_MAX_BYTES)throw Error('contract_original_total_bytes_invalid')
 const r=record(await invoke(c,'ediel_archive_contract_original_source_v1',{p_contract_id:input.contractId,p_environment:input.environment,p_kind:input.kind,p_submission:{agreementBase64:input.agreementBase64,sourceBase64:input.sourceBase64,issuerKeyId:input.issuerKeyId,representationId:input.representationId,signatureHex:input.signatureHex}}))
 if(!r||r.status!=='archived'||!isEvidenceUuid(r.artifactId)||r.kind!==input.kind||r.sourceHash!==createHash('sha256').update(original).digest('hex')||r.agreementHash!==createHash('sha256').update(pdf).digest('hex')||!hash(r.claimsHash)||!Array.isArray(r.missing))throw Error('contract_original_archive_result_invalid')
 return r as unknown as {status:'archived';artifactId:string;kind:ContractOriginalKind;sourceHash:string;agreementHash:string;claimsHash:string;missing:string[]}
}
export async function readContractOriginalSource(artifactId:string){uuid(artifactId);return artifact(await invoke(await session(),'ediel_read_contract_original_source_v1',{p_artifact_id:artifactId}),artifactId)}
export async function listContractOriginalSources(contractId:string){uuid(contractId);const data=await invoke(await session(),'ediel_list_contract_original_sources_v1',{p_contract_id:contractId});if(!Array.isArray(data))throw Error('contract_original_list_result_invalid');return data.map(v=>artifact(v))}
export async function reviewContractOriginalSource(input:ContractOriginalReview):Promise<ReviewResult>{uuid(input.artifactId);if(!hash(input.sourceHash)||!hash(input.agreementHash)||!hash(input.claimsHash)||!['approve','hold','reject'].includes(input.decision)||input.reason.length<1||input.reason.length>4000)throw Error('contract_original_review_invalid');const{artifactId,...review}=input,r=record(await invoke(await session(true,true),'ediel_review_contract_original_source_v1',{p_artifact_id:artifactId,p_review:review}));if(!r||r.artifactId!==artifactId||!kind(r.kind)||r.status==='authorized'&&!isEvidenceUuid(r.sourceId)||!['authorized','held','rejected'].includes(String(r.status))||r.status!=='authorized'&&!Array.isArray(r.missing))throw Error('contract_original_review_result_invalid');return r as unknown as ReviewResult}
/** Re-read a native qualified source; the established producer reserves and
 * checks current source policy again before durable intent/message creation. */
export async function prepareContractOriginalSource(artifactId:string){uuid(artifactId);const c=await session(true),source=artifact(await invoke(c,'ediel_read_contract_original_source_v1',{p_artifact_id:artifactId}),artifactId);if(source.status!=='authorized'||!source.sourceId)return{status:'held' as const,missing:source.missing};if(source.kind==='metering_method_event')return prepareAndQueueMeteringMethodChangeZ09({companyId:c.companyId,actorUserId:c.actorUserId,eventId:source.sourceId});if(source.kind==='production_contract_event')return prepareAndQueueProductionContractZ09({companyId:c.companyId,actorUserId:c.actorUserId,eventId:source.sourceId});return{status:'available' as const,sourceId:source.sourceId,consumer:source.kind==='masterdata_declaration'?'customer_masterdata':'contract_requested_metering_method'} }
