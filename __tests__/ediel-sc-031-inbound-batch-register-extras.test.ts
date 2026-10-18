// masterplan: SC-031
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {approveEdielInboundCase,parseInboundProdatBusinessData,type EdielInboundCaseRow} from '@/lib/ediel/inboundCases'
import {validateProdatRegisterPayload} from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {characteristic,type Parts} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'

// Real wire/parser/field policy and approveEdielInboundCase remain in use.
// Only SDK reads and the protected native source owner are finite IO. That
// owner deliberately refuses every attempt: no native permission, graph effect,
// physical ACK or whole-SC031 approval is manufactured by these tests.
// Break caught: treating a received Z05 batch as outgoing at its second
// register validation rejects P119 extras before the current-source owner.
type Row=Record<string,unknown>
const COMPANY='00000000-0000-4000-8000-000000000002'
const ACTOR='00000000-0000-4000-8000-000000000003'
const CASE='00000000-0000-4000-8000-000000000004'
const FOREIGN='00000000-0000-4000-8000-000000000005'
const points=['A111111111111111111111111','B222222222222222222222222']
const ports=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),read:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:ports.from,rpc:ports.rpc}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:ports.read}))

const extras=[
 {field:'213',parts:[['QTY',['31','777','KWH']]]},
 {field:'214',parts:characteristic('Z02','7',3)},
 {field:'218',parts:characteristic('Z05','7',3)},
 {field:'259',parts:characteristic('Z16','4',3)},
] satisfies {field:string;parts:Parts[]}[]
function wire(fields:readonly string[]=[],malformed?:'sequence'|'single-register'){
 const objects=points.flatMap((point,index):Parts[]=>[
  ['LIN',malformed==='sequence'?'1':String(index+1),'',[point,'','','89'],...(malformed==='single-register'?[['1','1']]:[])],
  ['DTM',['93','202610171200','203']],...extras.filter(e=>fields.includes(e.field)).flatMap(e=>e.parts),
  ...characteristic('Z13','Z22'),['RFF',['LI','SC031-'+index]],['RFF',['Z05','TES']],['RFF',['MG','SC031-METER']],
  ['NAD','UD',['SC031-CUSTOMER-'+index,'','89'],'','Synthetic','Street','City','','12345','SE'],
  ['NAD','IT',[point,'','89'],'','','Street','Town','','12345','SE'],['NAD','Z02',['99876','160','SVK']],
 ])
 return guideOrderedFixtureRaw([...head(),...objects],'Z05').replace('+S+R+','+12345:14+54321:14+')
}
const messageFor=(fields:readonly string[]=[],malformed?:'sequence'|'single-register')=>({
 ...source(wire(fields,malformed),'Z05'),company_id:COMPANY,
})
let message=messageFor()
let pending:EdielInboundCaseRow
let sourceReads:Row[]
let mutations:string[]
function install(fields:readonly string[]=[],malformed?:'sequence'|'single-register'){
 message=messageFor(fields,malformed)
 pending={id:CASE,company_id:COMPANY,ediel_message_id:message.id,case_type:'supplier_switch',message_family:'PRODAT',message_code:'Z05',
  transaction_type:'Z22',status:'pending_review',customer_id:null,site_id:null,metering_point_id:null,match_confidence:null,
  parsed_customer:{},parsed_site:{},parsed_metering_point:{},parsed_contract:{},parsed_production:{},
  proposed_action:{objects:points.map(meteringPointId=>({meteringPointId,identityAgency:'89'}))},review_decision:null,
  reviewed_by:null,reviewed_at:null,applied_at:null,failure_reason:null,created_at:'2026-10-17T12:00:00Z',
  updated_at:'2026-10-17T12:00:00Z',created_by:ACTOR,updated_by:ACTOR}
 sourceReads=[];mutations=[]
}
beforeEach(()=>{
 vi.clearAllMocks();install()
 ports.read.mockImplementation(async(id:string)=>id===message.id?structuredClone(message):null)
 ports.from.mockImplementation((table:string)=>{
  const filters:[string,unknown][]=[]
  const mutate=()=>{mutations.push(table);throw Error('UNEXPECTED_BUSINESS_WRITE')}
  const chain={
   select:()=>chain,eq:(key:string,value:unknown)=>{filters.push([key,value]);return chain},
   update:mutate,insert:mutate,delete:mutate,
   maybeSingle:async()=>{
    const row=table==='ediel_inbound_cases'?pending:table==='ediel_messages'?message:null
    if(!row)throw Error('UNEXPECTED_TABLE:'+table)
    const matches=filters.every(([key,value])=>(row as unknown as Row)[key]===value)
    return {data:matches?structuredClone(row):null,error:null}
   },
  }
  return chain
 })
 ports.rpc.mockImplementation(async(name:string,args:Row)=>{
  if(name!=='ediel_read_prodat_object_batch_source_v1')throw Error('UNEXPECTED_RPC:'+name)
  sourceReads.push(structuredClone(args))
  return {data:null,error:Error('DECLARED_CURRENT_SOURCE_HOLD')}
 })
})
const approve=(companyId=COMPANY)=>approveEdielInboundCase({companyId,actorUserId:ACTOR,caseId:CASE,
 objectDecisions:points.map(meteringPointId=>({meteringPointId,identityAgency:'89',mode:'create_new_customer' as const}))})
function registerIssues(raw:string,direction:'inbound'|'outbound'){
 const parsed=tokenizeEdifact(raw)
 return validateProdatRegisterPayload({code:'Z05',rawSegments:parsed.segments.map(s=>s.raw),una:parsed.una,direction})
}
function businessProjection(){
 const projection=parseInboundProdatBusinessData(message)
 const {registers,...meter}=projection.meteringPoint
 return {customer:projection.customer,site:projection.site,meter,contract:projection.contract,production:projection.production,
  rawRegisters:registers}
}

describe('received Z05 batches retain national-extra tolerance at the approval boundary',()=>{
 for(const fields of [[],...extras.map(e=>[e.field]),extras.map(e=>e.field)])it(
  'consults the protected source owner without applying ignored register data: '+(fields.join('/')||'baseline'),async()=>{
   install(fields)
   const before=structuredClone({message,pending}),decision=resolveCanonicalRuntimeDecision(message)
   expect(validateEdifactEnvelope(message.raw_payload).syntaxOk).toBe(true)
   expect([decision.syntaxDecision,decision.applicationDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted'])
   expect(decision.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='negative')).toBe(false)
   await expect(approve()).rejects.toThrow('DECLARED_CURRENT_SOURCE_HOLD')
   expect(sourceReads).toEqual([{p_company_id:COMPANY,p_source_message_id:message.id,p_actor_user_id:ACTOR}])
   expect({message,pending}).toEqual(before);expect(mutations).toEqual([])
   const extraProjection=businessProjection()
   install()
   const baselineProjection=businessProjection()
   expect({...extraProjection,rawRegisters:undefined}).toEqual({...baselineProjection,rawRegisters:undefined})
   if(fields.length)expect(extraProjection.rawRegisters).not.toEqual(baselineProjection.rawRegisters)
  })
 for(const {field}of extras)it('retains the outgoing prohibition for field'+field,()=>{
  const raw=wire([field])
  expect(registerIssues(raw,'inbound')).toEqual([])
  expect(registerIssues(raw,'outbound')).toContainEqual(expect.objectContaining({blocking:true,
   code:'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT',prodatDiagnostic:expect.objectContaining({fieldNumber:field})}))
 })
 for(const malformed of ['sequence','single-register']as const)it('still refuses '+malformed+' structure before protected-source reads',async()=>{
  install(extras.map(e=>e.field),malformed)
  const before=structuredClone({message,pending})
  expect(registerIssues(message.raw_payload!,'inbound')).toContainEqual(expect.objectContaining({blocking:true,code:'PRODAT_REGISTER_STRUCTURE_INVALID'}))
  await expect(approve()).rejects.toThrow('PRODAT_OBJECT_SELECTION_INVALID')
  expect(sourceReads).toEqual([]);expect(mutations).toEqual([]);expect({message,pending}).toEqual(before)
 })
 it('refuses a different company before consulting the source owner',async()=>{
  install(extras.map(e=>e.field))
  const before=structuredClone({message,pending})
  await expect(approve(FOREIGN)).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
  expect(sourceReads).toEqual([]);expect(mutations).toEqual([]);expect({message,pending}).toEqual(before)
 })
 it('refuses an outgoing source at the incoming application boundary',async()=>{
  install(extras.map(e=>e.field));message={...message,direction:'outbound'}
  const before=structuredClone({message,pending})
  await expect(approve()).rejects.toThrow('PRODAT_OBJECT_APPLICATION_SOURCE_REQUIRED')
  expect(sourceReads).toEqual([]);expect(mutations).toEqual([]);expect({message,pending}).toEqual(before)
 })
})

