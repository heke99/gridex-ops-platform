// Track 3 finding 016 (d): a held duplicate/identity-conflict reception without a
// canonical customer must not vanish into a log line. It becomes one open,
// tenant-scoped ediel_manual_review_items row; with a customer the existing
// customer_operation_tasks path is unchanged.
import {beforeEach,describe,expect,it,vi} from 'vitest'

type Call={table:string;op:string;row?:Record<string,unknown>;options?:Record<string,unknown>;filters:Array<[string,unknown]>}
const io=vi.hoisted(()=>({calls:[] as Call[],count:0}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const call:Call={table,op:'select',filters:[]}
 const q:Record<string,unknown>={}
 Object.assign(q,{
  select:()=>{io.calls.push(call);return q},
  eq:(k:string,v:unknown)=>{call.filters.push([k,v]);return q},
  contains:(k:string,v:unknown)=>{call.filters.push([k,v]);return Promise.resolve({count:io.count,error:null})},
  insert:(row:Record<string,unknown>)=>{io.calls.push({table,op:'insert',row,filters:[]});return Promise.resolve({error:null})},
  upsert:(row:Record<string,unknown>,options:Record<string,unknown>)=>{io.calls.push({table,op:'upsert',row,options,filters:[]});return Promise.resolve({error:null})},
 })
 return q
}}}))
import {createInboundMailTask} from '@/lib/inbound-mail/inboundTaskFactory'

const COMPANY='00000000-0000-4000-8000-000000000001'
const OTHER='00000000-0000-4000-8000-0000000000ff'
const reception=(companyId=COMPANY)=>({companyId,sourceMessageId:'00000000-0000-4000-8000-000000000020',inboundEmailMessageId:'00000000-0000-4000-8000-000000000010',parseResultId:'00000000-0000-4000-8000-000000000030',receptionId:'00000000-0000-4000-8000-000000000040',classification:'identity_conflict',isReplay:false,receivedAt:'2026-10-30T10:00:00Z',canonicalPayloadHash:'a'.repeat(64),receivedPayloadHash:'b'.repeat(64),responseRequestId:null,status:'held',reason:'ediel_identity_conflict',businessEffectAuthorized:false})
const held=(customerId:string|null,companyId=COMPANY)=>createInboundMailTask({companyId,customerId,title:'Ny Ediel-mottagning väntar på källbelagt dubblettsvar',description:'ediel_identity_conflict',taskType:'ediel_duplicate_response_held',metadata:{sourceId:null,reception:reception(),protocolResponseFailureCode:null,inboundEmailMessageId:'00000000-0000-4000-8000-000000000010',parseResultId:'00000000-0000-4000-8000-000000000030'},actorUserId:null})

beforeEach(()=>{io.calls=[];io.count=0;vi.spyOn(console,'warn').mockImplementation(()=>{})})

describe('held duplicate response without canonical customer',()=>{
 it('creates exactly one open tenant-scoped manual review item and no task',async()=>{
  await held(null)
  expect(io.calls.filter(c=>c.table==='customer_operation_tasks')).toEqual([])
  const writes=io.calls.filter(c=>c.op!=='select')
  expect(writes).toHaveLength(1)
  const [w]=writes
  expect(w.table).toBe('ediel_manual_review_items')
  expect(w.op).toBe('upsert')
  expect(w.options).toEqual({onConflict:'ediel_message_id,issue_type',ignoreDuplicates:true})
  expect(w.row).toMatchObject({company_id:COMPANY,ediel_message_id:'00000000-0000-4000-8000-000000000020',issue_type:'inbound_duplicate_response_held',status:'open'})
  expect(w.row?.payload).toEqual({inboundEmailMessageId:'00000000-0000-4000-8000-000000000010',receptionId:'00000000-0000-4000-8000-000000000040',parseResultId:'00000000-0000-4000-8000-000000000030',responseRequestId:null,classification:'identity_conflict',reason:'ediel_identity_conflict',protocolResponseFailureCode:null,canonicalPayloadHash:'a'.repeat(64),receivedPayloadHash:'b'.repeat(64)})
 })
 it('never writes for a reception that belongs to another tenant',async()=>{
  await held(null,OTHER)
  expect(io.calls.filter(c=>c.op!=='select')).toEqual([])
 })
})

describe('held duplicate response with canonical customer',()=>{
 it('keeps the existing customer_operation_tasks path',async()=>{
  await held('00000000-0000-4000-8000-000000000009')
  expect(io.calls.filter(c=>c.table==='ediel_manual_review_items')).toEqual([])
  const writes=io.calls.filter(c=>c.op==='insert')
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({table:'customer_operation_tasks',row:{company_id:COMPANY,customer_id:'00000000-0000-4000-8000-000000000009',task_type:'ediel_duplicate_response_held',status:'open'}})
 })
})
