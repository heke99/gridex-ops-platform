// Declared transport/auth ports exercise the real inbound coordinator order.
// Source qualification, native persistence and real sends are separate proofs.
import {beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {source} from './fixtures/prodat-identity'
const io=vi.hoisted(()=>({message:null as import('@/lib/ediel/types').EdielMessageRow|null,
  endpoint:vi.fn(),actor:vi.fn(),record:vi.fn(),capture:vi.fn(),ack:vi.fn(),event:vi.fn(),tenant:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.message,createEdielMessageEvent:io.event}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority',()=>({readEdielTechnicalSourceEndpoint:io.endpoint,
  recordEdielTechnicalSyntaxDecision:io.record,captureEdielTechnicalSyntaxAckEvidence:io.capture}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:io.tenant}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.ack}))
vi.mock('@/lib/ediel/ack/prepareSourceAckDraft',()=>({prepareSourceAckDraft:async()=>({kind:'draft',draft:{messageFamily:'CONTRL'}})}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:vi.fn()}))
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
const wire="UNB+UNOC:3+12345:ZZ+54321:ZZ+260930:1200+I'UNH+M+UNKNOWN:D:97A:UN:E2SE6A'BGM+Z01+D+9'UNT+99+M'UNZ+1+I'"
beforeEach(()=>{
  vi.clearAllMocks();io.message={...source(wire),message_family:'OTHER'}
  io.endpoint.mockResolvedValue({companyId:'technical-tenant',environment:'test',sourceHash:createHash('sha256').update(wire,'utf8').digest('hex')})
  io.actor.mockResolvedValue(undefined);io.record.mockResolvedValue(undefined);io.capture.mockResolvedValue(undefined)
  io.ack.mockResolvedValue({id:'ack',status:'sent'});io.event.mockResolvedValue(undefined)
})
const run=()=>processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:io.message!.id})
it('qualifies physical syntax and its negative CONTRL before an unknown family activation gate',async()=>{
  await run()
  expect(io.actor).toHaveBeenCalledWith({companyId:'technical-tenant',actorUserId:expect.any(String),permission:'communication.write'})
  expect(io.record).toHaveBeenCalledWith(expect.objectContaining({syntaxDecision:'rejected',reasonCodes:expect.arrayContaining(['unt_count_mismatch'])}))
  expect(io.ack).toHaveBeenCalledWith(expect.objectContaining({ackFamily:'CONTRL',outcome:'negative'}))
  expect(io.ack.mock.invocationCallOrder[0]).toBeLessThan(io.event.mock.invocationCallOrder[0])
  expect(io.tenant).not.toHaveBeenCalled()
})
it('holds a changed source hash before syntax authority or response writes',async()=>{
  io.endpoint.mockResolvedValue({companyId:'technical-tenant',environment:'test',sourceHash:'b'.repeat(64)})
  await run();expect(io.actor).not.toHaveBeenCalled();expect(io.record).not.toHaveBeenCalled();expect(io.ack).not.toHaveBeenCalled()
})
it('requires the actual technical tenant actor before recording a syntax result',async()=>{
  io.actor.mockRejectedValue(Error('denied'));await run()
  expect(io.record).not.toHaveBeenCalled();expect(io.capture).not.toHaveBeenCalled();expect(io.ack).not.toHaveBeenCalled()
})
it('does not enter the technical receiver for an outbound row',async()=>{
  io.message={...io.message!,direction:'outbound'};await run();expect(io.endpoint).not.toHaveBeenCalled();expect(io.ack).not.toHaveBeenCalled()
})
