type SignatureQueryResult = { data: null; error: null }
type SignatureDocumentResult = { data: { document_sha256: null }; error: null }
type SignatureQuery = {
 select: () => SignatureQuery; update: () => SignatureQuery; eq: () => SignatureQuery; is: () => SignatureQuery
 single: () => Promise<SignatureDocumentResult>; then: (resolve: (result: SignatureQueryResult) => unknown) => unknown
}
import {beforeEach, describe, expect, it, vi} from 'vitest'
const h = vi.hoisted(() => ({ archive:vi.fn(), send:vi.fn(), rpc:vi.fn(), redirect:vi.fn(), committed:false }))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/ediel/retention/customerRecordClasses',()=>({requireContractRecordsAvailable:vi.fn()}))
vi.mock('@/lib/customer-contracts/documents',()=>({archiveSignedCustomerContractPdf:h.archive}))
vi.mock('@/lib/customer-contracts/agreementPdf',()=>({buildAgreementPdfAttachment:()=>({content:Buffer.from('synthetic-pdf').toString('base64'),contentType:'application/pdf',filename:'agreement.pdf'})}))
vi.mock('@/lib/email/sendCompanyEmail',()=>({sendCompanyEmail:h.send}))
vi.mock('@/lib/website/customerApplicationCommunication',()=>({companyEmailContext:vi.fn(async()=>({name:'Tenant A',legalName:'Tenant A AB',snapshotSha256:'c'.repeat(64),supportEmail:'support@example.invalid'}))}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:h.rpc,from:()=>{const q:SignatureQuery={select:()=>q,update:()=>q,eq:()=>q,is:()=>q,single:async()=>({data:{document_sha256:null},error:null}),then:(resolve)=>resolve({data:null,error:null})};return q}}}))
vi.mock('next/headers',()=>({headers:async()=>new Headers()}))
vi.mock('next/navigation',()=>({redirect:h.redirect}))
import {finalizeOnlineContractSignature} from '@/lib/customer-contracts/onlineSigning'
import {signContractAction} from '@/app/sign/contract/[token]/actions'
const receipt={request_id:'request-1',company_id:'tenant-a',customer_id:'customer-1',contract_id:'contract-1',contract_number:'C-1',contract_name:'Variable',contract_type:'spot',status:'signed',signed_at:'2026-10-07T09:00:00Z',expires_at:'2026-10-08T09:00:00Z',channel:'internal',customer_name:'Synthetic',customer_email:'test@example.invalid',company_name:'Tenant A',offer_reference:'offer-1',pricing_snapshot:{},pricing_snapshot_sha256:'a'.repeat(64),legal_versions:[{id:'legal-1',module_key:'terms',title:'Terms',version:'1'}],legal_bundle_version_id:'bundle-1',contract_publication_version_id:'pub-1',price_plan_version_id:'price-1',signature_snapshot_sha256:'b'.repeat(64)}
beforeEach(()=>{vi.clearAllMocks(); h.committed=false;h.rpc.mockImplementation(async()=>{h.committed=true;return{data:receipt,error:null}});h.archive.mockResolvedValue(undefined);h.send.mockResolvedValue({ok:true});vi.spyOn(console,'error').mockImplementation(()=>{})})
describe('OPS secure link confirmation failure gap',()=>{
 it('commits signature but queues no confirmation if archive is temporarily unavailable',async()=>{h.archive.mockRejectedValue(new Error('synthetic_archive_unavailable'));const result=await finalizeOnlineContractSignature({token:'a'.repeat(64)});expect(h.committed).toBe(true);expect(result.receipt.status).toBe('signed');expect(result.deliveryError).toBe('synthetic_archive_unavailable');expect(h.send).not.toHaveBeenCalled();expect(h.rpc).toHaveBeenCalledTimes(1)})
 it('action ignores deliveryError and redirects customer to signed success',async()=>{h.archive.mockRejectedValue(new Error('synthetic_archive_unavailable'));const form=new FormData();form.set('token','a'.repeat(64));await signContractAction(form);expect(h.committed).toBe(true);expect(h.send).not.toHaveBeenCalled();expect(h.redirect).toHaveBeenCalledWith(`/sign/contract/${'a'.repeat(64)}?signed=1`)})
 it('positive control archives before queuing confirmation successfully',async()=>{const result=await finalizeOnlineContractSignature({token:'a'.repeat(64)});expect(result.deliveryError).toBeNull();expect(h.archive).toHaveBeenCalledTimes(1);expect(h.send).toHaveBeenCalledTimes(1);expect(h.send).toHaveBeenCalledWith(expect.objectContaining({companyId:'tenant-a',eventKey:'contract.confirmation_sent',idempotencyKey:'online_signature:request-1:confirmation',attachments:expect.any(Array)}));expect(h.archive.mock.invocationCallOrder[0]).toBeLessThan(h.send.mock.invocationCallOrder[0])})
})
