import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach,describe,expect,it,vi} from 'vitest'
// Real staff action with finite intake ledger and customer-graph ports.
const io=vi.hoisted(()=>({created:true,status:'received',graph:vi.fn(),complete:vi.fn(),fail:vi.fn(),denied:false,review:false,result:{} as Record<string,unknown>,ui:{} as Record<string,unknown>,onboard:vi.fn(),shared:vi.fn(),send:vi.fn(),marker:vi.fn(),markerMode:'exact',intakeUpdatedAt:'',casRow:null as Record<string,unknown>|null,tail:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('react',async(importOriginal)=>({...await importOriginal<typeof import('react')>(),useActionState:()=>[io.ui,vi.fn(),false]}))
vi.mock('next/link',()=>({default:'a'}))
vi.mock('@/app/admin/customers/actions',()=>({createCustomerAction:vi.fn()}))
vi.mock('@/app/admin/customers/[id]/actions',()=>({createCustomerDataRequestPackageAction:vi.fn()}))
vi.mock('@/components/admin/customers/CustomerIntakeEnhancer',()=>({default:()=>null}))
vi.mock('@/components/admin/customers/CustomerActionsMenu',()=>({default:({children}:{children:React.ReactNode})=>children}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:async()=>{if(io.denied)throw Error('denied');return {permissions:[]}},isPlatformAdminContext:()=>false}))
vi.mock('@/lib/admin/accessModel',()=>({hasPermissionRequirement:()=>false}))
vi.mock('@/lib/customers/matchingService',()=>({matchCustomerIdentity:async()=>({candidates:[]})}))
vi.mock('@/lib/grid-owners/platformGridOwnerResolver',()=>({normalizeGridOwnerIdToOps:async()=>({opsGridOwnerId:null})}))
vi.mock('@/lib/customers/canonicalOnboarding',async(importOriginal)=>({...await importOriginal<typeof import('@/lib/customers/canonicalOnboarding')>(),onboardCustomerGraph:io.onboard}))
vi.mock('@/lib/customer-operations/customerIntakeOrchestrator',()=>({processManualCustomerIntake:io.shared,processPdfCustomerIntake:io.shared}))
vi.mock('@/lib/customer-contracts/autoSendSigningLink',()=>({autoSendSigningLinkAfterCreate:io.send}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 expect(table).toBe('customer_application_intakes')
 let payload:Record<string,unknown>={};const filters:Record<string,unknown>={}
 const query={update:(value:Record<string,unknown>)=>{payload=value;io.marker(value);return query},eq:(key:string,value:unknown)=>{filters[key]=value;return query},is:(key:string,value:unknown)=>{filters[key]=value;return query},select:()=>query,single:async()=>{
 if(io.casRow && Object.entries(filters).some(([key,value])=>io.casRow![key]!==value))return {data:null,error:{code:'PGRST116'}}
 const row={...filters,...payload,result:io.markerMode==='dropped'?null:payload.result}
 if(io.casRow)io.casRow=row
 return {data:io.markerMode==='missing'?null:row,error:null}
 }}
 return query
}}}))
vi.mock('@/lib/tenant/scope',()=>({requireOperationalCompanyId:async()=>'company-a'}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:async()=>undefined}))
vi.mock('@/lib/intakes/customerApplicationIntakes',()=>({
 getOrCreateCustomerApplicationIntake:async()=>({created:io.created,intake:{id:'intake-a',status:io.status,result:io.result,updated_at:io.intakeUpdatedAt||new Date().toISOString()}}),
 completeCustomerApplicationIntake:io.complete,failCustomerApplicationIntake:io.fail,
}))
vi.mock('@/app/admin/customers/actions.part-1',()=>({
 validateCreateCustomerParams:()=>({}),normalizeOptionalString:(v:unknown)=>typeof v==='string'&&v.trim()?v.trim():null,
 normalizeCountryCode:()=> 'SE',buildBillingAddressSnapshot:()=>({}),resolveIntakeSigningChoice:()=>null,
 getActorUserId:async()=>'staff-a',buildCreateCustomerParams:()=>({companyId:'company-a',customerType:'private',optionalFeeLines:[]}),getFormValues:()=>({}),
 resolveOrCreateGridOwnerForIntake:async()=>({gridOwnerId:'grid-a',warnings:[]}),
 resolveOrCreateCurrentSupplierForIntake:async()=>({supplierId:null,name:null,orgNumber:null,warnings:[]}),
}))
vi.mock('@/app/admin/customers/actions.part-2',()=>({
 CustomerGraphCommittedReviewError:class extends Error {constructor(public receipt:Record<string,unknown>){super('Committed customer requires review')}},
 ADMIN_INTAKE_IN_PROGRESS_STALE_MS:60000,ADMIN_INTAKE_ROUTE:'admin-intake',createCustomerGraph:io.graph,
 mapUnknownErrorToIntakeState:(error:Error)=>({status:'error',message:error.message,createdCustomerId:null,fieldErrors:{},values:{}}),
}))
vi.mock('@/app/admin/customers/actions.part-4',()=>({rowValue:vi.fn()}))
import {CustomerGraphCommittedReviewError} from '@/app/admin/customers/actions.part-2'
import {createCustomerAction} from '@/app/admin/customers/actions.part-3'
import {initialIntakeActionState} from '@/app/admin/customers/actionState'
beforeEach(()=>{
 io.shared.mockReset();io.send.mockReset();io.tail.mockReset();io.casRow=null;io.intakeUpdatedAt='';io.created=true;io.status='received';io.denied=false;io.result={};io.markerMode='exact';io.marker.mockReset();io.graph.mockReset();io.complete.mockReset().mockResolvedValue(undefined);io.fail.mockReset().mockResolvedValue(undefined)
 io.graph.mockResolvedValue({id:'customer-a',customer_number:'SYNTHETIC',__createdNewCustomer:true,__createdSiteId:'site-a',__duplicateWarnings:[]})
})
describe('staff intake admission',()=>{
 it('processes a newly created received ledger row exactly once',async()=>{
  const result=await createCustomerAction(initialIntakeActionState,new FormData())
  expect(result).toMatchObject({status:'success',createdCustomerId:'customer-a'})
  expect(io.graph).toHaveBeenCalledOnce();expect(io.complete).toHaveBeenCalledWith(expect.objectContaining({companyId:'company-a',customerId:'customer-a'}));expect(io.fail).not.toHaveBeenCalled()
 })
 it('holds a pre-existing fresh received row without another graph write',async()=>{
  io.created=false
  expect(await createCustomerAction(initialIntakeActionState,new FormData())).toMatchObject({status:'error',createdCustomerId:null})
  expect(io.graph).not.toHaveBeenCalled();expect(io.complete).not.toHaveBeenCalled()
 })
 it('preserves staff authorization before intake processing',async()=>{
  io.denied=true
  expect(await createCustomerAction(initialIntakeActionState,new FormData())).toMatchObject({status:'error',message:'denied'})
  expect(io.graph).not.toHaveBeenCalled()
 })
})

describe('durable committed customer review boundary',()=>{
 it('returns known committed IDs without making the intake retryable',async()=>{
  io.graph.mockRejectedValue(new CustomerGraphCommittedReviewError({company_id:'company-a',customer_id:'customer-a',site_id:'site-a',metering_point_id:'point-a',contract_id:'contract-a',correlation_id:'correlation-a'} as never))
  const result=await createCustomerAction(initialIntakeActionState,new FormData())
  expect(result).toMatchObject({status:'committed_review',createdCustomerId:'customer-a',createdSiteId:'site-a',createdContractId:'contract-a'})
  expect(io.fail).not.toHaveBeenCalled()
 })
 it('replays a durable pending-review result without graph, upload or send work',async()=>{
  io.created=false;io.status='completed';io.result={review_required:true,customer_id:'customer-a',created_site_id:'site-a',created_contract_id:'contract-a',correlation_id:'correlation-a'}
  expect(await createCustomerAction(initialIntakeActionState,new FormData())).toMatchObject({status:'committed_review',createdCustomerId:'customer-a',createdContractId:'contract-a'})
  expect(io.graph).not.toHaveBeenCalled();expect(io.fail).not.toHaveBeenCalled();expect(io.complete).not.toHaveBeenCalled()
 })
 it('records pending review before the graph may start postcommit side effects',async()=>{
  io.graph.mockImplementation(async (_params,options)=>{
   expect(options.onCoreCommitted).toBeTypeOf('function')
   await options.onCoreCommitted({company_id:'company-a',customer_id:'customer-a',site_id:'site-a',metering_point_id:'point-a',contract_id:'contract-a',correlation_id:'correlation-a'})
   expect(io.marker).toHaveBeenCalledWith(expect.objectContaining({result:expect.objectContaining({review_required:true,customer_id:'customer-a'})}))
   throw new CustomerGraphCommittedReviewError({company_id:'company-a',customer_id:'customer-a',site_id:'site-a',contract_id:'contract-a',correlation_id:'correlation-a'} as never)
  })
  expect(await createCustomerAction(initialIntakeActionState,new FormData())).toMatchObject({status:'committed_review',createdCustomerId:'customer-a'})
  expect(io.fail).not.toHaveBeenCalled();expect(io.marker).toHaveBeenCalledOnce()
 })
})

describe('committed review presentation',()=>{
 it('shows the known customer and disables create without offering business continuation',async()=>{
  io.ui={...initialIntakeActionState,status:'committed_review',message:'Review documents',createdCustomerId:'customer-a',createdContractId:'contract-a',correlationId:'correlation-a',postCreateAction:'request_data'}
  const {default:Form}=await import('@/components/admin/customers/CustomerIntakeForm')
  const html=renderToStaticMarkup(React.createElement(Form,{gridOwners:[],electricitySuppliers:[],priceAreas:[],contractOffers:[]}))
  expect(html).toContain('role="alert"');expect(html).toContain('/admin/customers/customer-a?tab=contracts');expect(html).toContain('correlation-a')
  expect(html).not.toContain('name="redirect_after_submit"');expect(html).not.toContain('Begär uppgifter direkt')
  expect(html.match(/<button[^>]*name="intakeCreateMode"[^>]*>/)?.[0]).toContain('disabled=""')
 })
})

describe('actual customer graph postcommit boundary with finite ports',()=>{
 const receipt={ok:true,code:'customer_onboarding_committed',operation_id:'operation-a',correlation_id:'correlation-a',customer_id:'customer-a',customer_number:'SYNTHETIC',created_new_customer:true,site_id:'site-a',metering_point_id:'point-a',contract_id:'contract-a',power_of_attorney_id:null,authorization_document_id:null}
 beforeEach(()=>{io.onboard.mockReset().mockResolvedValue(receipt);io.shared.mockReset();io.send.mockReset()})
 it('stops before document orchestration/send if recording known core IDs is uncertain',async()=>{
  const actual=await vi.importActual<typeof import('@/app/admin/customers/actions.part-2')>('@/app/admin/customers/actions.part-2')
  const record=vi.fn().mockRejectedValue(new TypeError('lost receipt response'))
  const params={companyId:'company-a',actorUserId:'staff-a',customerType:'private',country:'SE',optionalFeeLines:[],contractStatus:'draft'} as unknown as Parameters<typeof actual.createCustomerGraph>[0]
  await expect(actual.createCustomerGraph(params,{onCoreCommitted:record})).rejects.toMatchObject({name:'CustomerGraphCommittedReviewError',receipt:expect.objectContaining({customer_id:'customer-a',contract_id:'contract-a'})})
  expect(record).toHaveBeenCalledWith(receipt);expect(io.shared).not.toHaveBeenCalled();expect(io.send).not.toHaveBeenCalled();expect(io.onboard).toHaveBeenCalledOnce()
 })
 it('preserves the known graph receipt when downstream processing fails after the core marker',async()=>{
  const actual=await vi.importActual<typeof import('@/app/admin/customers/actions.part-2')>('@/app/admin/customers/actions.part-2')
  const record=vi.fn().mockResolvedValue(undefined);io.shared.mockRejectedValue(new Error('document processing unavailable'))
  const params={companyId:'company-a',actorUserId:'staff-a',customerType:'private',country:'SE',optionalFeeLines:[],contractStatus:'draft'} as unknown as Parameters<typeof actual.createCustomerGraph>[0]
  await expect(actual.createCustomerGraph(params,{onCoreCommitted:record})).rejects.toMatchObject({name:'CustomerGraphCommittedReviewError',receipt:expect.objectContaining({customer_id:'customer-a'})})
  expect(record).toHaveBeenCalledOnce();expect(io.shared).toHaveBeenCalledOnce();expect(record.mock.invocationCallOrder[0]).toBeLessThan(io.shared.mock.invocationCallOrder[0]);expect(io.send).not.toHaveBeenCalled()
 })
})

describe('strict core receipt persistence before side effects',()=>{
 it.each(['missing','dropped'])('holds %s durable readback without exposing success or retryable failure',async(mode)=>{
  io.markerMode=mode
  io.graph.mockImplementation(async(_params,options)=>{
   const receipt={customer_id:'customer-a',site_id:'site-a',contract_id:'contract-a',correlation_id:'correlation-a'}
   try {await options.onCoreCommitted(receipt)} catch {throw new CustomerGraphCommittedReviewError(receipt as never)}
   throw Error('unsafe_side_effect_reached')
  })
  expect(await createCustomerAction(initialIntakeActionState,new FormData())).toMatchObject({status:'committed_review',createdCustomerId:'customer-a'})
  expect(io.marker).toHaveBeenCalledOnce();expect(io.fail).not.toHaveBeenCalled();expect(io.complete).not.toHaveBeenCalled()
 })
})

describe('signed-PDF intake never manufactures a signed core row',()=>{
 it('creates the contract unsigned with no signing timestamp before document import',async()=>{
  const actual=await vi.importActual<typeof import('@/app/admin/customers/actions.part-2')>('@/app/admin/customers/actions.part-2')
  io.onboard.mockResolvedValue({ok:true,code:'customer_onboarding_committed',customer_id:'customer-a',customer_number:'SYNTHETIC',contract_id:'contract-a',site_id:null,correlation_id:'correlation-a'})
  const params={companyId:'company-a',actorUserId:'staff-a',customerType:'private',country:'SE',optionalFeeLines:[],contractStatus:'signed',contractTypeOverride:'variable_monthly',spotMarkupOrePerKwh:0,invoiceFeeSek:19,signedAgreementFile:new File(['%PDF fixture'],'signed.pdf',{type:'application/pdf'})} as unknown as Parameters<typeof actual.createCustomerGraph>[0]
  await expect(actual.createCustomerGraph(params,{onCoreCommitted:async()=>{throw Error('stop before file work')}})).rejects.toMatchObject({name:'CustomerGraphCommittedReviewError'})
  expect(io.onboard.mock.calls.at(-1)?.[0].contract).toMatchObject({status:'pending_signature',signed_at:null,price_snapshot:expect.objectContaining({invoiceFeeSek:19})})
  expect(io.onboard.mock.calls.at(-1)?.[0].price_snapshot).toBeNull()
  expect(io.shared).not.toHaveBeenCalled();expect(io.send).not.toHaveBeenCalled()
 })
})

describe('one durable tail owner for competing failed-intake retries',()=>{
 it('allows exactly one core-marker winner before any non-idempotent tail work',async()=>{
  io.created=false;io.status='failed';io.intakeUpdatedAt='2026-10-29T10:00:00.123456+00:00'
  io.casRow={id:'intake-a',company_id:'company-a',status:io.status,updated_at:io.intakeUpdatedAt}
  let entered=0;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve})
  io.graph.mockImplementation(async(_params,options)=>{
   const receipt={customer_id:'customer-a',site_id:'site-a',contract_id:'contract-a',correlation_id:'correlation-a'}
   entered++;if(entered===2)release();await barrier
   try {await options.onCoreCommitted(receipt)} catch {throw new CustomerGraphCommittedReviewError(receipt as never)}
   io.tail();return {id:'customer-a',customer_number:'SYNTHETIC',__createdNewCustomer:true,__duplicateWarnings:[]}
  })
  const results=await Promise.all([createCustomerAction(initialIntakeActionState,new FormData()),createCustomerAction(initialIntakeActionState,new FormData())])
  expect(results.map(r=>r.status).sort()).toEqual(['committed_review','success'])
  expect(io.graph).toHaveBeenCalledTimes(2);expect(io.tail).toHaveBeenCalledOnce();expect(io.fail).not.toHaveBeenCalled()
 })
})
