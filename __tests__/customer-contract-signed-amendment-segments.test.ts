import {beforeEach,expect,it,vi} from 'vitest'
import {loadContractCommercialSegments} from '@/lib/customer-contracts/amendment'
const {rpc,from,qualified,evaluate}=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),qualified:vi.fn(),evaluate:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc,from}}))
const id=(n:number)=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const input={companyId:id(1),customerId:id(2),meteringPointId:id(3),supplyPeriodId:id(4),physicalContractId:id(5),start:'2026-11-30T23:00:00Z',end:'2026-12-31T23:00:00Z'}
function receipt(){return {schema:'gridex-contract-commercial-segments-v1' as const,...input,assignmentSHA256:'a'.repeat(64),segments:[{start:input.start,end:input.end,contractId:id(6),priceSnapshotId:id(7),acceptanceSHA256:'b'.repeat(64)}]}}
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
 const run=()=>updateMeterValueBillingReadiness({meterValue:{...value,id:id(21)} as unknown as Parameters<typeof updateMeterValueBillingReadiness>[0]['meterValue']})
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

// Readiness adapter controls: actual pure core; native/DB ports below remain
// declared finite inputs and do not establish native authority or scenario PASS.
import {evaluateBillingReadinessCore} from '@/lib/billing/billingReadiness'
function amendmentReadiness() {
 const root={id:id(5),company_id:id(1),customer_id:id(2),metering_point_id:id(3),status:'active',customer_site_id:id(8),contract_price_snapshot_id:id(9)}
 const contract={...root,id:id(6),status:'signed',contract_price_snapshot_id:id(7),invoice_recipient:'Synthetic customer',invoice_email:'customer@example.invalid',vat_rate:25}
 return {companyId:id(1),customerId:id(2),contract,issuer:{legalName:'Synthetic company',orgNumber:'5590000000'},site:{id:id(8),company_id:id(1),customer_id:id(2)},
  meteringPoint:{id:id(3),company_id:id(1),customer_id:id(2),site_id:id(8),meter_point_id:'735999000000000001'},
  supplyPeriods:[{id:id(4),company_id:id(1),customer_id:id(2),metering_point_id:id(3),contract_id:id(5),customer_contract_id:id(5),status:'active',start_date:'2026-01-01'}],
  billingPeriod:{start:'2026-12-01',end:'2027-01-01'},priceArea:'SE3',meterValues:{present:true},paymentTerms:{dueDays:30},paymentProvider:{provider:'manual',status:'active'},
  commercialSupply:{assignment:receipt(),physicalContract:root,priceSnapshotId:id(7),billingInstants:{start:input.start,end:input.end}},
 }
}
it('readiness bills the accepted signed commercial child only through its active physical root and exact native segment',()=>{
 const result=evaluateBillingReadinessCore(amendmentReadiness())
 expect(result.blockers).toEqual([]);expect(result.billable).toBe(true)
 expect(result.evidence).toMatchObject({contract_id:id(6),physical_contract_id:id(5),commercial_assignment_sha256:'a'.repeat(64)})
})
it('readiness never globally admits signed or terminated contracts and retains physical root operational blockers',()=>{
 const plain=amendmentReadiness();delete (plain as Partial<typeof plain>).commercialSupply
 expect(evaluateBillingReadinessCore(plain).billable).toBe(false)
 for(const status of ['draft','terminated','cancelled']) {
  const value=amendmentReadiness();value.contract.status=status
  expect(evaluateBillingReadinessCore(value).billable).toBe(false)
 }
 for(const status of ['signed','terminated','cancelled']) {
  const value=amendmentReadiness();value.commercialSupply.physicalContract.status=status
  expect(evaluateBillingReadinessCore(value).billable).toBe(false)
 }
 const blocked=amendmentReadiness()
 Object.assign(blocked.commercialSupply.physicalContract,{export_blocked:true,export_block_reason:'Physical root hold'})
 expect(evaluateBillingReadinessCore(blocked).blockers).toContainEqual({code:'billing_blocked',message:'Physical root hold'})
})
it('readiness rejects conflicting physical aliases, scope, CPS, instants and multiple commercial segments',()=>{
 const edits:Array<(v:ReturnType<typeof amendmentReadiness>)=>void>=[
  v=>{v.supplyPeriods[0].customer_contract_id=id(99)},v=>{v.commercialSupply.assignment.companyId=id(99)},
  v=>{v.commercialSupply.assignment.customerId=id(99)},v=>{v.commercialSupply.assignment.meteringPointId=id(99)},
  v=>{v.commercialSupply.assignment.supplyPeriodId=id(99)},v=>{v.commercialSupply.assignment.physicalContractId=id(99)},
  v=>{v.commercialSupply.assignment.segments[0].contractId=id(99)},v=>{v.commercialSupply.priceSnapshotId=id(99)},
  v=>{v.commercialSupply.assignment.segments[0].priceSnapshotId=id(99)},v=>{v.commercialSupply.assignment.segments[0].acceptanceSHA256=''},
  v=>{v.commercialSupply.billingInstants.start='2026-12-01T00:00:00Z'},v=>{v.commercialSupply.assignment.segments.push(v.commercialSupply.assignment.segments[0])},
  v=>{v.billingPeriod.start='2026-12-02'},v=>{v.commercialSupply.physicalContract.customer_id=id(99)},
 ]
 for(const edit of edits){const value=amendmentReadiness();edit(value);expect(evaluateBillingReadinessCore(value).billable).toBe(false)}
})
it('ordinary active readiness retains legacy evidence shape without invented amendment keys',()=>{
 const value=amendmentReadiness();value.contract.status='active';value.contract.id=id(5);value.supplyPeriods[0].contract_id=id(5)
 delete (value as Partial<typeof value>).commercialSupply
 const result=evaluateBillingReadinessCore(value);expect(result.billable).toBe(true)
 expect(result.evidence).not.toHaveProperty('physical_contract_id');expect(result.evidence).not.toHaveProperty('commercial_assignment_sha256')
})

vi.mock('@/lib/metering/validation',()=>({companyAllowsEstimatedMeteringValues:vi.fn().mockResolvedValue(false),evaluateMeteringCompletenessForMonth:vi.fn().mockResolvedValue({issues:[]})}))
async function invoiceFixture(options:{legacy?:boolean;sourceHeld?:boolean;badInstants?:boolean;badAliases?:boolean;wrongPrice?:boolean;missingPrice?:boolean;missingRpc?:boolean;split?:boolean;range?:{month:string;start:string;end:string;startDate:string;endDate:string}}={}) {
 // Explicit finite DB/native/meter-resolution ports. The actual invoice adapter,
 // frozen assignment parser and pure core run; no source authority is claimed.
 vi.doMock('@/lib/metering/contractMeteringResolution',()=>({loadMeteringResolutionRequirements:vi.fn().mockResolvedValue(new Map())}))
 const {evaluateBillingMonthInvoiceReadiness}=await import('@/lib/billing/invoiceReadiness')
 const fixture=amendmentReadiness(),root={...fixture.commercialSupply.physicalContract,invoice_recipient:'Synthetic customer',invoice_email:'customer@example.invalid',vat_rate:25,price_area_used:'SE3'},child={...fixture.contract,price_area_used:'SE3'}
 const period={...fixture.supplyPeriods[0],...(options.badAliases?{customer_contract_id:id(99)}:{})}
 const underlay={id:id(20),company_id:id(1),customer_id:id(2),contract_id:options.legacy?id(5):id(6),supply_period_id:id(4),metering_point_id:id(3),
  contract_price_snapshot_id:options.legacy?id(9):id(7),pricing_snapshot_id:options.wrongPrice?id(99):options.legacy?id(9):id(7),
  status:'validated',readiness_status:'ready',total_kwh:'1',missing_values_count:0,price_area:'SE3',calculated_total_sek_inc_vat:100,
  billing_period_start:'2026-12-01',billing_period_end:'2027-01-01',payload:options.badInstants?{}:{billing_period_start_instant:'2026-12-01T00:00:00+01:00',billing_period_end_instant:'2027-01-01T00:00:00+01:00',billing_period_timezone:'Europe/Stockholm',billing_period_end_exclusive:true}}
 if(options.missingPrice)Object.assign(underlay,{contract_price_snapshot_id:null,pricing_snapshot_id:null})
 if(options.range)Object.assign(underlay,{billing_period_start:options.range.startDate,billing_period_end:options.range.endDate,payload:{billing_period_start_instant:options.range.start,billing_period_end_instant:options.range.end,billing_period_timezone:'Europe/Stockholm',billing_period_end_exclusive:true}})
 const updates:Array<Record<string,unknown>>=[];const columns:Array<{table:string;select:string}>=[]
 from.mockImplementation((table:string)=>{
  const filters:Record<string,unknown>={};let patch:Record<string,unknown>|undefined;let single=false
  const rows=()=>{
   if(patch){updates.push(patch);return [{id:id(20)}]}
   const data=table==='billing_underlays'?[underlay]:table==='companies'?[{id:id(1),name:'Synthetic company',org_number:'5590000000',operating_environment:'test',billing_settings:{provider:'manual',environment:'test',due_days:30,invoice_profile:{id:id(30),status:'active',distribution_method:'email',ocr_policy:'none',payment_reference_policy:'none'}}}]:
    table==='billing_provider_connections'?[{id:id(31),provider:'manual',environment:'test',status:'active'}]:table==='customer_contracts'?[root,child]:
    table==='contract_price_snapshots'?[{id:id(7),company_id:id(1),contract_id:id(6),snapshot_json:{price_area:'SE3'}},{id:id(9),company_id:id(1),contract_id:id(5),snapshot_json:{price_area:'SE3'}}]:
    table==='customers'?[{id:id(2),company_id:id(1),full_name:'Synthetic customer'}]:table==='customer_sites'?[{id:id(8),company_id:id(1),customer_id:id(2),price_area_code:'SE3',street:'Test 1',postal_code:'11111',city:'Test'}]:
    table==='metering_points'?[{id:id(3),company_id:id(1),customer_id:id(2),customer_site_id:id(8),meter_point_id:'735999000000000001',price_area_code:'SE3'}]:table==='customer_supply_periods'?[period]:[]
   return data.filter(row=>Object.entries(filters).every(([k,v])=>!(k in row)||(Array.isArray(v)?v.includes((row as Record<string,unknown>)[k]):v===(row as Record<string,unknown>)[k])))
  }
  const query={select:(selection:string)=>{columns.push({table,select:selection});return query},eq:(key:string,value:unknown)=>{filters[key]=value;return query},in:(key:string,value:unknown)=>{filters[key]=value;return query},lte:()=>query,or:()=>query,order:()=>query,range:()=>query,limit:()=>query,is:()=>query,update:(value:Record<string,unknown>)=>{patch=value;return query},maybeSingle:()=>{single=true;return query},then:(resolve:(value:unknown)=>unknown,reject?:(reason:unknown)=>unknown)=>{const data=rows();return Promise.resolve({data:single?data[0]??null:data,error:null}).then(resolve,reject)}}
  return query
 })
 rpc.mockImplementation((name:string)=>{
  if(name==='gridex_read_billing_underlay_source_basis_v1')return Promise.resolve({data:[{id:id(20),totalKwh:'1',qualified:!options.sourceHeld,correctionRequired:false}],error:null})
  if(name==='gridex_read_contract_commercial_segments_v1'){
   const data=receipt();if(options.range){data.start=options.range.start;data.end=options.range.end;data.segments[0].start=data.start;data.segments[0].end=data.end}if(options.split)data.segments.push(data.segments[0])
   return Promise.resolve({data:options.missingRpc?null:data,error:options.missingRpc?new Error('native unavailable'):null})
  }
  throw Error('Unexpected RPC '+name)
 })
 return {run:()=>evaluateBillingMonthInvoiceReadiness({companyId:id(1),billingMonth:options.range?.month??'2026-12'}),updates,columns,underlay}
}
it('the actual invoice adapter qualifies exact persisted underlay instants, child CPS and unchanged physical SP',async()=>{
 const {run,updates,columns}=await invoiceFixture();const result=await run()
 expect(result.status).toBe('ready');expect(result.readyUnderlayIds).toEqual([id(20)])
 expect(rpc).toHaveBeenCalledWith('gridex_read_contract_commercial_segments_v1',{p_company_id:id(1),p_supply_period_id:id(4),p_start:'2026-11-30T23:00:00.000Z',p_end:'2026-12-31T23:00:00.000Z'})
 expect(columns.find(c=>c.table==='billing_underlays')?.select.split(',')).toContain('supply_period_id')
 expect(updates.find(u=>u.billing_configuration_snapshot)?.billing_configuration_snapshot).toMatchObject({contract_id:id(6),commercial_supply:{physical_contract_id:id(5),supply_period_id:id(4),assignment_sha256:'a'.repeat(64),contract_price_snapshot_id:id(7)}})
})
it.each([{sourceHeld:true},{badInstants:true},{badAliases:true},{wrongPrice:true},{missingPrice:true},{missingRpc:true},{split:true}])('the invoice adapter fails closed before configuration snapshot on unusable commercial authority %j',async options=>{
 const {run,updates}=await invoiceFixture(options)
 let result:Awaited<ReturnType<typeof run>>|undefined
 try{result=await run()}catch(error){expect((error as Error).message).toMatch(/^(native unavailable|amendment_commercial_assignment_invalid|invoice_commercial_)/)}
 if(result)expect(result.status).toBe('blocked')
 expect(updates.some(u=>'billing_configuration_snapshot' in u)).toBe(false)
})
it('the ordinary invoice path keeps its existing configuration shape and does not invent an amendment native read',async()=>{
 const {run,updates}=await invoiceFixture({legacy:true});expect((await run()).status).toBe('ready')
 expect(rpc.mock.calls.some(([name])=>name==='gridex_read_contract_commercial_segments_v1')).toBe(false)
 expect(updates.find(u=>u.billing_configuration_snapshot)?.billing_configuration_snapshot).not.toHaveProperty('commercial_supply')
 expect(updates.find(u=>u.billing_configuration_snapshot)?.billing_configuration_snapshot_sha256).toBe('ef0611b9cf5fbd9cc818312dccf6fcc140afaa40fc169308f6475b08ba66fcae')
})

it.each([
 {month:'2027-03',start:'2027-02-28T23:00:00Z',end:'2027-03-31T22:00:00Z',startDate:'2027-03-01',endDate:'2027-04-01'},
 {month:'2027-10',start:'2027-10-30T22:00:00Z',end:'2027-10-31T23:00:00Z',startDate:'2027-10-31',endDate:'2027-11-01'},
])('invoice readiness uses actual DST/partial-period instants rather than a whole-month substitute %j',async range=>{
 const {run}=await invoiceFixture({range});expect((await run()).status).toBe('ready')
 expect(rpc).toHaveBeenCalledWith('gridex_read_contract_commercial_segments_v1',{p_company_id:id(1),p_supply_period_id:id(4),p_start:new Date(range.start).toISOString(),p_end:new Date(range.end).toISOString()})
})

it('the exact physical SP must itself pass normal delivery gates even when another root SP is active',()=>{
 const value=amendmentReadiness();value.supplyPeriods[0].status='pending'
 value.supplyPeriods.push({...value.supplyPeriods[0],id:id(99),status:'active'})
 expect(evaluateBillingReadinessCore(value).billable).toBe(false)
})
