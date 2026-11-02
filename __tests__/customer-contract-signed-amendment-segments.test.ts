import {beforeEach,expect,it,vi} from 'vitest'
import {loadContractCommercialSegments} from '@/lib/customer-contracts/amendment'
const {rpc,from,qualified,evaluate}=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),qualified:vi.fn(),evaluate:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc,from}}))
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),customerId:id(2),meteringPointId:id(3),supplyPeriodId:id(4),physicalContractId:id(5),start:'2026-11-30T23:00:00Z',end:'2026-12-31T23:00:00Z'}
function receipt(){return {schema:'gridex-contract-commercial-segments-v1',...input,assignmentSHA256:'a'.repeat(64),segments:[{start:input.start,end:input.end,contractId:id(6),priceSnapshotId:id(7),acceptanceSHA256:'b'.repeat(64)}]}}
beforeEach(()=>{rpc.mockReset();from.mockReset();qualified.mockReset();evaluate.mockReset()})
it('calls only the actual native assignment read and retains physical lineage separately from commercial identity',async()=>{
 rpc.mockResolvedValue({data:receipt(),error:null})
 expect(await loadContractCommercialSegments(input)).toEqual(receipt())
 expect(rpc).toHaveBeenCalledExactlyOnceWith('gridex_read_contract_commercial_segments_v1',{p_company_id:id(1),p_supply_period_id:id(4),p_start:input.start,p_end:input.end})
})
it('preserves the unamended legacy root without inventing an amendment receipt or a new price pointer',async()=>{
 const value=receipt();Object.assign(value.segments[0],{contractId:id(5),priceSnapshotId:null,acceptanceSHA256:null})
 rpc.mockResolvedValue({data:value,error:null})
 expect(await loadContractCommercialSegments(input)).toEqual(value)
})
it.each(['companyId','customerId','meteringPointId','supplyPeriodId','physicalContractId'])('refuses mismatched native scope %s',async field=>{
 rpc.mockResolvedValue({data:{...receipt(),[field]:id(99)},error:null})
 await expect(loadContractCommercialSegments(input)).rejects.toThrow('amendment_commercial_assignment_invalid')
})
it('requires exact complete coverage without gaps, overlaps, reordered boundaries or malformed dates',async()=>{
 for(const segments of [[],[{...receipt().segments[0],start:'2026-12-01T23:00:00Z'}],[{...receipt().segments[0],end:'2026-12-30T23:00:00Z'}],
  [receipt().segments[0],receipt().segments[0]],[{...receipt().segments[0],start:'2026-02-30T00:00:00Z'}]]) {
  rpc.mockResolvedValueOnce({data:{...receipt(),segments},error:null})
  await expect(loadContractCommercialSegments(input)).rejects.toThrow('amendment_commercial_assignment_invalid')
 }
})
it('refuses a commercial successor without a genuine native acceptance hash and exact price snapshot',async()=>{
 for(const patch of [{acceptanceSHA256:null},{acceptanceSHA256:'x'},{priceSnapshotId:null},{contractId:'unknown'}]) {
  rpc.mockResolvedValueOnce({data:{...receipt(),segments:[{...receipt().segments[0],...patch}]},error:null})
  await expect(loadContractCommercialSegments(input)).rejects.toThrow('amendment_commercial_assignment_invalid')
 }
})
it('fails closed on missing migration or transport failure without substituting the old contract',async()=>{
 rpc.mockResolvedValueOnce({data:null,error:new Error('native assignment RPC unavailable')})
 await expect(loadContractCommercialSegments(input)).rejects.toThrow('native assignment RPC unavailable')
 expect(rpc).toHaveBeenCalledTimes(1)
})

// Declared finite source/evaluation ports: controls here qualify the actual TS
// consumer's contract selection and persistence, not native source authority.
vi.mock('@/lib/platform/schemaReadiness',()=>({assertPlatformSchemaReady:vi.fn()}))
vi.mock('@/lib/billing/sourceBasis',()=>({loadQualifiedBillingValues:qualified}))
vi.mock('@/lib/billing/billingGate',()=>({evaluateBillingGate:evaluate}))
async function matcherFixture() {
 const {updateMeterValueBillingReadiness}=await import('@/lib/billing/meterValueBillingMatcher')
 const value={id:id(20),company_id:id(1),metering_point_id:id(3),period_start:input.start,period_end:input.end,source_message_id:id(22),source_metering_value_id:id(21)}
 qualified.mockResolvedValue(new Map([[id(20),value]]))
 const lookups:Array<{table:string;filters:Record<string,unknown>}> = []
 from.mockImplementation((table:string)=>{
  const filters:Record<string,unknown>={};lookups.push({table,filters})
  const rows=()=>table==='normalized_metering_values'?[value]:table==='customer_supply_periods'?[{id:id(4),contract_id:id(5),customer_id:id(2)}]:table==='customer_contracts'?[{id:filters.id,company_id:id(1),customer_id:id(2),metering_point_id:id(3)}]:[]
  const query={select:()=>query,eq:(key:string,val:unknown)=>{filters[key]=val;return query},in:()=>query,lte:()=>query,or:()=>query,limit:()=>query,
   then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows(),error:null}).then(resolve)}
  return query
 })
 evaluate.mockImplementation((scope:{contract?:{id:string}})=>({status:'eligible',eligible:true,reasons:[],snapshot:{contract_id:scope.contract?.id??null}}))
 rpc.mockImplementation((name:string)=>name==='gridex_read_contract_commercial_segments_v1'?Promise.resolve({data:receipt(),error:null}):Promise.resolve({data:{},error:null}))
 const run=()=>updateMeterValueBillingReadiness({meterValue:{...value,id:id(21)} as Parameters<typeof updateMeterValueBillingReadiness>[0]['meterValue']})
 return {run,lookups}
}
it('the actual metering billing consumer loads the effective commercial version and persists the original physical period',async()=>{
 const {run,lookups}=await matcherFixture()
 expect(await run()).toBe('billable')
 expect(lookups.filter(x=>x.table==='customer_contracts').map(x=>x.filters.id)).toEqual([id(6)])
 expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({contract:expect.objectContaining({id:id(6)}),supplyPeriod:expect.objectContaining({contract_id:id(5)})}))
 expect(rpc).toHaveBeenCalledWith('gridex_set_metering_billing_gate',expect.objectContaining({p_gate:expect.objectContaining({supply_period_id:id(4),billing_gate_snapshot:expect.objectContaining({contract_id:id(6),commercial_assignment:expect.objectContaining({physicalContractId:id(5),segments:receipt().segments})})})}))
})
it('the metering billing consumer never falls back to the old contract on missing assignment authority',async()=>{
 const {run}=await matcherFixture()
 rpc.mockRejectedValue(new Error('native assignment unavailable'))
 await expect(run()).rejects.toThrow('native assignment unavailable')
 expect(evaluate).not.toHaveBeenCalled()
})

it('retains authoritative native timestamp serialization for independent native receipt comparison',async()=>{
 rpc.mockResolvedValue({data:receipt(),error:null})
 expect(await loadContractCommercialSegments({...input,start:'2026-11-30T23:00:00.000Z',end:'2026-12-31T23:00:00.000Z'})).toEqual(receipt())
})
it('refuses a year-zero interval before calling native assignment authority',async()=>{
 await expect(loadContractCommercialSegments({...input,start:'0000-01-01T00:00:00Z'})).rejects.toThrow('amendment_commercial_assignment_invalid')
 expect(rpc).not.toHaveBeenCalled()
})

async function resolutionFixture(options:{before?:boolean;unaccepted?:boolean;wrongPrice?:boolean;otherContract?:boolean}={}) {
 const {loadMeteringResolutionRequirements}=await import('@/lib/metering/contractMeteringResolution')
 const onDate=options.before?'2026-11-30':'2026-12-01'
 const contracts=[{id:id(5),metering_point_id:id(3),status:'active',contract_type:'variable_hourly',price_snapshot:{interval_resolution:'hourly'},starts_at:'2026-01-01',ends_at:null,created_at:'2026-01-01'},
  {id:id(6),metering_point_id:id(3),status:options.unaccepted?'pending_signature':'signed',contract_type:'variable_hourly',price_snapshot:{interval_resolution:'hourly'},starts_at:'2026-12-01',ends_at:null,created_at:'2026-11-01'}]
 if(options.otherContract) contracts.push({...contracts[0],id:id(99)})
 const choice=options.before?{meteringPointId:id(3),rootContractId:id(5),contractId:id(5),priceSnapshotId:null,priceSHA256:null}:
  {meteringPointId:id(3),rootContractId:id(5),contractId:id(6),priceSnapshotId:id(7),priceSHA256:'b'.repeat(64)}
 rpc.mockResolvedValue({error:null,data:{schema:'gridex-contract-amendment-metering-choices-v1',companyId:id(1),onDate,excludedAmendmentContractIds:[id(6)],choices:options.unaccepted?[]:[choice]}})
 from.mockImplementation((table:string)=>{
  const rows=()=>table==='metering_points'?[{id:id(3),reading_frequency:'hourly'}]:table==='customer_contracts'?contracts:
   [{id:id(7),contract_id:options.wrongPrice?id(5):id(6),company_id:id(1),snapshot_hash:'b'.repeat(64),snapshot_json:{interval_resolution:'quarterly'}}]
  const query={select:()=>query,eq:()=>query,in:()=>query,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows(),error:null}).then(resolve)}
  return query
 })
 return ()=>loadMeteringResolutionRequirements({companyId:id(1),meteringPointIds:[id(3)],onDate})
}
it('the actual request-resolution consumer follows accepted effective date and exact CPS over legacy active/signed preference',async()=>{
 const before=await resolutionFixture({before:true})
 expect((await before()).get(id(3))).toMatchObject({contractId:id(5),contractResolution:'hour'})
 const after=await resolutionFixture()
 expect((await after()).get(id(3))).toMatchObject({contractId:id(6),contractResolution:'quarter_hour',source:'price_snapshot'})
})
it('an unsigned registered amendment does not choose a new metering requirement',async()=>{
 const run=await resolutionFixture({unaccepted:true})
 expect((await run()).get(id(3))).toMatchObject({contractId:id(5),contractResolution:'hour'})
})
it('the request-resolution consumer refuses wrong CPS scope and unrelated competing contracts',async()=>{
 await expect((await resolutionFixture({wrongPrice:true}))()).rejects.toThrow('amendment_metering_price_snapshot_mismatch')
 await expect((await resolutionFixture({otherContract:true}))()).rejects.toThrow('amendment_metering_contract_scope_conflict')
})
it('missing amendment-choice authority cannot silently restore status/newest selection',async()=>{
 const run=await resolutionFixture();rpc.mockResolvedValue({data:null,error:new Error('choice authority missing')})
 await expect(run()).rejects.toThrow('choice authority missing')
})
