import {it,expect,vi} from 'vitest'
vi.mock('@/lib/customer-contracts/documents',()=>({}))
const m=vi.hoisted(()=>({reads:[] as string[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{m.reads.push(table);const b:any={select:()=>b,eq:()=>b,maybeSingle:async()=>({data:null,error:null})};return b}}}))
import {ensureWebsitePowerOfAttorney} from '@/lib/website/customerApplicationLegal'
const doc='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const base:any={companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',customerId:'customer-synthetic',contractId:'contract-synthetic',customerSiteId:null,meteringPointId:null,applicationId:'app-synthetic',publicOffer:null,legalVersions:[{id:doc,type:'power_of_attorney',module_key:'power_of_attorney'}],consents:{power_of_attorney:true},rawPayload:{},structuredPoa:{accepted:true,scope:['supplier_switch'],signerName:'Synthetic Signer',signerIdentityNumber:'199001011234',method:'website_acceptance',textVersionId:other}}
it('repair POA helper rejects different valid-looking same-tenant document before reading or writing',async()=>{m.reads=[];await expect(ensureWebsitePowerOfAttorney(base)).rejects.toMatchObject({status:409,code:'power_of_attorney_offer_version_mismatch'});expect(m.reads).toEqual([])})
it('repair helper rejects nonexistent or foreign-tenant canonical document when no expected document available',async()=>{m.reads=[];await expect(ensureWebsitePowerOfAttorney({...base,legalVersions:[]})).rejects.toMatchObject({status:422,code:'power_of_attorney_version_tenant_mismatch'});expect(m.reads).toEqual(['legal_bundle_version_documents','legal_text_versions'])})
