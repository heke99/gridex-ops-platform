import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielTestRunRow } from '@/lib/ediel/types'
const b=vi.hoisted(()=>({access:vi.fn(),scoped:vi.fn(),company:vi.fn(),operational:vi.fn(),source:vi.fn(),runtime:vi.fn(),build:vi.fn(),create:vi.fn(),attach:vi.fn(),readFacts:vi.fn(),writeFacts:vi.fn(),from:vi.fn(),runs:vi.fn(),messages:vi.fn(),links:vi.fn(),byIds:vi.fn(),evaluate:vi.fn(),next:vi.fn(),revalidate:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:b.from}}))
vi.mock('next/cache',()=>({revalidatePath:b.revalidate}))
vi.mock('@/lib/admin/guards',()=>({requireCompanyScopedActionAccess:b.company,isPlatformAdminContext:()=>false,requirePlatformAdminActionAccess:b.access}))
vi.mock('@/lib/ediel/actionAccess',()=>({requireEdielWriteActionAccess:b.access,requireEdielSendActionAccess:b.access}))
vi.mock('@/lib/tenant/governance',()=>({requireCompanyOperationalForWrites:b.operational}))
vi.mock('@/lib/ediel/systemTestSettings',()=>({requireEdielSystemTestRuntimeContext:b.runtime,getEdielSystemTestSettings:vi.fn()}))
vi.mock('@/lib/ediel/testing/tgtTestDataStore',()=>({getEdielTgtDynamicTestDataForCase:b.source,upsertEdielTgtDynamicTestData:vi.fn()}))
vi.mock('@/lib/ediel/testing/tgtEdifact',()=>({buildEdielTgtDraft:b.build}))
vi.mock('@/lib/ediel/testing/tgtRegisterFacts',()=>({readTgtRegisterFacts:b.readFacts,buildTgtRegisterFactNotes:b.writeFacts}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessage:b.create,attachEdielMessageToTestRun:b.attach,listEdielTestRuns:b.runs,listEdielMessages:b.messages,listEdielMessagesByIds:b.byIds,listEdielTestRunMessages:b.links,createEdielMessageEvent:vi.fn(),getEdielMessageById:vi.fn(),createEdielTestRun:vi.fn(),listAckMessagesForSource:vi.fn(),updateEdielMessageStatus:vi.fn(),updateEdielTestRunStatus:vi.fn()}))
vi.mock('@/app/admin/ediel/actions.part-1',()=>({requireScopedEdielTestRunForAction:b.scoped,formString:(v:unknown)=>typeof v==='string'?v.trim()||null:null,formNumber:(v:unknown)=>Number(v)||null,parseEdielTestSuite:(v:unknown)=>v,parseEdielTestRoleCode:(v:unknown)=>v,revalidateEdiel:b.revalidate,revalidateRelatedMessage:b.revalidate}))
vi.mock('@/lib/ediel/testing/tgtRegistry',async original=>({...await original<typeof import('@/lib/ediel/testing/tgtRegistry')>(),evaluateEdielTgtRun:b.evaluate,getEdielTgtNextAction:b.next}))
import { createEdielTgtDraftAction, saveEdielTgtRegisterFactsAction } from '@/app/admin/ediel/actions.part-2'
import { runTgtAutopilotForRun } from '@/lib/ediel/testing/tgtAutopilot'
const run={id:'run',company_id:'tenant',test_suite:'PRODAT',role_code:'supplier',test_case_code:'1.2.5',notes:'bound facts',updated_at:'version-1'} as EdielTestRunRow
const step={stepNo:4,actor:'gridex',family:'PRODAT',code:'Z04',direction:'outbound',title:'Synthetic'}
const facts={market:'electricity',registerObjects:[{meteringPointId:'A',identityAgency:'9',expectedRegisterCount:1,meterReadingsSentInUtilts:false}]}
const form=()=>{const f=new FormData();for(const [k,v] of Object.entries({testRunId:'run',testSuite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',stepNo:'4'}))f.set(k,v);return f}
let filters:[string,unknown][],saved:Record<string,unknown>|null,saveResult:unknown
beforeEach(()=>{
 vi.clearAllMocks();filters=[];saved=null;saveResult={id:'run'}
 b.access.mockResolvedValue({userId:'actor'});b.scoped.mockResolvedValue({...run});b.company.mockResolvedValue({userId:'actor'});b.operational.mockResolvedValue(undefined)
 b.runtime.mockResolvedValue({companyId:'tenant'});b.source.mockResolvedValue({suite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',groups:[]});b.readFacts.mockReturnValue(facts);b.writeFacts.mockReturnValue('checked-notes')
 b.build.mockReturnValue({step,validationIssues:[],messageInput:{companyId:'tenant',parsedPayload:{prodatEngine:{registerEvidence:'binding'}}}});b.create.mockResolvedValue({id:'message'});b.attach.mockResolvedValue(undefined)
 b.runs.mockResolvedValue([run]);b.messages.mockResolvedValue([]);b.links.mockResolvedValue([]);b.byIds.mockResolvedValue([])
 b.evaluate.mockReturnValue({testRun:run,definition:{suite:'PRODAT',roleCode:'supplier',testCaseCode:'1.2.5',expectedSteps:[step]}});b.next.mockReturnValue({kind:'create_gridex_draft',stepNo:4})
 const q={update:vi.fn((v:Record<string,unknown>)=>{saved=v;return q}),eq:vi.fn((k:string,v:unknown)=>{filters.push([k,v]);return q}),select:vi.fn(()=>q),maybeSingle:vi.fn(async()=>({data:saveResult,error:null}))};b.from.mockReturnValue(q)
})
describe('actual TGT admin and autopilot register-fact wiring',()=>{
 it('admin reads authorized run facts and passes them through the existing builder',async()=>{
  await createEdielTgtDraftAction(form());expect(b.scoped).toHaveBeenCalledWith('run',expect.objectContaining({userId:'actor'}))
  expect(b.readFacts).toHaveBeenCalledWith(expect.objectContaining({run:expect.objectContaining({company_id:'tenant'}),stepNo:4,code:'Z04'}))
  expect(b.build).toHaveBeenCalledWith(expect.objectContaining({registerFacts:facts}));expect(b.create).toHaveBeenCalledTimes(1)
 })
 it('admin cannot use another form company or another case from the selected run',async()=>{
  for(const [key,value] of [['companyId','other'],['testCaseCode','1.2.6'],['roleCode','esco']]){
   const f=form();f.set(key,value);await expect(createEdielTgtDraftAction(f)).rejects.toThrow(/TGT_RUN|TENANT/)
  }
  expect(b.create).not.toHaveBeenCalled()
 })
 it('denied run access prevents draft construction and mutation',async()=>{
  b.scoped.mockRejectedValueOnce(new Error('denied'));await expect(createEdielTgtDraftAction(form())).rejects.toThrow('denied');expect(b.build).not.toHaveBeenCalled();expect(b.create).not.toHaveBeenCalled()
 })
 it('stale or malformed facts prevent admin draft persistence',async()=>{
  b.readFacts.mockImplementationOnce(()=>{throw new Error('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID')});await expect(createEdielTgtDraftAction(form())).rejects.toThrow('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID');expect(b.create).not.toHaveBeenCalled()
 })
 it('autopilot passes the same run/source-bound facts to the same builder',async()=>{
  expect((await runTgtAutopilotForRun({actorUserId:'actor',companyId:'tenant',testRunId:'run'})).action).toBe('created_gridex_draft')
  expect(b.readFacts).toHaveBeenCalledWith(expect.objectContaining({run,stepNo:4,code:'Z04'}));expect(b.build).toHaveBeenCalledWith(expect.objectContaining({registerFacts:facts}))
 })
 it('autopilot returns blocked on stale register evidence, with no message or route write',async()=>{
  b.readFacts.mockImplementationOnce(()=>{throw new Error('PRODAT_REGISTER_SOURCE_EVIDENCE_INVALID')})
  expect((await runTgtAutopilotForRun({actorUserId:'actor',companyId:'tenant',testRunId:'run'})).action).toBe('blocked');expect(b.create).not.toHaveBeenCalled();expect(b.from).not.toHaveBeenCalled()
 })
 it('saves operator facts only after run authorization with company/version CAS',async()=>{
  const f=form();f.set('registerFacts',JSON.stringify(facts));f.set('sourceNote','Reporting agreement');await saveEdielTgtRegisterFactsAction(f)
  expect(b.scoped).toHaveBeenCalled();expect(b.writeFacts).toHaveBeenCalledWith(expect.objectContaining({run,actorId:'actor',sourceNote:'Reporting agreement',facts}))
  expect(saved).toMatchObject({notes:'checked-notes',updated_by:'actor'});expect(filters).toEqual(expect.arrayContaining([['company_id','tenant'],['id','run'],['updated_at','version-1']]))
 })
 it('rejects a concurrent source/run-note update without reporting success',async()=>{
  saveResult=null;const f=form();f.set('registerFacts',JSON.stringify(facts));f.set('sourceNote','Evidence');await expect(saveEdielTgtRegisterFactsAction(f)).rejects.toThrow('PRODAT_REGISTER_FACTS_CONCURRENT_UPDATE')
 })
 it('does not write malformed fact JSON',async()=>{
  const f=form();f.set('registerFacts','{');f.set('sourceNote','Evidence');await expect(saveEdielTgtRegisterFactsAction(f)).rejects.toThrow();expect(b.from).not.toHaveBeenCalled()
 })
})
