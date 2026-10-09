import { it,expect,vi,beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
type ContactChangeModule = typeof import('@/lib/customer-service/contactChangeTransaction')
type StrictRequestModule = typeof import('@/lib/api/strictRequest')
type CustomerFixture = {id:string;customer_type:string;email:string;updated_at:string}
type CustomerSiteFixture = {
 id:string;street:string;postalCode:string;postal_code:string;city:string;country:string;
 address_hash:string|null;care_of?:string;address_source?:string;address_verified_at?:string;
 address_verification_method?:string
}
type ProfileQueryResult = {data:unknown;error:null}
type ProfileChainMethod = 'select'|'eq'|'single'|'maybeSingle'
type ProfileQuery = PromiseLike<ProfileQueryResult> & {
 update:(patch:Record<string,unknown>)=>ProfileQuery;insert:()=>ProfileQuery
} & Partial<Record<ProfileChainMethod,()=>ProfileQuery>>
const m=vi.hoisted(()=>({customer:{id:'customer',customer_type:'private',email:'old@example.test',updated_at:'2026-10-01T00:00:00Z'} as CustomerFixture,site:null as CustomerSiteFixture|null,updates:[] as Record<string,unknown>[],rpc:vi.fn(),completion:0}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:m.rpc,from(table:string){
 let action='read',patch:Record<string,unknown>={}
 const run=async()=>{
  if(table==='customers')return {data:m.customer,error:null}
  if(table==='customer_sites'){ if(action==='update'){m.updates.push(patch);Object.assign(m.site as CustomerSiteFixture,patch)} return {data:m.site,error:null} }
  if(table==='customer_portal_completions'){m.completion++;return {data:{id:'completion',completion_reference:'completion_public',status:'accepted',created_at:'2026-10-07'},error:null}}
  if(table==='customer_site_address_conflicts')return {data:null,error:null}
  throw Error(table)
 }
 const b:ProfileQuery={then:(a,z)=>run().then(a,z),update:(p)=>{action='update';patch=p;return b},insert:()=>b}
 for(const k of ['select','eq','single','maybeSingle'] as const)b[k]=()=>b
 return b
}}}))
vi.mock('@/lib/customer-service/contactChangeTransaction',async(orig)=>({...await orig<ContactChangeModule>(),applyCustomerContactChange:vi.fn(async(i:Parameters<ContactChangeModule['applyCustomerContactChange']>[0])=>{Object.assign(m.customer,i.customerPatch);return {changed:true}})}))
vi.mock('@/lib/api/strictRequest',async(orig)=>({...await orig<StrictRequestModule>(),executeIdempotentPortalWrite:async(i:Parameters<StrictRequestModule['executeIdempotentPortalWrite']>[0])=>({...await i.execute(),replayed:false})}))
vi.mock('@/lib/integrations/apiAuth',async(orig)=>({...await orig<typeof import('@/lib/integrations/apiAuth')>(),logIntegrationApiRequest:vi.fn(),currentIntegrationApiResponseContext:()=>null}))
vi.mock('@/lib/customer-portal/externalApi',async(orig)=>({...await orig<typeof import('@/lib/customer-portal/externalApi')>(),requireCustomerPortalApiContext:async()=>({ok:true,client:{id:'client',company_id:'company',scopes:['customer_contact.write','customer_facility_data.write']},identity:{id:'identity',customer_id:'customer'},startedAt:Date.now()}),logCustomerPortalSuccess:vi.fn()}))
vi.mock('@/lib/customer-operations/automation',()=>({enqueueCustomerDataRequestAutomation:vi.fn()}))
vi.mock('@/lib/customer-portal/db',()=>({createPortalCompletionCase:vi.fn()}))
vi.mock('@/lib/customers/customerOperationEvents',()=>({emitCustomerOperationEvent:vi.fn()}))
import { POST } from '@/app/api/v1/customer/profile-update/route'
import { computeCustomerSiteAddressHash, applyCustomerSiteAddressCandidate } from '@/lib/customer-sites/addressIntake'
beforeEach(()=>{m.customer={id:'customer',customer_type:'private',email:'old@example.test',updated_at:'2026-10-01T00:00:00Z'};m.site=null;m.updates=[];m.completion=0;m.rpc.mockClear()})
const req=(body:unknown)=>new NextRequest('https://example.test/api/v1/customer/profile-update',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'synthetic_20261007'},body:JSON.stringify(body)})
it('invalid facility404 arrives after profile state mutation',async()=>{
 const response=await POST(req({profile:{email:'new@example.test'},facility_data:{facility_reference:'missing',address:{street:'Street 1',postal_code:'12345',city:'City'}}}))
 expect(response.status).toBe(404)
 expect(m.customer.email).toBe('new@example.test')
 expect(m.completion).toBe(0)
})
it('same physical address changedcareof reports accepted but preserves oldcareof',async()=>{
 const address={street:'Street 1',postalCode:'12345',city:'City',country:'SE'}
 m.site={id:'site',...address,postal_code:'12345',care_of:'Old Recipient',address_hash:computeCustomerSiteAddressHash(address).hash}
 const response=await POST(req({facility_data:{facility_reference:'facility',address:{street:'Street 1',postal_code:'12345',city:'City',country:'SE',care_of:'New Recipient'}}}))
 expect(response.status).toBe(200)
 const body=await response.json()
 expect(body.data).toMatchObject({facility_updated:true,status:'accepted',address_result:{status:'unchanged'}})
 expect(m.site.care_of).toBe('Old Recipient')
 expect(m.rpc).not.toHaveBeenCalled()
 expect(m.updates).toHaveLength(1)
 expect(m.updates[0]).not.toHaveProperty('care_of')
})

it('samehash refresh downgrades provenance and next differentaddress bypasses conflict',async()=>{
 const original={street:'Street 1',postalCode:'12345',city:'City',country:'SE'}
 const hash=computeCustomerSiteAddressHash(original).hash
 m.site={id:'site',...original,postal_code:'12345',address_hash:hash,address_source:'grid_owner_response',address_verified_at:'2026-10-01T00:00:00Z',address_verification_method:'grid_owner_response'}
 const call=(street:string)=>applyCustomerSiteAddressCandidate({companyId:'company',customerId:'customer',siteId:'site',address:{...original,street,source:'customer_portal'}})
 expect((await call('Street 2')).status).toBe('conflict')
 expect(m.rpc).not.toHaveBeenCalled()
 expect((await call('Street 1')).status).toBe('unchanged')
 expect(m.site.address_source).toBe('customer_portal')
 expect(m.site.address_verified_at).toBe('2026-10-01T00:00:00Z')
 m.rpc.mockResolvedValue({data:null,error:null})
 expect((await call('Street 2')).status).toBe('updated')
 expect(m.rpc).toHaveBeenCalledWith('gridex_commit_customer_site_address',expect.objectContaining({p_street:'Street 2',p_source:'customer_portal'}))
})
