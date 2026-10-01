import {afterEach,beforeEach,describe,expect,it,vi}from'vitest'
import {inspect}from'node:util'
import {resolveEffectiveBillingProfile}from'@/lib/billing/effectiveBillingProfile'
import {billingConfigurationSnapshotSha256}from'@/lib/billing/billingConfigurationSnapshot'

type Row=Record<string,unknown>
const f=vi.hoisted(()=>({tables:{}as Record<string,Row[]>,mode:'',terminalAdapterFault:false,dbCalls:[]as string[],
 transport:vi.fn(),rpc:vi.fn(),schema:vi.fn(),governance:vi.fn(),readiness:vi.fn(),underlays:vi.fn(),pricing:vi.fn(),
 diagnostic:{}as Row}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:f.rpc,from(table:string){
 f.dbCalls.push(table)
 const predicates:Array<(r:Row)=>boolean>=[];let insert:Row|null=null,update:Row|null=null,single=false,head=false
 const q={select:(_fields?:string,options?:{head?:boolean})=>{head=options?.head===true;return q},order:()=>q,range:()=>q,limit:()=>q,
  eq:(key:string,value:unknown)=>{predicates.push(r=>JSON.stringify(r[key])===JSON.stringify(value));return q},
  in:(key:string,values:unknown[])=>{predicates.push(r=>values.includes(r[key]));return q},lte:()=>q,contains:()=>q,
  single:()=>{single=true;return q},maybeSingle:()=>{single=true;return q},
  insert:(row:Row)=>{insert=structuredClone(row);return q},update:(row:Row)=>{update=structuredClone(row);return q},
  then:(resolve:(r:unknown)=>unknown,reject?:(error:unknown)=>unknown)=>{
   const fault=(f.mode==='attempt'&&table==='invoice_export_attempts'&&insert)
    ||(['task','blocker'].includes(f.mode)&&table==='customer_operation_tasks'&&insert)
    ||(f.mode==='late-blocker'&&table==='billing_export_run_items'&&update)
    ||(f.mode==='run'&&table==='invoice_export_runs'&&!update)
   if(fault)return Promise.resolve({data:null,error:f.diagnostic}).then(resolve)
   if(f.mode==='thrown-blocker'&&table==='customer_operation_tasks'&&insert)return Promise.reject(f.diagnostic).then(resolve,reject)
   const data=f.tables[table]??[]
   if(insert){insert={id:'synthetic-task',...insert};data.push(insert);f.tables[table]=data}
   let rows=data.filter(r=>predicates.every(p=>p(r)))
   // Deliberate invalid outer-adapter result: exercises the actual sender's
   // defensive terminal-row branch. Not a natural SQL/race reachability claim.
   if(f.terminalAdapterFault&&table==='invoice_export_items'&&!update&&!single){rows=data;f.terminalAdapterFault=false}
   if(update)rows.forEach(r=>Object.assign(r,update))
   return Promise.resolve({data:head?null:structuredClone(single?rows[0]??null:rows),count:rows.length,error:null}).then(resolve)
  }}
 return q
}}}))
vi.mock('@/lib/platform/schemaReadiness',()=>({assertPlatformSchemaReady:f.schema}))
vi.mock('@/lib/platform/outboundFreeze',()=>({assertOutboundAllowed:async()=>undefined}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:f.governance}))
vi.mock('@/lib/automation/locks',()=>({withAutomationLock:async({run}:{run:()=>Promise<unknown>})=>run()}))
vi.mock('@/lib/events/domainEvents',()=>({emitDomainEvent:async()=>undefined}))
vi.mock('@/lib/billing/invoiceReadiness',()=>({lockBillingPeriodForInvoiceExport:async()=>undefined,evaluateBillingMonthInvoiceReadiness:f.readiness}))
vi.mock('@/lib/integrations/billing/capway/auth',()=>({resolveCapwayConnectionConfig:async()=>({companyId:'tenant',environment:'test',
 provider:'capway_aptic',baseUrl:'https://synthetic.invalid',authMode:'apikey',defaultService:'synthetic',defaultFinancingMode:'invoice_service'})}))
vi.mock('@/lib/integrations/billing/capway/client',()=>({CapwayApiError:class extends Error{},CapwayApticClient:class{createInvoices=f.transport}}))
vi.mock('@/lib/cis/db',()=>({listAllBillingUnderlays:f.underlays,listAllMeteringValues:async()=>[],listAllPartnerExports:async()=>[]}))
vi.mock('@/lib/pricing/underlayPricingAdapter',()=>({loadLockedUnderlayPricingWithCore:f.pricing,calculateUnderlayPricingWithCore:vi.fn()}))
vi.mock('@/lib/pricing/engine',()=>({lockPricingPreview:async()=>undefined}))

import {sendInvoiceExportRun,processDueInvoiceExportRetries}from'@/lib/integrations/billing/invoiceExportCore'
import {createBillingExportRun}from'@/lib/billing/exportCenter'

const canaries=['secondary-canary@example.invalid','+46 70 123 45 67','Secondary Canary Fullname','Secondary Canary Street 27',
 'capway_api_key_canary_secondary_123456','sb_secret_canary_secondary_123456']
const raw=canaries.join(' | ')
const send=()=>sendInvoiceExportRun({companyId:'tenant',exportRunId:'run',actorUserId:'staff'})
const create=()=>createBillingExportRun({companyId:'tenant',actorUserId:'staff',periodMonth:'2026-09',targetSystem:'capway_aptic',exportFormat:'csv'})
let errorLog:ReturnType<typeof vi.spyOn>,warnLog:ReturnType<typeof vi.spyOn>
function absent(output:unknown){for(const value of canaries)expect(inspect(output,{depth:12})).not.toContain(value)}
function financial(){return structuredClone({pricing:f.tables.pricing_runs,lines:f.tables.pricing_preview_lines,underlays:f.tables.billing_underlays,
 customers:f.tables.customers,company:f.tables.companies,foreignInvoice:f.tables.customer_invoices[1]})}
beforeEach(()=>{
 vi.clearAllMocks();f.mode='';f.terminalAdapterFault=false;f.dbCalls=[]
 f.diagnostic={code:'23505',message:raw,details:raw,hint:raw,response:{authorization:raw,customer:{email:canaries[0],phone:canaries[1]}}}
 f.schema.mockResolvedValue(undefined);f.governance.mockResolvedValue(undefined)
 const customer={id:'customer',company_id:'tenant',customer_number:'SYNTHETIC-CUSTOMER',customer_type:'private',first_name:'Synthetic',last_name:'Customer',
  phone:'+4600000000',billing_profile_revision:4,billing_profile:{recipient:'Synthetic Receiver',distributionMethod:'email',email:'saved@example.invalid',country:'SE'}}
 const contract={id:'contract',company_id:'tenant',customer_id:'customer',status:'active',billing_profile_override:{},billing_profile_override_revision:0}
 const effective=resolveEffectiveBillingProfile({companyId:'tenant',customerId:'customer',customer,contract})
 const snapshot={schema:'billing_configuration_v2',company_id:'tenant',customer_id:'customer',contract_id:'contract',effective_billing_profile:effective}
 const underlay={id:'underlay',company_id:'tenant',customer_id:'customer',contract_id:'contract',customer_contract_id:'contract',underlay_year:2026,underlay_month:9,
  status:'validated',readiness_status:'ready',missing_values_count:0,total_kwh:1,price_area:'SE3',currency:'SEK',
  billing_configuration_snapshot:snapshot,billing_configuration_snapshot_sha256:billingConfigurationSnapshotSha256(snapshot)}
 f.tables={invoice_export_runs:[{id:'run',company_id:'tenant',billing_month:'2026-09',environment:'test',financing_mode:'invoice_service'}],
  invoice_export_items:[{id:'item',company_id:'tenant',export_run_id:'run',customer_id:'customer',customer_contract_id:'contract',billing_underlay_id:'underlay',
   pricing_run_id:'price',provider:'capway_aptic',environment:'test',financing_mode:'invoice_service',status:'pending',request_payload:{},response_payload:{},
   idempotency_key:'synthetic-durable-key',provider_request_id:null,provider_idempotency_key:null,provider_invoice_guid:null,
   amount_ex_vat:100,vat_amount:25,amount_inc_vat:125,total_kwh:1,attempt_count:0}],
  pricing_runs:[{id:'price',company_id:'tenant',billing_underlay_id:'underlay',status:'locked',locked_at:'2026-09-01',total_ex_vat:100,vat_amount:25,total_inc_vat:125}],
  pricing_preview_lines:[{id:'line',company_id:'tenant',pricing_run_id:'price',description:'Synthetic electricity',quantity:1,amount_ex_vat:100,amount_inc_vat:125,vat_amount:25,vat_rate:0.25}],
  customers:[customer],customer_contracts:[contract],billing_underlays:[underlay],companies:[{id:'tenant',name:'Synthetic Issuer',org_number:'556000-0000'}],
  customer_invoices:[{id:'invoice',company_id:'tenant',invoice_export_item_id:'item',status:'draft',total_kwh:1,amount_ex_vat:100,vat_amount:25,amount_inc_vat:125},
   {id:'foreign-issued',company_id:'foreign',status:'sent',provider_invoice_guid:'original-guid',amount_inc_vat:999,document_hash:'original-document-hash',raw_payload:{original:'immutable'}}],
  billing_export_run_items:[{id:'item',company_id:'tenant'}],billing_export_runs:[{id:'run',company_id:'tenant'}],
  billing_export_readiness_v:[{company_id:'tenant',billing_underlay_id:'underlay',is_exportable:false,status:'blocked',blockers:['missing_values']}],
  invoice_export_attempts:[],invoice_dead_letters:[],invoice_purchase_events:[],customer_operation_tasks:[]}
 f.transport.mockResolvedValue({invoiceGuids:['synthetic-provider-guid'],invoiceNumber:'SYNTHETIC-1'})
 f.readiness.mockResolvedValue({readyUnderlayIds:[],readyUnderlayCount:0,issues:[]})
 f.underlays.mockImplementation(async({companyId}:{companyId:string})=>{expect(companyId).toBe('tenant');return structuredClone(f.tables.billing_underlays)})
 f.pricing.mockResolvedValue({status:'success',locked:true,pricingRunId:'price',warnings:[],errors:[],lines:[],subtotalSekExVat:100,vatSek:25,totalSekIncVat:125})
 f.rpc.mockImplementation(async(name:string,args:{p_run:Row;p_items:Row[];p_invoices:Row[]})=>{
  expect(name).toBe('gridex_create_invoice_export_graph_v1');expect(args.p_run.company_id).toBe('tenant')
  expect(args.p_items).toEqual([]);expect(args.p_invoices).toEqual([])
  f.tables.billing_export_runs.push(structuredClone(args.p_run.legacy_run as Row))
  f.tables.billing_export_run_items.push(...structuredClone(args.p_run.legacy_items as Row[]))
  return {data:{run_id:args.p_run.id,legacy_run:args.p_run.legacy_run},error:null}
 })
 errorLog=vi.spyOn(console,'error').mockImplementation(()=>undefined);warnLog=vi.spyOn(console,'warn').mockImplementation(()=>undefined)
})
afterEach(()=>{errorLog.mockRestore();warnLog.mockRestore()})

it('actual sent outcome survives an attempt-audit persistence fault without leaking raw diagnostics',async()=>{
 f.mode='attempt';const before=financial(),result=await send()
 expect(result).toMatchObject({status:'sent',sent:1,failed:0});expect(f.transport).toHaveBeenCalledOnce()
 expect(f.tables.invoice_export_items[0]).toMatchObject({status:'sent',provider_invoice_guid:'synthetic-provider-guid',provider_request_id:'synthetic-durable-key'})
 expect(f.tables.invoice_export_items[0].request_payload).not.toEqual({});expect(f.tables.invoice_export_attempts).toEqual([])
 expect(financial()).toEqual(before);expect(errorLog).toHaveBeenCalledOnce();absent(errorLog.mock.calls)
 expect(inspect(errorLog.mock.calls,{depth:12})).toContain('23505')
})
it('actual sender rejects a terminal row from a faulty outer adapter; correction-task failure has safe diagnostics and zero provider effects',async()=>{
 f.mode='task';f.tables.invoice_export_items[0].status='sent';f.tables.invoice_export_items[0].provider_invoice_guid='original-guid'
 f.tables.invoice_export_items[0].request_payload={original:'historical-request'};f.terminalAdapterFault=true
 const before=financial(),item=structuredClone(f.tables.invoice_export_items[0]),result=await send()
 expect(result.results[0]).toMatchObject({status:'sent',errorCode:'resend_blocked'})
 expect(f.transport).not.toHaveBeenCalled();expect(f.tables.invoice_export_items[0]).toEqual(item);expect(financial()).toEqual(before)
 expect(f.tables.customer_operation_tasks).toEqual([]);expect(warnLog).toHaveBeenCalledOnce();absent(warnLog.mock.calls)
 expect(inspect(warnLog.mock.calls,{depth:12})).toContain('23505')
})
it('actual due-retry missing-run error logs a safe technical reason and leaves item/provider evidence unchanged',async()=>{
 f.mode='run';Object.assign(f.tables.invoice_export_items[0],{status:'failed_retryable',next_retry_at:'2026-09-01T00:00:00Z'})
 const before=structuredClone(f.tables),result=await processDueInvoiceExportRetries({companyId:'tenant'})
 expect(result).toMatchObject({processed:0,sent:0,failed:0,results:[]});expect(f.transport).not.toHaveBeenCalled();expect(f.tables).toEqual(before)
 expect(errorLog).toHaveBeenCalledOnce();absent(errorLog.mock.calls);expect(inspect(errorLog.mock.calls,{depth:12})).toContain('23505')
})
describe.each(['blocker','thrown-blocker','late-blocker'])('actual legacy graph caller %s secondary failure',mode=>{
 it('retains the confirmed blocked graph receipt and safe diagnostic with no canonical invoice/provider/financial effect',async()=>{
  f.mode=mode;const before=financial(),result=await create()
  expect(result).toMatchObject({status:'blocked',rows_ready:0,rows_blocked:1});expect(f.rpc).toHaveBeenCalledOnce()
  expect(f.transport).not.toHaveBeenCalled();expect(financial()).toEqual(before)
  expect(f.tables.customer_operation_tasks).toHaveLength(mode==='late-blocker'?1:0)
  const item=f.tables.billing_export_run_items.find(row=>row.billing_export_run_id===result.id)
  expect(item).toMatchObject({company_id:'tenant',status:'blocked'});expect(item?.blocker_case_id).toBeUndefined()
  if(mode==='late-blocker')expect(f.tables.customer_operation_tasks[0].metadata).toMatchObject({exportRunId:result.id,exportRunItemId:item?.id})
  expect(warnLog).toHaveBeenCalledOnce();absent(warnLog.mock.calls);expect(inspect(warnLog.mock.calls,{depth:12})).toContain('23505')
 })
})
it('existing missing attempt table remains a tolerated outcome without any diagnostic',async()=>{
 f.mode='attempt';f.diagnostic={code:'42P01',message:raw};expect(await send()).toMatchObject({status:'sent'})
 expect(errorLog).not.toHaveBeenCalled();expect(warnLog).not.toHaveBeenCalled()
})
it('actual sender schema denial happens before any database or transport effect',async()=>{
 const denied=new Error('schema_denied');f.schema.mockRejectedValue(denied)
 await expect(send()).rejects.toBe(denied);expect(f.dbCalls).toEqual([]);expect(f.transport).not.toHaveBeenCalled()
 expect(errorLog).not.toHaveBeenCalled();expect(warnLog).not.toHaveBeenCalled()
})
it('actual graph current-company governance denial happens before readiness, reads, RPC or secondary diagnostic',async()=>{
 const denied=new Error('tenant_paused');f.governance.mockRejectedValue(denied)
 await expect(create()).rejects.toBe(denied);expect(f.readiness).not.toHaveBeenCalled();expect(f.dbCalls).toEqual([]);expect(f.rpc).not.toHaveBeenCalled()
 expect(errorLog).not.toHaveBeenCalled();expect(warnLog).not.toHaveBeenCalled()
})
it('actual installed Next redirect remains propagated from both early current-authority guards',async()=>{
 const {redirect}=await import('next/navigation');let control:unknown
 try{redirect('/synthetic-control')}catch(error){control=error}
 expect(control).toBeTruthy();f.schema.mockRejectedValue(control);f.governance.mockRejectedValue(control)
 await expect(send()).rejects.toBe(control);await expect(create()).rejects.toBe(control)
 expect(f.dbCalls).toEqual([]);expect(f.rpc).not.toHaveBeenCalled();expect(errorLog).not.toHaveBeenCalled();expect(warnLog).not.toHaveBeenCalled()
})
