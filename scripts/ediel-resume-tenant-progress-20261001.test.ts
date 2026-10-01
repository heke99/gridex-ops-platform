import {createRequire}from'node:module'
import {NextRequest}from'next/server'
import {afterEach,beforeEach,describe,expect,it,vi}from'vitest'
const state=vi.hoisted(()=>({service:null as null|{from:(table:string)=>unknown;rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>},external:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{if(!state.service)throw new Error('core_missing');return state.service.from(table)},rpc:(name:string,args:Record<string,unknown>)=>{if(!state.service)throw new Error('core_missing');return state.service.rpc(name,args)}}}))
// Actual route and resume engine execute; unrelated cron workers are isolated.
vi.mock('@/lib/customer-operations/automation',()=>({processCustomerOperationJobs:vi.fn(async()=>({processed:0}))}))
vi.mock('@/lib/customer-operations/automationConfig',()=>({validateAutomationUserConfig:vi.fn(async()=>({ok:false,issue:'synthetic_no_activation_actor',message:'Activation held'}))}))
vi.mock('@/lib/customer-operations/facilityLookupEdifactDispatch',()=>({processReadyFacilityLookupEdifactDispatches:vi.fn(async()=>({processed:0})),dispatchFacilityLookupEdifact:state.external}))
vi.mock('@/lib/ediel/operations/z01ResponseSlaWatchdog',()=>({runZ01ResponseSlaWatchdog:vi.fn(async()=>({processed:0}))}))
vi.mock('@/lib/operations/powerOfAttorneyExpiry',()=>({expireOverduePowersOfAttorney:vi.fn(async()=>({processed:0}))}))
vi.mock('@/lib/operations/supplierSwitchActivationSweep',()=>({processReadySupplierSwitchActivations:state.external}))
vi.mock('@/lib/website/customerApplicationReconciliation',()=>({reconcileCustomerApplicationContinuationJobs:vi.fn(async()=>({processed:0}))}))
vi.mock('@/lib/website/legacyFacilityRequestReconciliation',()=>({reconcileLegacyFacilityRequestLinks:vi.fn(async()=>({processed:0}))}))
vi.mock('@/lib/energy/pendingExactAddressResolution',()=>({processPendingExactAddressResolutions:vi.fn(async()=>({processed:0}))}))
vi.mock('@/lib/ediel/flows/prodatSwitch',()=>({prepareAndQueueProdatSwitch:state.external}))
vi.mock('@/lib/ediel/flows/prodatCustomerMasterdata',()=>({prepareAndQueueProdatZ01FromDataRequest:state.external}))
vi.mock('@/lib/ediel/flows/utiltsDataRequest',()=>({prepareAndQueueUtiltsE73:state.external,prepareAndQueueUtiltsE66:state.external}))
import {resumeStuckEdielIntents}from'@/lib/ediel/intent/resumeStuckIntents'
import {GET}from'@/app/api/internal/customer-operations/cron/route'
type Core={db:{close:()=>Promise<void>;query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>},service:{from:(table:string)=>unknown;rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>},
 seed:(phase:'validated'|'draft',noisy?:number,quiet?:number)=>Promise<{A:string[];B:string[]}>,counts:()=>Promise<Array<{company_id:string;validation_status:string;total:number}>>,
 reads:unknown[],writes:unknown[],A:string,B:string}
const {createResumeCore}=createRequire(import.meta.url)('./ediel-resume-tenant-progress-20261001-core.cjs')as{createResumeCore:()=>Promise<Core>}
let f:Core
beforeEach(async()=>{f=await createResumeCore();state.service=f.service;state.external.mockReset();vi.stubEnv('CUSTOMER_OPERATION_CRON_SECRET','synthetic-local-secret');vi.spyOn(console,'error').mockImplementation(()=>{})})
afterEach(async()=>{expect(state.external).not.toHaveBeenCalled();state.service=null;await f.db.close();vi.unstubAllEnvs();vi.restoreAllMocks()})
const blockedB=async()=> (await f.counts()).filter(row=>row.company_id===f.B&&row.validation_status==='blocked').reduce((sum,row)=>sum+row.total,0)
describe.sequential('actual global cron/resume tenant progress; real table SQL, zero render/send/activation',()=>{
 for(const phase of['validated','draft']as const){
  it(`global ${phase} batch attempts quiet tenant within a capped first batch`,async()=>{
   await f.seed(phase)
   const response=await GET(new NextRequest('http://localhost/api/internal/customer-operations/cron?limit=25',{headers:{authorization:'Bearer synthetic-local-secret'}}))
   expect(response.status).toBe(200)
   const body=await response.json();expect(body.result.resumedIntents.candidates).toBeGreaterThan(0)
   // Canonical missing-facility/metadata guards must still block, never dispatch.
   const counts=await f.counts(),attemptedA=counts.filter(row=>row.company_id===f.A&&row.validation_status==='blocked').reduce((s,row)=>s+row.total,0)
   console.info('EDIEL_RESUME_TENANT_PROGRESS_DIAGNOSTIC',{phase,noisyAttempted:attemptedA,quietAttempted:await blockedB()})
   expect(counts.filter(row=>row.validation_status==='blocked').reduce((s,row)=>s+row.total,0)).toBeLessThanOrEqual(25)
   expect(await blockedB()).toBe(1)
  })
 }
 it('global limit-one successive batches rotate tenants instead of walking a noisy backlog',async()=>{
  await f.seed('validated')
  await resumeStuckEdielIntents({limit:1});await resumeStuckEdielIntents({limit:1})
  console.info('EDIEL_RESUME_TENANT_PROGRESS_DIAGNOSTIC',{phase:'validated-two-limit-one',counts:await f.counts()})
  expect(await blockedB()).toBe(1)
 })
 for(const phase of['validated','draft']as const){
  it(`explicit quiet-company ${phase} path is scoped and preserves the noisy graph`,async()=>{
   await f.seed(phase)
   const before=(await f.db.query('select to_jsonb(t) as row from public.ediel_message_intents t where company_id=$1 order by id',[f.A])).rows
   const result=await resumeStuckEdielIntents({companyId:f.B,limit:25})
   expect(result.candidates).toBe(1);expect(result.blocked).toBe(1);expect(await blockedB()).toBe(1)
   expect((await f.db.query('select to_jsonb(t) as row from public.ediel_message_intents t where company_id=$1 order by id',[f.A])).rows).toEqual(before)
  })
 }
 it('unauthorized actual cron never reads, mutates, renders, sends or activates',async()=>{
  await f.seed('validated')
  const response=await GET(new NextRequest('http://localhost/api/internal/customer-operations/cron?limit=25'))
  expect(response.status).toBe(401);expect(f.reads).toHaveLength(0);expect(f.writes).toHaveLength(0)
 })
 it('one actual claimed check error persists a safe failed receipt while the quiet tenant still progresses',async()=>{
  await f.seed('validated',1,1)
  const original=f.service.rpc.bind(f.service),canary='SYNTHETIC_SECRET_DO_NOT_EXPOSE'
  f.service.rpc=async(name,args)=>name==='gridex_check_ediel_resume_claim_v1'&&args.p_company_id===f.A
   ?{data:null,error:{code:'XX000',message:canary}}:original(name,args)
  const result=await resumeStuckEdielIntents({limit:25})
  expect(await blockedB()).toBe(1);expect(JSON.stringify(result)).not.toContain(canary)
  expect(result.errors).toHaveLength(1);expect(result.errors[0]).toContain('ediel_resume_dispatch_failed')
  expect((await f.db.query("select outcome,failure_reason from private.ediel_resume_claims where company_id=$1",[f.A])).rows)
   .toEqual([{outcome:'failed',failure_reason:'ediel_resume_dispatch_failed'}])
 })
 it('one completion error remains explicit and cannot stop the next claimed tenant',async()=>{
  await f.seed('validated',1,1)
  const original=f.service.rpc.bind(f.service)
  f.service.rpc=async(name,args)=>name==='gridex_finish_ediel_resume_claim_v1'&&args.p_company_id===f.A
   ?{data:null,error:{message:'SYNTHETIC_PRIVATE_DATABASE_TEXT'}}:original(name,args)
  const result=await resumeStuckEdielIntents({limit:25})
  expect(await blockedB()).toBe(1);expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toContain('ediel_resume_completion_unavailable');expect(JSON.stringify(result)).not.toContain('PRIVATE_DATABASE_TEXT')
  expect((await f.db.query("select finished_at from private.ediel_resume_claims where company_id=$1",[f.A])).rows).toEqual([{finished_at:null}])
 })
 it('missing claim RPC fails closed before legacy table selection or dispatch',async()=>{
  await f.seed('validated',1,1);f.service.rpc=async()=>({data:null,error:{code:'42883',message:'private scanner or key text'}})
  await expect(resumeStuckEdielIntents({limit:25})).rejects.toThrow('ediel_resume_claim_unavailable')
  expect(f.reads).toHaveLength(0);expect(f.writes).toHaveLength(0)
 })

})
