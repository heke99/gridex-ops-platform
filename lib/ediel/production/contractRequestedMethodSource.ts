import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {canonicalProdatMethodChangeTuple} from '@/lib/ediel/rulebook/canonicalEdielFacade'
export type ContractRequestedMethodBasis=Readonly<{status:'authorized';declarationId:string;companyId:string;environment:'test'|'production';contractId:string;contractRevision:string;protectedContractHash:string;agreementSha256:string;customerId:string;siteId:string;meteringPointId:string;pointId:string;identityAgency:'9'|'89';legalActorId:string;legalSenderId:string;legalReceiverId:string;gridArea:string;requestedMethod:string;sourceReference:string;sourceVersion:string;sourceDigest:string}>
export type ContractRequestedMethodHeld={status:'held';missing:string[]}
type Scope={companyId:string;contractId:string;actorUserId:string;environment:'test'|'production'}
/** The requested method is a term of the signed agreement (FINDINGS F46): the
 * native owner derives the declaration from the archived signed PDF, whose bytes
 * must hash to the contract's document_sha256, and the signed price snapshot.
 * Runs before Z03 preparation, outside the render path; any gap leaves the
 * source held. Returns whether a declaration was derived. */
export async function deriveContractRequestedMethodFromSignedAgreement(input:Scope):Promise<boolean>{
 const contract=await (tenantDb(input.companyId).from('customer_contracts') as ReturnType<typeof supabaseService.from>).select('id,document_sha256').eq('id',input.contractId).maybeSingle()
 if(contract.error)throw contract.error
 const hash=contract.data?.document_sha256
 if(typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))return false
 const document=await (tenantDb(input.companyId).from('customer_contract_documents') as ReturnType<typeof supabaseService.from>).select('storage_bucket,storage_path')
  .eq('customer_contract_id',input.contractId).eq('document_type','signed_contract_pdf').eq('document_sha256',hash)
  .not('verified_at','is',null).limit(1).maybeSingle()
 if(document.error)throw document.error
 if(!document.data?.storage_bucket||!document.data.storage_path)return false
 const download=await supabaseService.storage.from(document.data.storage_bucket).download(document.data.storage_path)
 if(download.error||!download.data)return false
 const bytes=Buffer.from(await download.data.arrayBuffer())
 if(createHash('sha256').update(bytes).digest('hex')!==hash)return false
 const{data,error}=await supabaseService.rpc('ediel_derive_contract_requested_method_v1',{p_company_id:input.companyId,p_contract_id:input.contractId,
  p_actor_user_id:input.actorUserId,p_environment:input.environment,p_agreement_original:`\\x${bytes.toString('hex')}`})
 if(error)throw error
 return data?.status==='derived'
}
async function readNative(input:Scope){
 const{data,error}=await supabaseService.rpc('ediel_contract_metering_request_source_v1',{p_company_id:input.companyId,p_contract_id:input.contractId,p_actor_user_id:input.actorUserId,p_environment:input.environment})
 if(error)throw error
 return data
}
/** Selectors do not declare contract terms. This port reads the sole private
 * source owner; missing authentic new-agreement declarations remain held. */
export async function readContractRequestedMethodSource(input:Scope):Promise<ContractRequestedMethodBasis|ContractRequestedMethodHeld>{
 const data=await readNative(input)
 if(!data||!['authorized','held'].includes(data.status))throw Error('contract_requested_method_source_result_invalid')
 if(data.status==='held'){if(!Array.isArray(data.missing)||data.missing.length===0||!data.missing.every((value:unknown)=>typeof value==='string'&&value.length>0))throw Error('contract_requested_method_source_result_invalid');return data}
 if(data.companyId!==input.companyId||data.contractId!==input.contractId||data.environment!==input.environment||![data.declarationId,data.contractId,data.customerId,data.siteId,data.meteringPointId,data.legalActorId].every(isEvidenceUuid)||!['9','89'].includes(data.identityAgency)||!['F','G'].some(subtype=>canonicalProdatMethodChangeTuple(subtype as 'F'|'G').method===data.requestedMethod))throw Error('contract_requested_method_source_scope_invalid')
 return data
}
export function assertContractRequestedMethodSelection(b:ContractRequestedMethodBasis,selection:{companyId:string;contractId:string;customerId:string;siteId:string;meteringPointId:string;environment:'test'|'production'}){
 if(b.companyId!==selection.companyId||b.contractId!==selection.contractId||b.customerId!==selection.customerId||b.siteId!==selection.siteId||b.meteringPointId!==selection.meteringPointId||b.environment!==selection.environment)throw Error('contract_requested_method_selected_scope_mismatch')
}
