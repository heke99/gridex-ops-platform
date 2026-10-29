import {beforeEach,describe,expect,it,vi} from 'vitest'
// Real staff action with finite intake ledger and customer-graph ports.
const io=vi.hoisted(()=>({created:true,status:'received',graph:vi.fn(),complete:vi.fn(),fail:vi.fn(),denied:false}))
vi.mock('server-only',()=>({}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:async()=>{if(io.denied)throw Error('denied');return {permissions:[]}},isPlatformAdminContext:()=>false}))
vi.mock('@/lib/admin/accessModel',()=>({hasPermissionRequirement:()=>false}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('@/lib/tenant/scope',()=>({requireOperationalCompanyId:async()=>'company-a'}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:async()=>undefined}))
vi.mock('@/lib/intakes/customerApplicationIntakes',()=>({
 getOrCreateCustomerApplicationIntake:async()=>({created:io.created,intake:{id:'intake-a',status:io.status,updated_at:new Date().toISOString()}}),
 completeCustomerApplicationIntake:io.complete,failCustomerApplicationIntake:io.fail,
}))
vi.mock('@/app/admin/customers/actions.part-1',()=>({
 getActorUserId:async()=>'staff-a',buildCreateCustomerParams:()=>({companyId:'company-a',customerType:'private',optionalFeeLines:[]}),getFormValues:()=>({}),
 resolveOrCreateGridOwnerForIntake:async()=>({gridOwnerId:'grid-a',warnings:[]}),
 resolveOrCreateCurrentSupplierForIntake:async()=>({supplierId:null,name:null,orgNumber:null,warnings:[]}),
}))
vi.mock('@/app/admin/customers/actions.part-2',()=>({
 ADMIN_INTAKE_IN_PROGRESS_STALE_MS:60000,ADMIN_INTAKE_ROUTE:'admin-intake',createCustomerGraph:io.graph,
 mapUnknownErrorToIntakeState:(error:Error)=>({status:'error',message:error.message,createdCustomerId:null,fieldErrors:{},values:{}}),
}))
vi.mock('@/app/admin/customers/actions.part-4',()=>({rowValue:vi.fn()}))
import {createCustomerAction} from '@/app/admin/customers/actions.part-3'
import {initialIntakeActionState} from '@/app/admin/customers/actionState'
beforeEach(()=>{
 io.created=true;io.status='received';io.denied=false;io.graph.mockReset();io.complete.mockReset().mockResolvedValue(undefined);io.fail.mockReset().mockResolvedValue(undefined)
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
