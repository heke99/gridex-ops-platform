// reality-defects: F102
// A production inbound original must be born with test_flag 0; the column default (1) made every production
// original a test message, and consumers that read the flag then treated production traffic as test traffic.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {parseEdifactPayload,parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import type {InboundEntityMatch} from '@/lib/inbound-mail/inboundMatcher'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {company,actor,mailId,parseId,newId,inboundReceptionBoundary} from './fixtures/inbound-reception-db'
import {permissionAckMessage} from './fixtures/prodat-permission-ack'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),tasks:[] as unknown[],created:[] as Record<string,unknown>[],envelopes:[] as Record<string,unknown>[],deleted:[] as string[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async(task:unknown)=>{io.tasks.push(task);return 'task'}}))
vi.mock('@/lib/ediel/db',async original=>({...await original<typeof import('@/lib/ediel/db')>(),
 createEdielMessage:async(input:Record<string,unknown>)=>{io.created.push(input);return {id:'cancellation-draft'}}}))
// The cancellation renderer's own field matrix is out of scope here; its envelope flag is what is asserted.
vi.mock('@/lib/ediel/prodat/engine',async original=>({...await original<typeof import('@/lib/ediel/prodat/engine')>(),
 renderProdat26A:()=>({segments:["BGM+Z03+CANCEL-1+9"],issues:[],diagnostics:{}})}))
vi.mock('@/lib/ediel/messages',async original=>({...await original<typeof import('@/lib/ediel/messages')>(),
 buildEdifactEnvelope:(input:Record<string,unknown>)=>{io.envelopes.push(input);return {raw:'CANCELLATION-WIRE'}}}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
// H-16: a switch-bound cancellation uses the canonical Z03C builder; its source reads only our outbound Z03 original
// in the same environment (lib/ediel/production/switchCancellationSource.ts), never an inbound production original.
const cancellationBuilder=vi.hoisted(()=>vi.fn(async()=>({status:'queued',message:{id:'canonical-z03c'}})))
vi.mock('@/lib/ediel/flows/prodatSwitchCancellation',()=>({prepareAndQueueSwitchCancellation:cancellationBuilder}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminActionAccess:async()=>({userId:actor}),isPlatformAdminContext:()=>true,requireCompanyScopedActionAccess:vi.fn()}))
vi.mock('@/app/admin/ediel/actions.part-1',async original=>({...await original<typeof import('@/app/admin/ediel/actions.part-1')>(),
 deleteEdielMessagesByIds:async(p:{messageIds:string[]})=>{io.deleted.push(...p.messageIds)},revalidateEdiel:vi.fn()}))

import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {isEdielPortalUtiltsE66TgtMessage} from '@/lib/ediel/ack'
import {evaluateEdielProductionSendLock} from '@/lib/ediel/core/productionGuards'
import {createCancellationDraftForCase} from '@/lib/customer-cases/engine'
import {deleteAllEdielMessagesAction} from '@/app/admin/ediel/actions.part-2'
import type {CustomerCaseRow} from '@/lib/customer-cases/types'

const productionWire="UNB+UNOC:3+27700:ZZ+21660:ZZ+260921:1200+SRC1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC1+9'UNT+3+1'UNZ+1+SRC1'"
const testIndicatedWire="UNB+UNOC:3+27700:ZZ+21660:ZZ+260921:1200+SRC1++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC1+9'UNT+3+1'UNZ+1+SRC1'"
const parse=(wire:string)=>{const p=parseInboundEmailContent({attachmentText:wire});if(!p)throw Error('real_parser_fixture_missing');return p}

/** Births one inbound original through the batch inbound mail engine and returns the exact insert payload. */
async function birth(environment:'test'|'production',wire=productionWire){
 const parsed=parse(wire),db=inboundReceptionBoundary(parsed)
 db.state.existing=false;db.state.environment=environment
 io.from.mockImplementation(db.from);io.rpc.mockImplementation(db.rpc)
 await expect(createInboundEdielMessage({companyId:company,actorUserId:actor,environment,inboundEmailMessageId:mailId,parseResultId:parseId,parsed})).resolves.toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1);expect(writes[0].operation).toBe('insert')
 return writes[0].payload as Record<string,unknown>
}

// ediel_messages.test_flag integer NOT NULL DEFAULT 1 (supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql):
// an insert that omits the column stores 1.
const stored=(payload:Record<string,unknown>)=>payload.test_flag===undefined?1:payload.test_flag

beforeEach(()=>{vi.clearAllMocks();io.tasks.length=0;io.created.length=0;io.envelopes.length=0;io.deleted.length=0})

describe('inbound births carry the environment test_flag',()=>{
 it.each([['production',0],['test',1]] as const)('batch inbound mail engine: %s original is born with test_flag %i',async(environment,flag)=>{
  const payload=await birth(environment)
  expect(payload).toMatchObject({environment,direction:'inbound',test_flag:flag,validation_report:{status:'parsed_by_batch_7a1_inbound_mail_engine'}})
 })
 it('never flags a UNB/0035 test-indicated interchange as production',async()=>{
  expect(parse(testIndicatedWire).rawPayload).toContain('++++1\'')
  expect((await birth('production',testIndicatedWire)).test_flag).toBe(1)
 })
 it.each([['production',0],['test',1]] as const)('canonical inbound ACK persister: %s CONTRL is born with test_flag %i',async(environment,flag)=>{
  const writes:{table:string;kind:string;payload:Record<string,unknown>}[]=[]
  io.from.mockImplementation((table:string)=>({
   select(){return {eq(){return this},limit(){return this},maybeSingle:async()=>({data:null,error:null})}},
   insert(payload:Record<string,unknown>){writes.push({table,kind:'insert',payload});return {select(){return {maybeSingle:async()=>({data:{id:'inbound-ack'},error:null})}}}},
   update(payload:Record<string,unknown>){writes.push({table,kind:'update',payload});return {eq(){return this}}},
  }))
  const missing:InboundEntityMatch={status:'missing',entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]}
  const parsed=parseEdifactPayload("UNA:+.? 'UNB+UNOC:3+54321:14+12345:14+260927:1200+ACK1'UNH+1+CONTRL:2:2:UN:E5SE1A'UCI+SRC1+12345:14+54321:14+7'UNT+3+1'UNZ+1+ACK1'")
  await applyCanonicalInboundAckStatusUpdate({companyId:'tenant-A',environment,parsed,outboundMatch:missing,meteringPointMatch:missing,inboundEmailMessageId:'inbound-mail-A'})
  expect(writes.find(w=>w.table==='ediel_messages'&&w.kind==='insert')?.payload).toMatchObject({environment,direction:'inbound',message_family:'CONTRL',test_flag:flag})
 })
})

describe('consumers of an inbound production original',()=>{
 // Production Z14 with no process/permission link: the engine must not guess an APERAK (manual_review_required).
 const unlinkedProductionZ14=(test_flag:unknown):EdielMessageRow=>({...permissionAckMessage('Z14','S17','A74',null),environment:'production',test_flag,
  related_message_id:null,original_message_id:null,correlation_reference:null,customer_id:null,site_id:null,metering_point_id:null,business_match_status:'business_unresolved'} as EdielMessageRow)

 it('PRODAT decision engine holds an unlinked production Z14 born by the engine instead of auto-acknowledging it',async()=>{
  const born=await birth('production')
  const fixed=decideProdatAperak({message:unlinkedProductionZ14(stored(born)),testKind:'production'})
  expect(fixed).toMatchObject({kind:'manual_review',outcome:null,ruleKeys:expect.arrayContaining(['manual_review_required'])})
  // The column default (old birth) skipped the production hold and planned a positive APERAK.
  expect(decideProdatAperak({message:unlinkedProductionZ14(1),testKind:'production'})).toMatchObject({kind:'ack',ackFamily:'APERAK',outcome:'positive'})
 })

 it('test-data cleanup no longer selects a production inbound original for hard deletion',async()=>{
  const old={id:'old-birth',environment:'production',test_flag:1,receiver_ediel_id:'21660',receiver_email:'ediel@supplier.example',application_reference:'23-DDQ-PRODAT',mailbox:'ediel@supplier.example'}
  const fixed={...old,id:'fixed-birth',test_flag:stored(await birth('production'))}
  const testRow={...old,id:'test-row',environment:'test'}
  io.from.mockImplementation((table:string)=>table==='ediel_messages'
   ?{select:()=>({limit:async()=>({data:[old,fixed,testRow],error:null})})}
   :{insert:()=>Promise.resolve({error:null})})
  const form=new FormData();form.set('confirmation','RADERA TESTDATA');form.set('cleanupScope','test_only')
  await deleteAllEdielMessagesAction(form)
  expect(io.deleted).toEqual(['old-birth','test-row'])
 })

 it('UTILTS E66 TGT classification is decided by application reference and portal party, not by the flag',()=>{
  const e66=(test_flag:number,sender:string)=>({message_family:'UTILTS',message_code:'E66',environment:'production',test_flag,sender_ediel_id:sender,receiver_ediel_id:'70047',application_reference:'23-DDQ-E66-T',raw_payload:''} as unknown as EdielMessageRow)
  for(const sender of ['80047','91100'])expect(isEdielPortalUtiltsE66TgtMessage(e66(0,sender))).toBe(isEdielPortalUtiltsE66TgtMessage(e66(1,sender)))
 })

 it('customer-case cancellation replies take their flag from the outbound Z03, never from an inbound production original',async()=>{
  const rows:Record<string,unknown>[]=[
   {id:'inbound-z04',company_id:company,direction:'inbound',environment:'production',test_flag:1,message_family:'PRODAT',message_code:'Z03',switch_request_id:'switch-1',process_type:null},
   {id:'outbound-z03',company_id:company,direction:'outbound',environment:'production',test_flag:0,message_family:'PRODAT',message_code:'Z03',switch_request_id:'switch-1',process_type:'supplier_switch',
    raw_payload:productionWire,sender_ediel_id:'21660',receiver_ediel_id:'27700',application_reference:'23-DDQ-PRODAT',transaction_reference:'TX1',external_reference:'DOC1'},
  ]
  io.from.mockImplementation((table:string)=>{
   const filters:[string,string,unknown][]=[]
   const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.push(['eq',k,v]);return q},neq:(k:string,v:unknown)=>{filters.push(['neq',k,v]);return q},order:()=>q,limit:()=>q,
    update:()=>q,then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve),
    maybeSingle:async()=>({data:table==='ediel_messages'?rows.find(r=>filters.every(([op,k,v])=>op==='eq'?r[k]===v:r[k]!==v))??null:null,error:null})}
   return q
  })
  const caseRow={id:'case-1',company_id:company,cancellation_required:true,cancellation_ediel_message_id:null,outbound_request_id:null,supplier_switch_request_id:'switch-1',
   customer_id:null,site_id:null,metering_point_id:null,metadata:{}} as unknown as CustomerCaseRow
  const created=await createCancellationDraftForCase(caseRow,actor)
  // H-16: the canonical builder renders from the switch's own outbound Z03; no legacy draft is born from any original.
  expect(cancellationBuilder).toHaveBeenCalledWith({companyId:company,switchRequestId:'switch-1',actorUserId:actor})
  expect(created).toEqual({id:'canonical-z03c'})
  expect(io.created).toHaveLength(0)
  expect(io.envelopes).toEqual([])
  const lock=evaluateEdielProductionSendLock({company_id:company,environment:'production',direction:'outbound',test_flag:rows[1].test_flag as number,message_family:'PRODAT'})
  expect(lock.issues.map(i=>i.code)).not.toContain('production_test_flag')
 })
})
