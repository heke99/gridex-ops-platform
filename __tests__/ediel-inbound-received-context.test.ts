import {beforeEach,expect,it,vi} from 'vitest'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {company,actor,mailId,parseId,oldId,newId,receivedAt,inboundReceptionBoundary} from './fixtures/inbound-reception-db'
const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const wire="UNB+UNOC:3+27700:ZZ+21660:ZZ+260921:1200+SRC1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+DOC1+9'UNT+3+1'UNZ+1+SRC1'"
const parse=()=>{const p=parseInboundEmailContent({attachmentText:wire});if(!p)throw Error('real_parser_fixture_missing');return p}
let db:ReturnType<typeof inboundReceptionBoundary>
const input=()=>({companyId:company,actorUserId:actor,environment:db.state.environment,inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parse()})
beforeEach(()=>{vi.clearAllMocks();db=inboundReceptionBoundary(parse());io.from.mockImplementation(db.from);io.rpc.mockImplementation(db.rpc)})
const noBusiness=()=>{for(const table of ['ediel_message_events','outbound_requests','metering_values','inbound_email_messages'])expect(db.writes(table)).toEqual([])}

// The original receive snapshot and clock are immutable for every read-only retry.
it.each(['test','production'])('reads the exact original without rewriting its receive snapshot in %s',async env=>{
 db.state.environment=env;db.state.existingEnvironment=env;const before=structuredClone(db.state.original)
 await expect(createInboundEdielMessage(input())).resolves.toBe(oldId)
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.state.original).toEqual(before);noBusiness()
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
})
it('uses the real retained mail receipt for a fresh source instead of the current application clock',async()=>{
 db.state.existing=false;await expect(createInboundEdielMessage(input())).resolves.toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0]).toMatchObject({operation:'insert',payload:{company_id:company,environment:'test',raw_payload:wire,message_received_at:receivedAt}})
 expect(writes[0].payload).not.toHaveProperty('execution_context_snapshot');expect(writes[0].payload).not.toHaveProperty('immutable_payload_hash')
 expect(db.writes('ediel_message_events')).toHaveLength(1);expect(db.writes('outbound_requests')).toEqual([])
})
it.each(['protocol_duplicate','identity_conflict'] as const)('preserves old source clock/context and all business state when new native reception is %s',async classification=>{
 db.state.classification=classification;const before=structuredClone(db.state.original)
 await expect(createInboundEdielMessage(input())).rejects.toMatchObject({name:'InboundReceptionHeldError',reception:{classification,status:'held',businessEffectAuthorized:false}})
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_messages')).toEqual([]);noBusiness()
})
it.each(['immutable_ediel_received_context_cannot_change','immutable_ediel_receipt_time_cannot_change','received_ediel_context_cannot_be_backfilled'])('propagates exact physical receipt constraint %s without a success event',async message=>{
 db.state.existing=false;db.state.error={code:'23514',message};const attempt=createInboundEdielMessage(input())
 await expect(attempt).rejects.toThrow('INBOUND_PRODAT_SOURCE_CONFLICT');await expect(attempt).rejects.toMatchObject({cause:db.state.error});noBusiness()
 expect(db.state.rpcCalls.filter(c=>c.name==='ediel_record_inbound_reception_v1')).toEqual([])
})
it.each([{code:'42501',message:'immutable_ediel_receipt_time_cannot_change'},{code:'23514',message:'other: immutable_ediel_received_context_cannot_change'},{code:'23514',message:'received_ediel_context_cannot_be_backfilled suffix'}])('does not reclassify an unrelated receipt error $code/$message',async error=>{
 db.state.existing=false;db.state.error=error;await expect(createInboundEdielMessage(input())).resolves.toBeNull();noBusiness()
})
it.each(['actor','parse'] as const)('requires the actual %s before original or reception writes',async missing=>{
 const value=input();if(missing==='actor')value.actorUserId='';else value.parseResultId=''
 await expect(createInboundEdielMessage(value)).rejects.toThrow('ediel_real_reception_actor_and_parse_required');expect(db.state.calls).toEqual([]);expect(db.state.rpcCalls).toEqual([])
})
it.each(['test','production'])('does not borrow an original receive clock from the other environment into %s',async env=>{
 db.state.environment=env;db.state.existingEnvironment=env==='test'?'production':'test';await expect(createInboundEdielMessage(input())).resolves.toBe(newId)
 expect(db.writes('ediel_messages')).toHaveLength(1);expect(db.writes('ediel_messages')[0].operation).toBe('insert');expect(db.state.original.message_received_at).toBe(receivedAt)
})
