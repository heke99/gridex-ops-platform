// reality-defects: H3d execute the real contract DB module and admin action, with
// declared data/auth ports. SQL transaction effects are proved in the companion test.
import {beforeEach,expect,it,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import * as ts from 'typescript'
const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url)
const company='11111111-1111-4111-8111-111111111111',customer='55555555-5555-4555-8555-555555555555',contract='88888888-8888-4888-8888-888888888888'
let current:Record<string,unknown>,log:string[],rpcError:unknown,rpcData:Record<string,unknown>|null|undefined,transportError:Error|null,supplyRows:Record<string,unknown>[],missingRpcs:Set<string>,rpcArgs:Array<{name:string;args:Record<string,unknown>}>
const compile=(path:string,resolve:(p:string)=>unknown)=>{const out:Record<string,(...args:never[])=>unknown>={};runInNewContext(ts.transpileModule(readFileSync(root+'/'+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,require:resolve,FormData,File:globalThis.File,Date},{filename:path});return out}
// Actual whole modules, without source replacements. Only unused integration
// ports and this test's authenticated synthetic database transport are supplied.
const load=()=>{
 const service={from(table:string){let payload:Record<string,unknown>|undefined;let rows=supplyRows.slice();const query={select(){return query},eq(k:string,v:unknown){if(table==='customer_supply_periods')rows=rows.filter(row=>row[k]===v);return query},or(){return query},in(k:string,values:string[]){log.push('supply_read');return Promise.resolve({data:rows.filter(row=>values.includes(String(row[k]))),error:null})},maybeSingle(){return Promise.resolve({data:table==='customer_contract_notice_terms'?{notice_days:14}:{...current},error:null})},insert(v:Record<string,unknown>){payload=v;log.push('direct_insert');return query},update(v:Record<string,unknown>){payload=v;log.push('direct_update');return query},single(){Object.assign(current,payload);return Promise.resolve({data:{...current},error:null})}};if(table!=='customer_contracts'&&table!=='customer_supply_periods'&&table!=='customer_contract_notice_terms')throw Error('unexpected_table:'+table);return query},
 async rpc(name:string,args:Record<string,unknown>){log.push(name);rpcArgs.push({name,args});if(missingRpcs.has(name))return {data:null,error:{code:'PGRST202',message:'missing_new_rpc:'+name}};if(name==='gridex_customer_contract_terminal_basis_v1')return {data:{contract:{...current},source_hash:'a'.repeat(64)},error:null};if(transportError)throw transportError;if(rpcError)return{data:null,error:rpcError};if(name==='gridex_update_customer_contract_terminal_v1'){
  expect(args.p_expected).toEqual(expect.objectContaining({id:contract,status:'active'}));expect(args.p_actor_user_id).toBe('abababab-abab-4bab-8bab-abababababab');expect(args.p_expected_hash).toBe('a'.repeat(64))
  current={...current,...args.p_patch as Record<string,unknown>};return {data:rpcData===undefined?{contract:{...current},lifecycle_recorded:true}:rpcData,error:null}
 }return {data:{event:{id:'33333333-3333-4333-8333-333333333333'}},error:null}}}
 const time=compile('lib/time/stockholm.ts',p=>require(p))
 const life=compile('lib/customer-contracts/lifecycle.ts',p=>p==='@/lib/time/stockholm'?time:require(p))
 const tenant=compile('lib/supabase/tenantDb.ts',p=>p==='@/lib/supabase/service'?{supabaseService:service}:require(p))
 const tenantQueries=compile('lib/supabase/tenantQuery.ts',p=>p==='@/lib/supabase/tenantDb'?tenant:p==='@/lib/supabase/service'?{supabaseService:service}:require(p))
 const db=compile('lib/customer-contracts/db.ts',p=>p==='@/lib/supabase/tenantQuery'?tenantQueries:p==='@/lib/supabase/service'?{supabaseService:service}:p==='./lifecycle'?life:p==='@/lib/time/stockholm'?time:require(p))
 const helpers=compile('components/admin/customers/contracts/helpers.ts',()=>life)
 const signing=compile('lib/customer-contracts/signingMethod.ts',p=>require(p)),vat=compile('lib/pricing/vat.ts',p=>require(p))
 const noop=async()=>{},generic=new Proxy({},{get:()=>noop})
 const actions=compile('components/admin/customers/contracts/actions.ts',p=>{
  if(p==='@/lib/customer-contracts/signingMethod')return signing;if(p==='@/lib/pricing/vat')return vat;if(p==='@/lib/customer-contracts/db')return db;if(p==='./helpers')return helpers;if(p==='@/lib/supabase/service')return {supabaseService:service}
  if(p==='@/lib/supabase/server')return {createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'abababab-abab-4bab-8bab-abababababab'}}})}})}
  if(p==='@/lib/tenant/entityGuards')return {loadCustomerTenantContext:async()=>({companyId:company}),assertContractTenant:noop,assertCustomerSiteTenant:noop,assertMeteringPointTenant:noop}
  if(p==='@/lib/admin/guards')return {requireAdminActionAccess:async()=>({})}
  if(p==='@/lib/customer-contracts/pricingValidation')return {catalogPricesOverridden:()=>false,validateContractPricing:()=>[],firstContractPricingError:()=>null}
  return generic
 })
 return {db,actions}
}
beforeEach(()=>{vi.useRealTimers();current={id:contract,company_id:company,customer_id:customer,status:'active',contract_name:'Existing',contract_type:'variable_hourly',contract_offer_id:'99999999-9999-4999-8999-999999999999',contract_publication_version_id:'99999999-9999-4999-8999-999999999999',vat_rate:0.25};log=[];rpcError=null;rpcData=undefined;transportError=null;supplyRows=[];missingRpcs=new Set();rpcArgs=[]})
const form=(status='cancelled')=>{const f=new FormData();for(const[k,v]of Object.entries({customer_id:customer,customer_contract_id:contract,status,contract_type:'variable_hourly'}))f.set(k,v);return f}
const update=async(status='cancelled')=>load().actions.updateContractAction(form(status) as never)
for(const status of ['cancelled','terminated'])it(`uses one atomic command for ${status}, without direct update or duplicate event writes`,async()=>{
 await update(status);expect(log).toEqual(['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1']);expect(current.status).toBe(status)
})
it('does not write or fall back after a known database refusal',async()=>{
 rpcError={code:'23514',message:'contract_supply_still_open'};await expect(update()).rejects.toEqual(rpcError)
 expect(log).toEqual(['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1']);expect(current.status).toBe('active')
})
it('does not fall back or retry after a transport failure',async()=>{
 transportError=new Error('network outcome unknown');await expect(update()).rejects.toThrow('network outcome unknown');expect(log).toEqual(['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1'])
})
it('holds an unconfirmed response even if the database may already have committed',async()=>{
 rpcData=null;await expect(update()).rejects.toThrow('customer_contract_terminal_update_outcome_unconfirmed')
 expect(current.status).toBe('cancelled');expect(log).toEqual(['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1'])
})
for(const kind of ['tenant','contract','status','receipt'])it(`refuses a mismatched ${kind} response without another write`,async()=>{
 rpcData={contract:{...current,status:'cancelled'},lifecycle_recorded:true}
 if(kind==='tenant')(rpcData.contract as Record<string,unknown>).company_id='22222222-2222-4222-8222-222222222222'
 if(kind==='contract')(rpcData.contract as Record<string,unknown>).id='99999999-9999-4999-8999-999999999999'
 if(kind==='status')(rpcData.contract as Record<string,unknown>).status='active'
 if(kind==='receipt')rpcData.lifecycle_recorded=false
 await expect(update()).rejects.toThrow('customer_contract_terminal_update_outcome_unconfirmed');expect(log).toEqual(['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1'])
})
it('retains the original nonterminal direct-update path',async()=>{
 const {db}=load();await db.updateCustomerContract({id:contract,customerId:customer,companyId:company,status:'draft',contractName:'Existing',contractType:'variable_hourly',actorUserId:'abababab-abab-4bab-8bab-abababababab'} as never)
 expect(log).toEqual(['direct_update']);expect(current.status).toBe('draft')
})

it('B3 refuses a future manual event that would preempt currently ongoing ending supply',async()=>{
 const future=new Date(Date.now()+7*86400000).toISOString().slice(0,10),later=new Date(Date.now()+30*86400000).toISOString()
 supplyRows=[{company_id:company,customer_contract_id:contract,status:'ending',end_date:future}]
 const {db}=load();await expect(db.addCustomerContractEvent({companyId:company,customerContractId:contract,customerId:customer,eventType:'cancelled',happenedAt:later} as never)).rejects.toThrow(/pågående leverans/)
 expect(log).toEqual(['supply_read'])
})

for(const [instant,day] of [['2026-10-23T22:30:00Z','2026-10-24'],['2026-01-01T00:30:00+02:00','2025-12-31'],['2025-12-31T23:30:00Z','2026-01-01'],['2026-07-01T22:30:00Z','2026-07-02'],['2026-10-24','2026-10-24']])it(`uses the Stockholm day for manual event ${instant}`,async()=>{
 supplyRows=[{company_id:company,customer_contract_id:contract,status:'ending',end_date:day}]
 const {db}=load();await db.addCustomerContractEvent({companyId:company,customerContractId:contract,customerId:customer,eventType:'cancelled',happenedAt:instant,actorUserId:'abababab-abab-4bab-8bab-abababababab'} as never)
 expect(log).toEqual(['supply_read','gridex_record_manual_customer_contract_event_v1'])
})

const missingNew=()=>new Set(['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1','gridex_record_manual_customer_contract_event_v1'])
it('app-first nonterminal update keeps the original canonical event path when every new RPC is missing',async()=>{
 missingRpcs=missingNew();await update('active')
 expect(log).toEqual(['direct_update','gridex_record_customer_contract_event_v1']);expect(current.status).toBe('active')
})
it('app-first draft creation keeps its original created-event path when every new RPC is missing',async()=>{
 missingRpcs=missingNew();const {actions}=load();const f=form('draft');f.set('contract_name','Fixture draft');f.set('signing_method','draft')
 await actions.createContractAction(f as never)
 expect(log).toEqual(['direct_insert','gridex_record_customer_contract_event_v1']);expect(current.status).toBe('draft')
})
for(const missing of ['gridex_customer_contract_terminal_basis_v1','gridex_update_customer_contract_terminal_v1'])it(`terminal update with missing ${missing} has no direct-write or event fallback`,async()=>{
 missingRpcs.add(missing);await expect(update()).rejects.toEqual(expect.objectContaining({code:'PGRST202'}))
 expect(current.status).toBe('active');expect(log).not.toContain('direct_update');expect(log).not.toContain('gridex_record_customer_contract_event_v1')
})
it('terminal event with missing manual RPC has no canonical-event fallback',async()=>{
 missingRpcs.add('gridex_record_manual_customer_contract_event_v1');const {db}=load()
 await expect(db.addCustomerContractEvent({companyId:company,customerContractId:contract,customerId:customer,eventType:'cancelled',happenedAt:'2026-10-24',actorUserId:'abababab-abab-4bab-8bab-abababababab'} as never)).rejects.toEqual(expect.objectContaining({code:'PGRST202'}))
 expect(current.status).toBe('active');expect(log).toEqual(['supply_read','gridex_record_manual_customer_contract_event_v1'])
})
for(const [instant,derived] of [['2026-10-23T22:30:00Z','2026-11-07'],['2026-07-01T22:30:00Z','2026-07-16'],['2025-12-31T23:30:00Z','2026-01-15'],['2026-01-01T00:30:00+02:00','2026-01-14'],['2026-10-24','2026-11-07']])it(`derives notice days from the Swedish calendar while retaining event instant ${instant}`,async()=>{
 current={...current,starts_at:'2025-01-01',ends_at:null,binding_months:0,notice_months:0}
 const {db}=load();await db.addCustomerContractEvent({companyId:company,customerContractId:contract,customerId:customer,eventType:'termination_notice_received',happenedAt:instant,actorUserId:'abababab-abab-4bab-8bab-abababababab'} as never)
 expect(rpcArgs).toHaveLength(1);expect(rpcArgs[0].name).toBe('gridex_record_customer_contract_event_v1')
 expect(rpcArgs[0].args.p_happened_at).toBe(instant);expect(rpcArgs[0].args.p_derived_ends_at).toBe(derived)
})
it('blank notice time uses the current Swedish calendar at the UTC day boundary',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T22:30:00Z'))
 try {current={...current,starts_at:'2025-01-01',ends_at:null,binding_months:0,notice_months:0};const {db}=load()
  await db.addCustomerContractEvent({companyId:company,customerContractId:contract,customerId:customer,eventType:'termination_notice_received',actorUserId:'abababab-abab-4bab-8bab-abababababab'} as never)
  expect(rpcArgs[0].args.p_happened_at).toBe('2026-10-23T22:30:00.000Z');expect(rpcArgs[0].args.p_derived_ends_at).toBe('2026-11-07')
 } finally {vi.useRealTimers()}
})
