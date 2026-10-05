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

// Current source qualification precedes success metadata. The canonical original is read-only.
it.each(['test','production'])('retains exact-byte source retry without new writes or events in %s',async env=>{
 db.state.environment=env;db.state.existingEnvironment=env;await expect(createInboundEdielMessage(input())).resolves.toBe(oldId)
 expect(db.writes('ediel_messages')).toEqual([]);noBusiness()
})
it('retains fresh insertion with database-owned immutable hash',async()=>{
 db.state.existing=false;await expect(createInboundEdielMessage(input())).resolves.toBe(newId)
 expect(db.writes('ediel_messages')[0]).toMatchObject({operation:'insert',payload:{raw_payload:wire,company_id:company,message_received_at:receivedAt}})
 expect(db.writes('ediel_messages')[0].payload).not.toHaveProperty('immutable_payload_hash')
})
it.each(['raw_payload','message_family','message_standard'] as const)('rejects changed retained %s before new canonical writes',async field=>{
 db.state.original[field]='declared-foreign-or-changed';await expect(createInboundEdielMessage(input())).rejects.toThrow('canonical_inbound_duplicate_scope_or_original_conflict')
 expect(db.writes('ediel_messages')).toEqual([]);noBusiness()
})
it.each([{code:'23514',message:'immutable_ediel_payload_cannot_change'},{code:'23514',message:'immutable_ediel_payload_cannot_change',details:'original database detail',hint:'original database hint'}])('preserves the exact physical source error and cause $message',async physical=>{
 db.state.existing=false;db.state.error=physical;const attempt=createInboundEdielMessage(input())
 await expect(attempt).rejects.toThrow('INBOUND_PRODAT_SOURCE_CONFLICT');await expect(attempt).rejects.toMatchObject({cause:physical});noBusiness()
})
it.each([{code:'23514',message:'other_constraint'},{code:'42501',message:'immutable_ediel_payload_cannot_change'},{code:'23514',message:'other: immutable_ediel_payload_cannot_change'},{code:'23514',message:'immutable_ediel_payload_cannot_change suffix'}])('preserves unrelated error classification $code/$message',async physical=>{
 db.state.existing=false;db.state.error=physical;await expect(createInboundEdielMessage(input())).resolves.toBeNull();noBusiness()
})
it.each(['actor','permission'] as const)('holds a revoked current %s before reading or observing the old original',async revoked=>{
 if(revoked==='actor')db.state.actorActive=false;else db.state.permission=false
 await expect(createInboundEdielMessage(input())).rejects.toThrow(revoked==='actor'?'ediel_tenant_actor_forbidden':'ediel_tenant_permission_forbidden')
 expect(db.state.calls.filter(c=>c.table==='ediel_messages')).toEqual([]);expect(db.state.rpcCalls.filter(c=>c.name==='ediel_record_inbound_reception_v1')).toEqual([]);noBusiness()
})
it.each(['protocol_duplicate','identity_conflict'] as const)('holds actual %s reception rather than adopting old original business success',async classification=>{
 db.state.classification=classification;const before=structuredClone(db.state.original)
 await expect(createInboundEdielMessage(input())).rejects.toMatchObject({name:'InboundReceptionHeldError',reception:{classification,businessEffectAuthorized:false}})
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_messages')).toEqual([]);noBusiness()
})

it.each(['company_id','direction'] as const)('does not borrow a differently scoped %s canonical original',async field=>{
 db.state.original[field]='declared-foreign';const before=structuredClone(db.state.original)
 await expect(createInboundEdielMessage(input())).resolves.toBe(newId)
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_messages')).toHaveLength(1);expect(db.writes('ediel_messages')[0].operation).toBe('insert')
 expect(db.writes('outbound_requests')).toEqual([])
})
