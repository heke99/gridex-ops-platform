// masterplan: SC-037
// P-11 on_failure through the real processInboundAckMessage (inbound processing
// and operational bridge entry): a qualified whole-source negative APERAK (27)
// after Z04 keeps the accepted switch and its confirmed period, while the
// technical ACK receipt, ACK status and evidence events are still recorded.
// Before Z04 the negative still fails the switch. Replays are stable and a
// still-valid period is untouched.
// Declared ports: stateful supabaseService fake (filters honoured; the switch
// transition RPC is modelled as the unconditional row-locked patch it is),
// ACK correlation/classification, committed-receipt lookup, ediel/cis status
// writers, customer-case and actor-testing consumers.
import {beforeEach,describe,expect,it,vi} from 'vitest'
type Row=Record<string,unknown>
const db=vi.hoisted(()=>({rows:{} as Record<string,Row[]>,outcome:'negative' as 'negative'|'positive',calls:[] as string[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:(table:string)=>{
  let op:'select'|'update'='select',patch:Row={};const filters:((r:Row)=>boolean)[]=[]
  const exec=()=>{const rows=db.rows[table]??=[];const hit=rows.filter(r=>filters.every(f=>f(r)))
   if(op==='update')hit.forEach(r=>Object.assign(r,patch));return hit}
  const q:Row={}
  Object.assign(q,{select:()=>q,
   eq:(c:string,v:unknown)=>{filters.push(r=>r[c]===v);return q},
   in:(c:string,v:unknown[])=>{filters.push(r=>v.includes(r[c]));return q},
   update:(p:Row)=>{op='update';patch=p;return q},
   maybeSingle:async()=>({data:structuredClone(exec()[0]??null),error:null}),
   then:(ok:(v:unknown)=>unknown,err?:(e:unknown)=>unknown)=>Promise.resolve({data:exec(),error:null}).then(ok,err)})
  return q},
 rpc:async(name:string,args:Row)=>{db.calls.push(name)
  if(name==='gridex_read_inbound_ack_source_v1')return {data:{version:1,sourceMessage:structuredClone(db.rows.ediel_messages.find(r=>r.id==='00000000-0000-4000-8000-000000000003'))},error:null}
  if(name==='gridex_apply_inbound_ack_source_v1'){const src=db.rows.ediel_messages.find(r=>r.id===args.p_source_message_id)!
   const neg=db.outcome==='negative';Object.assign(src,{aperak_status:neg?'rejected':'accepted',ack_outcome:db.outcome})
   return {data:{version:1,sourceMessage:structuredClone(src),outcome:db.outcome,finalAckReached:!neg,wholeSourceRejected:neg,sourceAccepted:!neg,failureReason:neg?'APERAK 27 avvisade':null},error:null}}
  throw new Error(`unexpected rpc ${name}`)}}}))
vi.mock('@/lib/ediel/ack/sourceCorrelation',()=>({
 readInboundAckSourceCorrelation:()=>({classification:{outcome:db.outcome},lookupReferences:[]}),
 qualifyInboundAckSourceCandidates:({candidates}:{candidates:Row[]})=>({status:'unique',sourceMessage:candidates[0]})}))
vi.mock('@/lib/ediel/ack/committedInboundAck',()=>({readCommittedInboundAck:async()=>null}))
vi.mock('@/lib/ediel/db',()=>({
 updateEdielMessageStatus:async(p:{edielMessageId:string;status:string})=>{const r=db.rows.ediel_messages.find(m=>m.id===p.edielMessageId)!;r.status=p.status;return r},
 linkEdielMessage:async(p:{edielMessageId:string;relatedMessageId:string})=>{db.rows.ediel_messages.find(m=>m.id===p.edielMessageId)!.related_message_id=p.relatedMessageId},
 createEdielMessageEvent:async(p:Row)=>{db.rows.ediel_message_events.push(p)}}))
vi.mock('@/lib/cis/db',()=>({getOutboundRequestById:async()=>null,updateOutboundRequestStatus:async()=>null,updateGridOwnerDataRequestStatus:async()=>null}))
vi.mock('@/lib/operations/db',()=>({
 // Faithful to gridex_transition_supplier_switch_v1: row-locked, no old-status predicate.
 updateSupplierSwitchRequestStatus:async(_s:unknown,p:{requestId:string;status:string;failureReason?:string|null})=>{
  const r=db.rows.supplier_switch_requests.find(x=>x.id===p.requestId)!;db.rows.supplier_switch_events.push({event_type:'status_updated',previous_status:r.status,new_status:p.status})
  Object.assign(r,{status:p.status,failure_reason:p.failureReason??null,failed_at:p.status==='failed'?'now':r.failed_at});return structuredClone(r)},
 createSupplierSwitchEvent:async(_s:unknown,p:Row)=>{db.rows.supplier_switch_events.push(p)}}))
vi.mock('@/lib/customer-cases/db',()=>({syncCustomerCaseCancellationAck:async()=>null}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
import {processInboundAckMessage} from '@/lib/ediel/flows/inboundAckProcessing'

const PERIOD={id:'period-1',company_id:'company',supplier_switch_request_id:'switch-1',status:'confirmed_by_grid_owner',start_date:'2026-11-01',market_start_at:'2026-10-31T23:00:00Z',activated_at:null}
const seed=(status:string,z04:boolean)=>{db.calls=[];db.rows={
 supplier_switch_requests:[{id:'switch-1',company_id:'company',status,inbound_z04_message_id:z04?'z04-in':null,confirmed_start_date:z04?'2026-11-01':null,requested_start_date:'2026-11-01',failed_at:null,failure_reason:null}],
 supply_periods:[{...PERIOD}],supplier_switch_events:[],ediel_message_events:[],
 ediel_messages:[
  {id:'00000000-0000-4000-8000-000000000003',company_id:'company',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z03',switch_request_id:'switch-1',outbound_request_id:null,status:'sent'},
  {id:'00000000-0000-4000-8000-0000000000a1',company_id:'company',environment:'test',direction:'inbound',message_family:'APERAK',status:'received',parsed_payload:{},validation_report:{}}]}}
const ackRow=()=>structuredClone(db.rows.ediel_messages.find(r=>r.id==='00000000-0000-4000-8000-0000000000a1')) as never
const run=()=>processInboundAckMessage({actorUserId:'actor',message:ackRow()})
const sw=()=>db.rows.supplier_switch_requests[0]

beforeEach(()=>{db.outcome='negative'})

describe.each(['accepted','completed'])('after Z04 (switch %s)',status=>{
 beforeEach(()=>seed(status,true))
 it('a late whole-source negative APERAK27 keeps the switch and period; the ACK receipt is still recorded',async()=>{
  const result=await run()
  expect(result).toMatchObject({outcome:'negative',wholeSourceRejected:true,switchRequestId:'switch-1'})
  expect(sw()).toMatchObject({status,failed_at:null,failure_reason:null,inbound_z04_message_id:'z04-in',confirmed_start_date:'2026-11-01'})
  expect(db.rows.supply_periods).toEqual([PERIOD])
  expect(db.calls).toContain('gridex_apply_inbound_ack_source_v1')
  expect(db.rows.ediel_messages.find(r=>r.id==='00000000-0000-4000-8000-000000000003')).toMatchObject({aperak_status:'rejected',ack_outcome:'negative'})
  expect(db.rows.ediel_messages.find(r=>r.id==='00000000-0000-4000-8000-0000000000a1')).toMatchObject({status:'failed',related_message_id:'00000000-0000-4000-8000-000000000003'})
  expect(db.rows.ediel_message_events).toContainEqual(expect.objectContaining({eventType:'aperak_received',eventStatus:'error'}))
  expect(db.rows.supplier_switch_events).toContainEqual(expect.objectContaining({eventType:'ediel_ack_received',payload:expect.objectContaining({ackEdielMessageId:'00000000-0000-4000-8000-0000000000a1',outcome:'negative',currentSwitchStatus:status})}))
  expect(db.rows.supplier_switch_events.some(e=>e.event_type==='status_updated'||e.eventStatus==='failed')).toBe(false)
 })
 it('a replay of the same negative leaves the state unchanged',async()=>{
  await run();const after=structuredClone({switch:sw(),periods:db.rows.supply_periods})
  await run()
  expect({switch:sw(),periods:db.rows.supply_periods}).toEqual(after)
  expect(sw().status).toBe(status)
 })
})

describe.each(['prepared','submitted','sent','queued'])('before Z04 (switch %s)',status=>{
 beforeEach(()=>seed(status,false))
 it('a negative APERAK27 still fails the switch as today',async()=>{
  await run()
  expect(sw()).toMatchObject({status:'failed',failure_reason:'APERAK 27 avvisade'})
  expect(sw().failed_at).toEqual(expect.any(String))
  expect(db.rows.supplier_switch_events).toContainEqual(expect.objectContaining({eventType:'ediel_ack_received',eventStatus:'failed'}))
  expect(db.rows.supply_periods).toEqual([PERIOD])
 })
})

it('ordering: a negative processed before Z04 leaves the switch failed; this processor never resurrects it',async()=>{
 // Existing semantics: the ACK processor only fails pre-confirmation switches;
 // a later Z04 is handled by the PRODAT consumer, not by ACK processing. A
 // further (replayed) ACK on the failed switch does not change it.
 seed('sent',false);await run();expect(sw().status).toBe('failed')
 db.outcome='positive';await run()
 expect(sw().status).toBe('failed')
 expect(db.rows.supply_periods).toEqual([PERIOD])
})

it('a positive ACK on an accepted switch leaves a still-valid period untouched',async()=>{
 seed('accepted',true);db.outcome='positive'
 await run()
 expect(sw()).toMatchObject({status:'accepted',confirmed_start_date:'2026-11-01'})
 expect(db.rows.supply_periods).toEqual([PERIOD])
})
