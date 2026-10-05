'use server'
import {revalidatePath} from 'next/cache'
import {redirect} from 'next/navigation'
import {archiveContractOriginalSource,CONTRACT_ORIGINAL_KINDS,CONTRACT_ORIGINAL_MAX_BYTES,prepareContractOriginalSource,reviewContractOriginalSource,type ContractOriginalKind} from '@/lib/ediel/production/contractOriginalSourceIntake'
const text=(f:FormData,k:string)=>{const all=f.getAll(k);if(all.length!==1||typeof all[0]!=='string')throw Error('contract_original_form_invalid');return all[0]}
const optional=(f:FormData,k:string)=>{const v=text(f,k);return v===''?null:v}
export async function archiveContractOriginalAction(form:FormData){
 const kind=text(form,'kind') as ContractOriginalKind,environment=text(form,'environment');if(!CONTRACT_ORIGINAL_KINDS.includes(kind)||!['test','production'].includes(environment))throw Error('contract_original_form_invalid')
 const read=async(k:string)=>{const all=form.getAll(k);if(all.length!==1||!(all[0] instanceof File)||all[0].size<1||all[0].size>CONTRACT_ORIGINAL_MAX_BYTES)throw Error('contract_original_file_required');return Buffer.from(await all[0].arrayBuffer()).toString('base64')}
 const result=await archiveContractOriginalSource({contractId:text(form,'contractId'),kind,environment:environment as 'test'|'production',agreementBase64:await read('agreement'),sourceBase64:await read('source'),issuerKeyId:optional(form,'issuerKeyId'),representationId:optional(form,'representationId'),signatureHex:optional(form,'signatureHex')})
 revalidatePath('/admin/ediel/contract-originals');redirect('/admin/ediel/contract-originals?artifactId='+encodeURIComponent(result.artifactId))
}
export async function reviewContractOriginalAction(form:FormData){const decision=text(form,'decision');if(!['approve','hold','reject'].includes(decision))throw Error('contract_original_review_invalid');const result=await reviewContractOriginalSource({artifactId:text(form,'artifactId'),sourceHash:text(form,'sourceHash'),agreementHash:text(form,'agreementHash'),claimsHash:text(form,'claimsHash'),decision:decision as 'approve'|'hold'|'reject',reason:text(form,'reason')});revalidatePath('/admin/ediel/contract-originals');redirect('/admin/ediel/contract-originals?artifactId='+encodeURIComponent(result.artifactId))}
export async function prepareContractOriginalAction(form:FormData){const id=text(form,'artifactId');await prepareContractOriginalSource(id);revalidatePath('/admin/ediel');revalidatePath('/admin/ediel/contract-originals');redirect('/admin/ediel/contract-originals?artifactId='+encodeURIComponent(id))}
