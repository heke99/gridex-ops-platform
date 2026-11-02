import {beforeEach,expect,it,vi} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {readAmendmentSigningContext} from '@/lib/customer-contracts/amendmentInput'
import {buildAgreementPdfBuffer} from '@/lib/customer-contracts/agreementPdf'
const h=vi.hoisted(()=>({rpc:vi.fn(),receipt:{} as Record<string,unknown>}))
vi.mock('server-only',()=>({}))
vi.mock('next/headers',()=>({headers:async()=>new Headers({'user-agent':'Synthetic Customer Browser'})}))
vi.mock('next/navigation',()=>({redirect:(location:string)=>{throw new Error('REDIRECT:'+location)},unstable_rethrow:()=>{}}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:h.rpc}}))
vi.mock('@/lib/env/supabaseServer',()=>({getSupabaseServiceEnv:()=>({url:'https://synthetic.invalid',serviceRoleKey:'DECLARED_TEST_ONLY'})}))
vi.mock('@/lib/ediel/retention/customerRecordClasses',()=>({requireContractRecordsAvailable:vi.fn()}))
vi.mock('@/lib/customer-contracts/confirmationDelivery',()=>({attemptContractConfirmationDelivery:vi.fn(async()=>({error:null})),loadContractConfirmationState:vi.fn(async()=>null)}))
vi.mock('@/lib/email/sendCompanyEmail',()=>({sendCompanyEmail:vi.fn()}))
vi.mock('@/lib/email/emailOutbox',()=>({sendContractSignatureEmailNow:vi.fn()}))
vi.mock('@/lib/customer-contracts/documents',()=>({archiveSignedCustomerContractPdf:vi.fn(),downloadAndVerifyCustomerContractDocument:vi.fn(),CUSTOMER_CONTRACT_DOCUMENT_BUCKET:'private-test'}))
vi.mock('@/lib/customer-contracts/onlineSigning',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/customer-contracts/onlineSigning')>()
 return {...actual,loadOnlineSignatureReceipt:vi.fn(async()=>h.receipt),loadOnlineSignaturePoaTerms:vi.fn(async()=>({available:true,required:false,legalVersions:[]}))}
})
vi.mock('@/app/sign/contract/[token]/actions',()=>({signContractAction:vi.fn(async()=>{})}))
vi.mock('@/app/sign/contract/[token]/SignSubmitButton',()=>({default:()=>createElement('button',null,'Signera')}))
const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function context(){return {schema:'gridex_signed_contract_amendment_v1' as const,proposalId:id(1),proposalSHA256:'b'.repeat(64),
 predecessorContractId:id(2),successorContractId:id(3),effectiveFrom:'2026-12-01',predecessorReference:'AVT-OLD-01',
 predecessorSignatureSHA256:'c'.repeat(64),predecessorPriceSnapshotId:id(4),successorPriceSnapshotId:id(5),
 predecessorPriceSHA256:'d'.repeat(64),successorPriceSHA256:'e'.repeat(64),predecessorTermsSHA256:'f'.repeat(64),successorTermsSHA256:'a'.repeat(64)}}
const digest='1'.repeat(64)
const expected={contractId:id(3),pricingSnapshotSHA256:'e'.repeat(64)}
function rawReceipt(){return {request_id:id(6),company_id:id(7),customer_id:id(8),contract_id:id(3),contract_number:'AVT-NEW-02',
 contract_name:'Nya villkor',contract_type:'variable_monthly',status:'pending_signature',signed_at:null,used_at:null,expires_at:'2099-01-01T00:00:00Z',channel:'internal',
 customer_name:'Synthetic Customer',customer_email:'synthetic@example.invalid',customer_number:'SYNTHETIC-1',company_name:'Synthetic Company',offer_reference:'NEW-OFFER',
 starts_at:'2026-12-01',ends_at:null,price_area:'SE3',pricing_snapshot:{},pricing_snapshot_sha256:'e'.repeat(64),legal_versions:[],
 legal_bundle_version_id:id(9),contract_publication_version_id:id(10),price_plan_version_id:id(11),signature_snapshot_sha256:null,
 amendment_context:context(),amendment_context_sha256:digest}}
beforeEach(()=>{h.rpc.mockReset();h.receipt=rawReceipt();h.rpc.mockResolvedValue({data:{...rawReceipt(),status:'signed',signed_at:'2026-11-02T12:00:00Z',used_at:'2026-11-02T12:00:00Z',signature_snapshot_sha256:'2'.repeat(64)},error:null})})
it('accepts only complete context bound to this successor and this actual pricing snapshot',()=>{
 expect(readAmendmentSigningContext(context(),digest,expected)).toEqual({context:context(),sha256:digest})
 for(const patch of [{successorContractId:id(99)},{successorPriceSHA256:'0'.repeat(64)},{schema:'unknown'},{effectiveFrom:'2027-02-29'},{state:'ACCEPTED'}]) {
  expect(()=>readAmendmentSigningContext({...context(),...patch},digest,expected)).toThrow('amendment_signing_context_invalid')
 }
 expect(()=>readAmendmentSigningContext(context(),null,expected)).toThrow('amendment_signing_context_invalid')
 expect(readAmendmentSigningContext(undefined,undefined,expected)).toBeNull()
})
it('shows predecessor, new effective date and separate required acknowledgement on the actual signing page',async()=>{
 const {default:Page}=await import('@/app/sign/contract/[token]/page')
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({token:'3'.repeat(64)}),searchParams:Promise.resolve({})}))
 expect(html).toContain('AVT-OLD-01')
 expect(html).toContain('1 december 2026')
 expect(html.match(/<input[^>]*name="amendment_accepted"[^>]*>/)?.[0]).toContain('required=""')
 expect(html).toContain('name="amendment_context_sha256"')
 expect(html).toContain(digest)
})
it('does not add amendment consent to ordinary unrelated contract pages',async()=>{
 delete h.receipt.amendment_context;delete h.receipt.amendment_context_sha256
 const {default:Page}=await import('@/app/sign/contract/[token]/page')
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({token:'3'.repeat(64)}),searchParams:Promise.resolve({})}))
 expect(html).not.toContain('name="amendment_accepted"')
})
it('renders the same accepted predecessor/date in the ordinary archived PDF without internal hash dumps',()=>{
 const pdf=buildAgreementPdfBuffer({companyName:'Synthetic Company',customerName:'Synthetic Customer',customerNumber:'SYNTHETIC-1',contractNumber:'AVT-NEW-02',contractName:'Nya villkor',signedAt:'2026-11-02T12:00:00Z',startsAt:'2026-12-01',offerReference:'NEW-OFFER',legalVersions:[],amendment:{context:context(),sha256:digest}}).toString('latin1')
 expect(pdf).toContain('AVT-OLD-01');expect(pdf).toContain('1 december 2026');expect(pdf).toContain('AVT-NEW-02')
 expect(pdf).not.toContain(digest);expect(pdf).not.toContain(context().proposalSHA256)
})
it('sends explicit customer context to the amendment wrapper and preserves the normal signing arguments',async()=>{
 const {finalizeOnlineContractSignature}=await import('@/lib/customer-contracts/onlineSigning')
 await finalizeOnlineContractSignature({token:'3'.repeat(64),amendmentContextSHA256:digest,amendmentAccepted:true,powerOfAttorneyAccepted:false})
 expect(h.rpc).toHaveBeenCalledExactlyOnceWith('gridex_finalize_customer_contract_amendment_signature_v1',expect.objectContaining({p_amendment_context_sha256:digest,p_amendment_accepted:true,p_poa_accepted:false}))
})
it('never signs a presented amendment context when the separate customer acknowledgement is missing',async()=>{
 const {finalizeOnlineContractSignature}=await import('@/lib/customer-contracts/onlineSigning')
 await expect(finalizeOnlineContractSignature({token:'3'.repeat(64),amendmentContextSHA256:digest,amendmentAccepted:false})).rejects.toThrow('amendment_customer_acknowledgement_required')
 expect(h.rpc).not.toHaveBeenCalled()
})

it('the actual public form action forwards the separate context/consent fields to the real signing helper',async()=>{
 const {signContractAction}=await vi.importActual<typeof import('@/app/sign/contract/[token]/actions')>('@/app/sign/contract/[token]/actions')
 const form=new FormData();form.set('token','3'.repeat(64));form.set('amendment_context_sha256',digest);form.set('amendment_accepted','yes')
 await expect(signContractAction(form)).rejects.toThrow('REDIRECT:/sign/contract/'+'3'.repeat(64)+'?signed=1')
 expect(h.rpc).toHaveBeenCalledExactlyOnceWith('gridex_finalize_customer_contract_amendment_signature_v1',expect.objectContaining({p_amendment_context_sha256:digest,p_amendment_accepted:true}))
})
