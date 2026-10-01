import{beforeEach,expect,it,vi}from'vitest'
const rpc=vi.hoisted(()=>vi.fn());vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import{readCustomerLifeEventBoundaries}from'@/lib/ediel/production/customerLifeEventBoundaries'
const input={companyId:'company-A',customerId:'customer-A',actorUserId:'actor-A',from:'2026-09-30T00:00:00Z',to:'2026-10-01T00:00:00Z'}
const boundary={effectiveAt:'2026-09-30T11:00:00Z',sourceMessageId:'00000000-0000-4000-8000-000000000030',customerVersion:1,projection:{status:'authorized',companyId:input.companyId,customerId:input.customerId,asOf:'2026-09-30T11:00:00Z',sourceMessageId:'00000000-0000-4000-8000-000000000030',customerVersion:1,effectiveVersionCount:1,customerFields:{full_name:'Own name'},endUserMasterdata:{name:['Own name']}}}
const result={status:'authorized',companyId:input.companyId,customerId:input.customerId,from:input.from,to:input.to,boundaries:[boundary]}
beforeEach(()=>rpc.mockReset())
it('preserves the exact protected source epoch and projection',async()=>{rpc.mockResolvedValue({data:result,error:null});expect(await readCustomerLifeEventBoundaries(input)).toEqual([boundary])})
it.each([{boundaries:[{...boundary,effectiveAt:input.to}]},{boundaries:[boundary,boundary]},{boundaries:[{...boundary,projection:{...boundary.projection,customerId:'other'}}]},{from:input.to}])('holds incompatible/foreign epoch tuple %j',async changed=>{rpc.mockResolvedValue({data:{...result,...changed},error:null});await expect(readCustomerLifeEventBoundaries(input)).rejects.toThrow('boundary_result_invalid')})
it('keeps unknown initial source held rather than publishing empty history',async()=>{rpc.mockResolvedValue({data:{status:'held',missing:['source_qualified_customer_masterdata_at_requested_time']},error:null});await expect(readCustomerLifeEventBoundaries(input)).rejects.toThrow('boundary_source_held')})
it('rejects an unbound or reversed interval before reading',async()=>{await expect(readCustomerLifeEventBoundaries({...input,from:'2026-09-30'})).rejects.toThrow('boundary_period_required');expect(rpc).not.toHaveBeenCalled()})
