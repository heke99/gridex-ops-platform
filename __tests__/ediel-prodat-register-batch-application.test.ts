import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approveEdielInboundCase, createOrUpdateInboundProdatCase, parseInboundProdatBusinessData, rejectEdielInboundCase, type EdielInboundCaseRow } from '@/lib/ediel/inboundCases'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { line, qty, common, raw } from './fixtures/prodat-register'
import { approveEdielInboundCaseAction } from '@/app/admin/ediel/actions.part-5'
vi.mock('@/lib/admin/guards',()=>({requireAdminActionAccess:vi.fn(async()=>({userId:'actor'})),requireCompanyScopedActionAccess:vi.fn(async()=>({userId:'actor'}))}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/app/admin/ediel/actions.part-1',()=>({formString:(v:unknown)=>typeof v==='string'?v.trim()||null:null,revalidateEdiel:vi.fn()}))


// Database and canonical graph RPC boundaries are explicit in-memory fakes.
// These tests exercise the actual orchestration, not a live database commit.
const boundary=vi.hoisted(()=>({from:vi.fn(),graph:vi.fn(),event:vi.fn(),link:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:boundary.from}}))
vi.mock('@/lib/customers/canonicalOnboarding',async importOriginal=>({...await importOriginal<typeof import('@/lib/customers/canonicalOnboarding')>(),onboardCustomerGraph:boundary.graph}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:boundary.event,linkEdielMessage:boundary.link}))
type Decision={meteringPointId:string;identityAgency:string;mode:'create_new_customer'|'update_existing_customer'|'link_existing_only';selectedCustomerId?:string;selectedSiteId?:string;selectedMeteringPointId?:string}
const approve=approveEdielInboundCase as (p:Parameters<typeof approveEdielInboundCase>[0]&{companyId:string;objectDecisions?:Decision[]})=>ReturnType<typeof approveEdielInboundCase>
let stored:EdielInboundCaseRow, message:EdielMessageRow, clock:number, failB:boolean, loseAResponse:boolean
let committed:Map<string,Record<string,unknown>>, writes:string[], graphRows:Record<string,Record<string,unknown>[]>
const keyValue=(row:Record<string,unknown>,key:string)=>{
 const value=key.split(/->>?/).reduce<unknown>((v,k)=>v && typeof v==='object' ? (v as Record<string,unknown>)[k] : null,row) ?? null
 return key.includes('->>') && value!==null ? String(value) : value
}
beforeEach(()=>{
 vi.clearAllMocks();clock=0;failB=false;loseAResponse=false;committed=new Map();writes=[];graphRows={customers:[],customer_sites:[],metering_points:[]}
 message={id:'message',company_id:'company',direction:'inbound',message_family:'PRODAT',message_code:'Z04',raw_payload:raw([line('1','A','1'),qty('10'),...common('A','Customer A'),line('2','A','2'),qty('20'),line('3','B'),qty('30'),...common('B','Customer B')],'Z04'),parsed_payload:{},environment:'test'} as EdielMessageRow
 const parsed=parseInboundProdatBusinessData(message)
 stored={id:'case',company_id:'company',ediel_message_id:'message',case_type:parsed.caseType,message_family:'PRODAT',message_code:'Z04',transaction_type:parsed.transactionType,status:'pending_review',customer_id:null,site_id:null,metering_point_id:null,match_confidence:0,parsed_customer:parsed.customer,parsed_site:parsed.site,parsed_metering_point:parsed.meteringPoint,parsed_contract:parsed.contract,parsed_production:parsed.production,proposed_action:parsed.proposedAction,review_decision:null,reviewed_by:null,reviewed_at:null,applied_at:null,failure_reason:null,created_at:'0',updated_at:'0',created_by:'actor',updated_by:'actor'}
 boundary.from.mockImplementation((table:string)=>{
  let change:Record<string,unknown>|null=null;const filters:((row:Record<string,unknown>)=>boolean)[]=[]
  const query={select:vi.fn(()=>query),update:vi.fn((p:Record<string,unknown>)=>{change=p;return query}),insert:vi.fn(()=>query),eq:vi.fn((k:string,v:unknown)=>{filters.push(row=>k==='review_decision' ? JSON.stringify(keyValue(row,k))===JSON.stringify(JSON.parse(v as string)) : v!==null && keyValue(row,k)===v);return query}),is:vi.fn((k:string,v:unknown)=>{filters.push(row=>keyValue(row,k)===v);return query}),in:vi.fn((k:string,v:unknown[])=>{filters.push(row=>v.includes(keyValue(row,k)));return query}),or:vi.fn(()=>query),limit:vi.fn(()=>query),maybeSingle:vi.fn(async()=>execute()),single:vi.fn(async()=>execute()),then:undefined as unknown}
  function execute(){
   if(table==='grid_owners')return {data:null,error:null}
   if(table==='ediel_messages')return {data:filters.every(f=>f(message as unknown as Record<string,unknown>))?structuredClone(message):null,error:null}
   if(table==='audit_logs')return {data:null,error:null}
   if(graphRows[table])return {data:graphRows[table].find(row=>filters.every(f=>f(row))) ?? null,error:null}
   if(table!=='ediel_inbound_cases')throw new Error(`Unexpected table ${table}`)
   if(!filters.every(f=>f(stored as unknown as Record<string,unknown>)))return {data:null,error:null}
   if(change){writes.push(String(change.status ?? 'receipt'));stored={...stored,...structuredClone(change),updated_at:String(++clock)} as EdielInboundCaseRow}
   return {data:structuredClone(stored),error:null}
  }
  query.then=(resolve:(v:ReturnType<typeof execute>)=>void)=>Promise.resolve(execute()).then(resolve)
  return query
 })
 boundary.graph.mockImplementation(async(command:Record<string,unknown>,context:{companyId:string})=>{
  expect(command.company_id).toBe('company');expect(context.companyId).toBe('company')
  const key=command.idempotency_key as string, id=(command.metering_point as Record<string,unknown>).meter_point_id
  if(committed.has(key))return committed.get(key)
  if(id==='B' && failB)throw new Error('B deliberately failed')
  const result={ok:true,code:'customer_onboarding_committed',operation_id:`op-${id}`,correlation_id:`corr-${id}`,customer_id:command.existing_customer_id ?? `customer-${id}`,site_id:command.existing_site_id ?? `site-${id}`,metering_point_id:command.existing_metering_point_id ?? `meter-${id}`,application_id:`application-${id}`}
  committed.set(key,result)
  if(id==='A' && loseAResponse){loseAResponse=false;throw new Error('response lost after A commit')}
  return result
 })
})
const decisions=():Decision[]=>[{meteringPointId:'A',identityAgency:'89',mode:'create_new_customer'},{meteringPointId:'B',identityAgency:'89',mode:'create_new_customer'}]
const params=()=>({actorUserId:'actor',caseId:'case',companyId:'company',objectDecisions:decisions()})
const batch=()=>stored.review_decision?.objectApplication as {receipts:unknown[]}|undefined

describe('explicit object-scoped customer graph application with durable receipts',()=>{
 it('actual admin action completes and resumes per-object choices without a legacy mode',async()=>{
  const f=new FormData();f.set('caseId','case')
  for(const id of ['A','B'])for(const [key,value] of Object.entries({objectMeteringPointId:id,objectIdentityAgency:'89',objectMode:'create_new_customer',objectCustomerId:'',objectSiteId:'',objectMeteringPointDbId:''}))f.append(key,value)
  failB=true
  await expect(approveEdielInboundCaseAction(f)).rejects.toThrow('B deliberately failed')
  expect(batch()?.receipts).toHaveLength(1)
  failB=false;await approveEdielInboundCaseAction(f)
  expect(stored.status).toBe('applied');expect(committed.size).toBe(2)
  expect(boundary.graph.mock.calls.map(c=>c[0].metering_point.meter_point_id)).toEqual(['A','B','B'])
 })
 it('reprocesses an unresolved-company case with IS NULL, not eq null',async()=>{
  message.company_id=null;stored.company_id=null
  const result=await createOrUpdateInboundProdatCase({actorUserId:'actor',message})
  expect(result?.company_id).toBeNull();expect(result?.status).toBe('pending_review')
  expect(stored.updated_at).not.toBe('0')
 })

 it('applies A and B separately, preserves their registers, and never links a whole message to the first customer',async()=>{
  const result=await approve(params())
  expect(result.status).toBe('applied');expect(boundary.graph).toHaveBeenCalledTimes(2)
  const commands=boundary.graph.mock.calls.map(c=>c[0])
  expect(commands.map(c=>c.customer.full_name)).toEqual(['Customer A','Customer B'])
  expect(commands.map(c=>c.application.payload_snapshot.prodatRegisters.map((r:{annualConsumption:string})=>r.annualConsumption))).toEqual([['10','20'],['30']])
  expect(new Set(commands.map(c=>c.idempotency_key)).size).toBe(2)
  expect(new Set(commands.map(c=>c.application.source_record_id)).size).toBe(2)
  expect(result.customer_id).toBeNull();expect(result.site_id).toBeNull();expect(batch()?.receipts).toHaveLength(2)
  expect(boundary.link).not.toHaveBeenCalled()
 })
 it('does not mark the whole case applied when B fails, and resumes without repeating A',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow('B deliberately failed')
  expect(stored.status).toBe('failed');expect(batch()?.receipts).toHaveLength(1);expect(writes).not.toContain('applied')
  failB=false;const result=await approve(params());expect(result.status).toBe('applied')
  expect(boundary.graph.mock.calls.map(c=>c[0].metering_point.meter_point_id)).toEqual(['A','B','B'])
  expect(boundary.graph.mock.calls[1][0].idempotency_key).toBe(boundary.graph.mock.calls[2][0].idempotency_key)
 })
 it('replays the same key when the graph committed but its response was lost',async()=>{
  loseAResponse=true;await expect(approve(params())).rejects.toThrow('response lost')
  await approve(params());expect(committed.size).toBe(2)
  expect(boundary.graph.mock.calls[0][0].idempotency_key).toBe(boundary.graph.mock.calls[1][0].idempotency_key)
  expect(batch()?.receipts).toHaveLength(2)
 })
 it('rejects changed choices after partial completion instead of reusing a stale completed result',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow();const calls=boundary.graph.mock.calls.length
  const p=params();p.objectDecisions[1].mode='link_existing_only';p.objectDecisions[1].selectedCustomerId='11111111-1111-4111-8111-111111111111'
  await expect(approve(p)).rejects.toThrow('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH');expect(boundary.graph).toHaveBeenCalledTimes(calls)
 })
 it('rejects a changed source before any replay',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow();const calls=boundary.graph.mock.calls.length
  message.raw_payload=message.raw_payload!.replace('31:30','31:999')
  await expect(approve(params())).rejects.toThrow('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH');expect(boundary.graph).toHaveBeenCalledTimes(calls)
 })
 it('reconstructs commands from the source instead of trusting a replaced command and checksum',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow();const count=boundary.graph.mock.calls.length
  const plan=stored.review_decision!.objectApplication as {commands:Record<string,unknown>[];commandHash:string}
  plan.commands[1].contract={status:'signed',unexpected:true}
  const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value
  plan.commandHash=createHash('sha256').update(JSON.stringify(canonical(plan.commands))).digest('hex')
  failB=false;await expect(approve(params())).rejects.toThrow('PRODAT_OBJECT_APPLICATION_PLAN_MISMATCH');expect(boundary.graph).toHaveBeenCalledTimes(count)
 })
 it('survives JSONB object-key reordering while retaining array order',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow()
  const reorder=(v:unknown):unknown=>Array.isArray(v)?v.map(reorder):v && typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,value])=>[k,reorder(value)])):v
  stored.review_decision=reorder(stored.review_decision) as Record<string,unknown>;failB=false
  expect((await approve(params())).status).toBe('applied')
 })
 it('serializes identical concurrent choices through stable RPC keys and conditional receipts',async()=>{
  const results=await Promise.all([approve(params()),approve(params())])
  expect(results.every(r=>r.status==='applied')).toBe(true);expect(committed.size).toBe(2)
  expect(batch()?.receipts).toHaveLength(2)
 })
 it('preserves an in-progress batch when inbound processing sees the message again',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow();const snapshot=structuredClone(stored)
  expect(await createOrUpdateInboundProdatCase({actorUserId:'actor',message})).toEqual(snapshot)
  expect(stored).toEqual(snapshot)
 })
 it('does not reject a partially applied batch and erase its receipts',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow()
  await expect(rejectEdielInboundCase({actorUserId:'actor',caseId:'case'})).rejects.toThrow('PRODAT_OBJECT_APPLICATION_IN_PROGRESS')
  expect(batch()?.receipts).toHaveLength(1)
 })
 for(const ds of [[],[decisions()[0]],[decisions()[0],decisions()[0]],[decisions()[0],{...decisions()[1],identityAgency:'9'}]]) it(`requires exact decisions for every source object ${JSON.stringify(ds)}`,async()=>{
  await expect(approve({...params(),objectDecisions:ds})).rejects.toThrow(/PRODAT_OBJECT|PRODAT_MULTIPLE/);expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('retains the existing fail-closed guard when explicit per-object decisions are absent',async()=>{
  await expect(approve({...params(),objectDecisions:undefined})).rejects.toThrow('PRODAT_MULTIPLE_OBJECTS_REQUIRE_OBJECT_SCOPED_APPLICATION');expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('rejects a caller company mismatch before a graph write',async()=>{
  await expect(approve({...params(),companyId:'other-company'})).rejects.toThrow(/TENANT|COMPANY/);expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('makes already-applied identical requests idempotent at the case boundary',async()=>{
  await approve(params());const result=await approve(params());expect(result.status).toBe('applied');expect(boundary.graph).toHaveBeenCalledTimes(2)
 })
 for (const id of ['B:local','B-local','blocal']) it(`retains unsupported exact identity in staging but stops before any graph write: ${id}`,async()=>{
  message.raw_payload=raw([line('1','A'),qty('10'),...common('A','A'),line('2',id),qty('20'),...common(id,'B')],'Z04')
  const p=params();p.objectDecisions[1].meteringPointId=id
  await expect(approve(p)).rejects.toThrow('PRODAT_OBJECT_APPLICATION_IDENTITY_SCHEMA_REQUIRED');expect(boundary.graph).not.toHaveBeenCalled()
 })
 for(const mode of ['update_existing_customer','link_existing_only'] as const)it(`applies an explicitly selected same-object graph through the shared RPC: ${mode}`,async()=>{
  const customer='11111111-1111-4111-8111-111111111111',site='22222222-2222-4222-8222-222222222222',meter='33333333-3333-4333-8333-333333333333'
  graphRows.customers=[{id:customer,company_id:'company'}]
  graphRows.customer_sites=[{id:site,company_id:'company',customer_id:customer,facility_id:'B'}]
  graphRows.metering_points=[{id:meter,company_id:'company',customer_id:customer,site_id:site,meter_point_id:'B'}]
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode,selectedCustomerId:customer,selectedSiteId:site,selectedMeteringPointId:meter}
  expect((await approve(p)).status).toBe('applied')
  expect(boundary.graph.mock.calls[1][0]).toMatchObject({matching_policy:'link_selected',existing_customer_id:customer,existing_site_id:site,existing_metering_point_id:meter})
 })
 for(const field of ['facility_id','meter_point_id'])it(`rejects a selected graph for a different object even under the same customer: ${field}`,async()=>{
  const customer='11111111-1111-4111-8111-111111111111',site='22222222-2222-4222-8222-222222222222',meter='33333333-3333-4333-8333-333333333333'
  graphRows.customers=[{id:customer,company_id:'company'}]
  graphRows.customer_sites=[{id:site,company_id:'company',customer_id:customer,facility_id:field==='facility_id'?'A':'B'}]
  graphRows.metering_points=[{id:meter,company_id:'company',customer_id:customer,site_id:site,meter_point_id:field==='meter_point_id'?'A':'B'}]
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode:'link_existing_only',selectedCustomerId:customer,selectedSiteId:site,selectedMeteringPointId:meter}
  await expect(approve(p)).rejects.toThrow('PRODAT_OBJECT_GRAPH_SELECTION_INVALID');expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('rejects a selected graph that is not owned by this company and source object before applying A',async()=>{
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode:'link_existing_only',selectedCustomerId:'11111111-1111-4111-8111-111111111111'}
  await expect(approve(p)).rejects.toThrow('PRODAT_OBJECT_GRAPH_SELECTION_INVALID');expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('validates all selected database IDs before applying even the first object',async()=>{
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode:'link_existing_only',selectedCustomerId:'not-a-uuid'}
  await expect(approve(p)).rejects.toThrow('PRODAT_OBJECT_SELECTION_ID_INVALID');expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('requires complete graph receipts and leaves the case resumable on incomplete success',async()=>{
  boundary.graph.mockResolvedValueOnce({ok:true,operation_id:'bad-receipt',customer_id:'only-customer'})
  await expect(approve(params())).rejects.toThrow('PRODAT_OBJECT_APPLICATION_RECEIPT_INVALID')
  expect(stored.status).toBe('failed');expect(batch()?.receipts).toHaveLength(0);expect(writes).not.toContain('applied')
 })
 it('retains completed graph receipts when the final event fails and retries no graphs',async()=>{
  boundary.event.mockRejectedValueOnce(new Error('event failed'))
  await expect(approve(params())).rejects.toThrow('event failed');expect(batch()?.receipts).toHaveLength(2)
  expect((await approve(params())).status).toBe('applied');expect(boundary.graph).toHaveBeenCalledTimes(2)
 })
 it('does not permit a shared root customer selection to decide all objects',async()=>{
  await expect(approve({...params(),selectedCustomerId:'root-customer'})).rejects.toThrow('PRODAT_OBJECT_DECISION_REQUIRED');expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('link-only never downgrades the selected customer/site/meter or replaces their data',async()=>{
  const customer='11111111-1111-4111-8111-111111111111',site='22222222-2222-4222-8222-222222222222',meter='33333333-3333-4333-8333-333333333333'
  graphRows.customers=[{id:customer,company_id:'company',status:'active'}]
  graphRows.customer_sites=[{id:site,company_id:'company',customer_id:customer,facility_id:'B',status:'active'}]
  graphRows.metering_points=[{id:meter,company_id:'company',customer_id:customer,site_id:site,meter_point_id:'B',status:'active'}]
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode:'link_existing_only',selectedCustomerId:customer,selectedSiteId:site,selectedMeteringPointId:meter}
  await approve(p);const command=boundary.graph.mock.calls[1][0]
  expect(command.update_existing).toBe(false);expect(command.customer).toEqual({})
  expect(command.site).toEqual({facility_id:'B'});expect(command.metering_point).toEqual({meter_point_id:'B'})
 })
 it('an update does not substitute draft/default values or nulls for absent wire fields',async()=>{
  const customer='11111111-1111-4111-8111-111111111111'
  graphRows.customers=[{id:customer,company_id:'company'}]
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode:'update_existing_customer',selectedCustomerId:customer}
  await approve(p);const command=boundary.graph.mock.calls[1][0]
  for(const record of [command.customer,command.site,command.metering_point]){
   expect(record).not.toHaveProperty('status');expect(record).not.toHaveProperty('created_by');expect(Object.values(record)).not.toContain(null)
  }
  expect(command.customer).not.toHaveProperty('personal_number');expect(command.metering_point).not.toHaveProperty('reading_frequency')
 })
 it('does not attach a selected existing meter to an implicitly created or missing site',async()=>{
  const customer='11111111-1111-4111-8111-111111111111',meter='33333333-3333-4333-8333-333333333333'
  graphRows.customers=[{id:customer,company_id:'company'}]
  graphRows.metering_points=[{id:meter,company_id:'company',customer_id:customer,site_id:'site-before',meter_point_id:'B'}]
  const p=params();p.objectDecisions[1]={...p.objectDecisions[1],mode:'update_existing_customer',selectedCustomerId:customer,selectedMeteringPointId:meter}
  await expect(approve(p)).rejects.toThrow('PRODAT_OBJECT_GRAPH_SELECTION_INVALID');expect(boundary.graph).not.toHaveBeenCalled()
 })
 it('detects a retry under a different actor before impersonating the saved command actor',async()=>{
  failB=true;await expect(approve(params())).rejects.toThrow();boundary.graph.mockClear();failB=false
  await expect(approve({...params(),actorUserId:'another-operator'})).rejects.toThrow('PRODAT_OBJECT_APPLICATION_ACTOR_MISMATCH');expect(boundary.graph).not.toHaveBeenCalled()
 })

})
