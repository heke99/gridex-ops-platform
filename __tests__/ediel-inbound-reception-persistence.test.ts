import{describe,it,expect,vi,beforeEach}from'vitest'
import{createHash}from'node:crypto'
const h=vi.hoisted(()=>({duplicate:null as Record<string,unknown>|null,legacy:[] as Record<string,unknown>[],queries:[] as {table:string;method:string;value:unknown}[],duplicateRead:vi.fn(),rpc:vi.fn(),actor:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...a:unknown[])=>h.rpc(...a),from:(table:string)=>{
 let mode='read',payload:Record<string,unknown>={};const q={eq:()=>q,is:()=>q,select:()=>q,order:()=>q,
 insert:(value:Record<string,unknown>)=>{mode='insert';payload=value;h.queries.push({table,method:'insert',value});return q},
 update:(value:unknown)=>{h.queries.push({table,method:'update',value});return q},
 limit:async()=>({data:h.legacy,error:null}),maybeSingle:async()=>({data:mode==='insert'?{id:'00000000-0000-4000-8000-000000000005'}:table==='inbound_email_messages'?{id:'00000000-0000-4000-8000-000000000010',company_id:'00000000-0000-4000-8000-000000000001',environment:'test',received_at:'2026-10-01T00:00:00Z'}:h.duplicate,error:null}),
 then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:payload,error:null}).then(resolve)};return q}}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:(...a:unknown[])=>h.actor(...a)}))
vi.mock('@/lib/ediel/core/dedupe',async(importOriginal)=>({...await importOriginal<object>(),findInboundDuplicateByCanonicalIdentity:(...a:unknown[])=>h.duplicateRead(...a)}))
import{createInboundEdielMessage}from'@/lib/inbound-mail/inboundStatusUpdater'
import{parseInboundEmailContent}from'@/lib/inbound-mail/edielEmailParser'
import{InboundReceptionHeldError}from'@/lib/ediel/inbound/receptions'
const u=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const raw="UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:0000+OLD+++++23-DDQ-PRODAT'UNH+1+PRODAT:D:96B:UN:E2SE6A'BGM+Z02+OWN+9'LIN+1'UNT+4+1'UNZ+1+OLD'"
const parsed=()=>{const p=parseInboundEmailContent({bodyText:raw});if(!p)throw Error('fixture actual parse required');return p}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex')
function result(classification='first_reception',replay=false){return{companyId:u(1),sourceMessageId:u(5),inboundEmailMessageId:u(10),parseResultId:u(20),receptionId:u(21),classification,isReplay:replay,receivedAt:'2026-10-01T00:00:00Z',canonicalPayloadHash:sha(raw),receivedPayloadHash:sha(raw),responseRequestId:classification==='first_reception'?null:u(22),status:classification==='first_reception'?'observed':'held',reason:classification==='first_reception'?null:'authentic_duplicate_transport_response_policy_required',businessEffectAuthorized:false}}
const input=()=>({companyId:u(1),environment:'test',actorUserId:u(3),inboundEmailMessageId:u(10),parseResultId:u(20),parsed:parsed()})
function original(){return{id:u(5),company_id:u(1),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',message_code:'Z02',sender_ediel_id:'54321',receiver_ediel_id:'21660',application_reference:parsed().applicationReference,interchange_reference:'OLD',raw_payload:raw,status:'acknowledged',ack_outcome:'positive',parsed_payload:{immutable:'FIRST'}}}
beforeEach(()=>{h.queries=[];h.legacy=[];h.duplicate=null;h.duplicateRead.mockReset().mockImplementation(async()=>h.duplicate);h.actor.mockReset().mockResolvedValue(undefined);h.rpc.mockReset().mockResolvedValue({data:result(),error:null})})
describe('live canonical inbound persistence: synthetic native observation ports, no T policy activation',()=>{
 it('persists a first actual original, then records the exact real mailbox/parse identity',async()=>{
  expect(await createInboundEdielMessage(input())).toBe(u(5))
  const inserted=h.queries.find(q=>q.table==='ediel_messages'&&q.method==='insert')!.value as Record<string,unknown>
  expect(inserted.raw_payload).toBe(raw);expect(inserted).not.toHaveProperty('original_message_id');expect(inserted.message_received_at).toBe('2026-10-01T00:00:00.000Z')
  expect(inserted).toMatchObject({inbound_email_message_id:u(10),mailbox_message_id:u(10)})
  expect(h.rpc).toHaveBeenCalledWith('ediel_record_inbound_reception_v1',{p_company_id:u(1),p_message_id:u(5),p_actor_user_id:u(3),p_inbound_email_message_id:u(10),p_parse_result_id:u(20)})
  expect(h.queries.filter(q=>q.method==='update')).toEqual([])
 })
 it('reuses the saved original for the same reception without raw/status/context/ACK updates',async()=>{
  h.duplicate=original();const before=JSON.stringify(h.duplicate);h.rpc.mockResolvedValue({data:result('first_reception',true),error:null})
  expect(await createInboundEdielMessage(input())).toBe(u(5));expect(JSON.stringify(h.duplicate)).toBe(before);expect(h.queries).toEqual([])
  expect(h.duplicateRead).toHaveBeenCalledWith(expect.objectContaining({companyId:u(1),environment:'test',receiverEdielId:'21660',applicationReference:parsed().applicationReference}))
 })
 it('stops new same-wire duplicate processing at its durable held response request',async()=>{
  h.duplicate=original();h.rpc.mockResolvedValue({data:result('protocol_duplicate'),error:null})
  await expect(createInboundEdielMessage(input())).rejects.toBeInstanceOf(InboundReceptionHeldError)
  expect(h.queries).toEqual([])
 })
 it('records the identity conflict before holding different raw, never overwriting the original',async()=>{
  h.duplicate=original();const f=input();f.parsed.rawPayload=raw.replace('BGM+Z02+OWN','BGM+Z02+EDITED');h.rpc.mockResolvedValue({data:{...result('identity_conflict'),receivedPayloadHash:sha(f.parsed.rawPayload)},error:null})
  await expect(createInboundEdielMessage(f)).rejects.toBeInstanceOf(InboundReceptionHeldError)
  expect(h.duplicate.raw_payload).toBe(raw);expect(h.queries).toEqual([])
 })
 it('propagates native foreign source rejection and requires a real current actor/parse',async()=>{
  h.duplicate=original();h.rpc.mockResolvedValue({data:null,error:Error('ediel_real_reception_source_scope_required')})
  await expect(createInboundEdielMessage(input())).rejects.toThrow('source_scope_required');expect(h.queries).toEqual([])
  await expect(createInboundEdielMessage({...input(),actorUserId:null})).rejects.toThrow('actor_and_parse_required')
  await expect(createInboundEdielMessage({...input(),parseResultId:null})).rejects.toThrow('actor_and_parse_required')
 })
 it('holds unknown environment and ambiguous retained reception candidates without a latest fallback',async()=>{
  await expect(createInboundEdielMessage({...input(),environment:null})).rejects.toThrow('duplicate_scope_required');expect(h.queries).toEqual([])
  h.legacy=[original(),{...original(),id:u(50)}];await expect(createInboundEdielMessage(input())).rejects.toThrow('identity_ambiguous');expect(h.rpc).not.toHaveBeenCalled()
 })
})
