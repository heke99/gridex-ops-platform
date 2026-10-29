import {beforeEach,describe,it,expect,vi} from 'vitest'
// Calls the real public underlay entrypoint with finite DB/source/gate ports.
// This proves discovery/store intent, not qualified metering, DB commit or LIVE.
const io=vi.hoisted(()=>({contract:{} as Record<string,unknown>,snapshots:[] as Array<Record<string,unknown>>,commands:[] as Array<Record<string,unknown>>,queries:[] as Array<{table:string;filters:Array<[string,unknown]>}>}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/platform/schemaReadiness',()=>({assertPlatformSchemaReady:async()=>undefined}))
vi.mock('@/lib/billing/invoiceReadiness',()=>({assertBillingPeriodOpen:async()=>undefined,getBillingPeriodLock:async()=>null}))
vi.mock('@/lib/billing/consumptionEstimate',()=>({companyEstimatesMissingConsumption:async()=>false,estimateMissingConsumption:async()=>null,missingWindows:()=>[]}))
vi.mock('@/lib/billing/sourceBasis',()=>({loadQualifiedBillingValues:async()=>[]}))
vi.mock('@/lib/billing/billingGate',()=>({evaluateBillingGate:async()=>({allowed:true,reasons:[],blockers:[]})}))
vi.mock('@/lib/billing/historyRequest',()=>({ensureHistoricalMeteringRequest:async()=>{throw Error('history_not_expected')}}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:(table:string)=>{
  const filters:Array<[string,unknown]>=[];let max=999
  io.queries.push({table,filters})
  const resolve=()=>{
   let rows:Record<string,unknown>[]=[]
   if(table==='customer_supply_periods')rows=[{id:'period-a',company_id:'company-a',customer_id:'customer-a',metering_point_id:'meter-a',contract_id:'contract-a',customer_site_id:'site-a',site_id:'site-a',start_date:'2027-03-01',end_date:'2027-03-31',status:'active',energy_direction:'consumption'}]
   if(table==='customer_contracts')rows=[io.contract]
   if(table==='contract_price_snapshots')rows=io.snapshots
   for(const [key,value] of filters)rows=rows.filter(row=>row[key]===value)
   return {data:rows.slice(0,max),error:null}
  }
  const query={select:()=>query,eq:(k:string,v:unknown)=>{filters.push([k,v]);return query},in:()=>query,lte:()=>query,gte:()=>query,lt:()=>query,gt:()=>query,or:()=>query,order:()=>query,range:()=>query,is:()=>query,not:()=>query,
   limit:(n:number)=>{max=n;return query},maybeSingle:async()=>{const r=resolve();return {data:r.data[0]??null,error:r.error}},then:(done:(v:unknown)=>unknown)=>Promise.resolve(resolve()).then(done)}
  return query
 },rpc:async(name:string,args:{p_commands:Array<Record<string,unknown>>})=>{expect(name).toBe('gridex_store_billing_underlay_batch');io.commands.push(...args.p_commands);return {data:args.p_commands.map((_,i)=>'underlay-'+i),error:null}},
}}))
import {generateBillingUnderlaysForMonth} from '@/lib/billing/underlayEngine'
const hash='a'.repeat(64)
const snapshot=(id:string,ppv:string,source:string)=>({id,company_id:'company-a',customer_id:'customer-a',contract_id:'contract-a',price_plan_version_id:ppv,price_plan_id:'plan-new',price_book_id:'book-new',source,snapshot_hash:hash,snapshot_quality:'canonical',valid_from:'2027-03-01',valid_to:null,
 snapshot_json:{source,price_area:'SE3',energy_direction:'consumption',price_plan_version_id:ppv,contract_product_version_id:'product-version-new',contract_publication_version_id:'pub-new',legal_bundle_version_id:'legal-new',invoice_fee_sek:id==='new-ledger'?26:19},base_price_components_snapshot:[{source_type:'spot',price_area:'SE3',weight_percent:100}],price_components_snapshot:[]})
beforeEach(()=>{
 io.commands=[];io.queries=[]
 io.contract={id:'contract-a',company_id:'company-a',customer_id:'customer-a',status:'signed',signed_at:'2027-02-01T12:00:00Z',locked_at:'2027-02-01T12:00:00Z',starts_at:'2027-03-01',ends_at:null,
  contract_price_snapshot_id:'new-ledger',price_plan_version_id:'ppv-new',price_plan_id:'plan-new',price_book_id:'book-new',contract_product_id:'product-new',contract_product_version_id:'product-version-new',snapshot_hash:hash,signature_snapshot:{pricing_snapshot_sha256:hash},contract_publication_version_id:'pub-new',legal_bundle_version_id:'legal-new',energy_direction:'consumption',price_area_used:'SE3',price_snapshot:{source:'customer_contract_unsigned_edit'}}
 io.snapshots=[snapshot('old-ledger','ppv-old','signature_prepare'),snapshot('new-ledger','ppv-new','customer_contract_unsigned_edit')]
})
describe('real underlay entrypoint selects a controlled signed revision',()=>{
 it('uses the exact current signed CPS despite retained same-effective-date proposals',async()=>{
  await generateBillingUnderlaysForMonth({companyId:'company-a',customerId:'customer-a',billingMonth:'2027-03'})
  expect(io.commands).toHaveLength(1)
  expect(io.commands[0].underlay).toMatchObject({contract_price_snapshot_id:'new-ledger',price_plan_version_id:'ppv-new',pricing_snapshot:{invoice_fee_sek:26}})
  expect(io.queries.filter(q=>q.table==='contract_price_snapshots').some(q=>q.filters.some(([k,v])=>k==='id'&&v==='new-ledger'))).toBe(true)
 })
 it('holds a missing current CPS without selecting a different proposal',async()=>{
  io.snapshots=io.snapshots.filter(s=>s.id!=='new-ledger')
  await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('billing_unsigned_revision_snapshot_binding_invalid')
  expect(io.commands).toHaveLength(0)
 })
 it('holds a wrong PPV, customer or signed hash instead of silently billing it',async()=>{
  for(const patch of [{price_plan_version_id:'ppv-wrong'},{customer_id:'customer-other'},{snapshot_hash:'b'.repeat(64)}]){
   io.snapshots=[snapshot('old-ledger','ppv-old','signature_prepare'),{...snapshot('new-ledger','ppv-new','customer_contract_unsigned_edit'),...patch}]
   await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('billing_unsigned_revision_snapshot_binding_invalid')
   expect(io.commands).toHaveLength(0)
  }
 })
 it('preserves legacy same-date ambiguity refusal for unrelated contracts',async()=>{
  io.contract.price_snapshot={};io.snapshots=io.snapshots.map(s=>({...s,source:'legacy'}))
  await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('Flera prissnapshots är giltiga samtidigt')
  expect(io.commands).toHaveLength(0)
 })
 it('holds marker loss even when an older proposal has the later validity date',async()=>{
  io.contract.price_snapshot={}
  io.snapshots[0].valid_from='2027-02-01';io.snapshots[1].valid_from='2027-01-01'
  await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('billing_unsigned_revision_snapshot_binding_invalid')
  expect(io.commands).toHaveLength(0)
 })
 it('holds missing current pointer and incomplete frozen graph identities',async()=>{
  for(const key of ['contract_price_snapshot_id','contract_product_version_id','contract_product_id','contract_publication_version_id','legal_bundle_version_id']){
   const saved=io.contract[key];io.contract[key]=null
   await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('billing_unsigned_revision_snapshot_binding_invalid')
   expect(io.commands).toHaveLength(0);io.contract[key]=saved
  }
 })
 it('compares the supply-period customer before storing even a blocked missing-meter underlay',async()=>{
  io.contract.customer_id='customer-other';io.snapshots[1].customer_id='customer-other'
  await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('billing_unsigned_revision_snapshot_binding_invalid')
  expect(io.commands).toHaveLength(0)
 })
 it('holds a price interval that does not cover the complete requested segment',async()=>{
  io.snapshots[1].valid_to='2027-03-20'
  await expect(generateBillingUnderlaysForMonth({companyId:'company-a',billingMonth:'2027-03'})).rejects.toThrow('billing_unsigned_revision_snapshot_binding_invalid')
  expect(io.commands).toHaveLength(0)
 })
})
