import {beforeEach, describe, expect, it, vi} from 'vitest'
const io = vi.hoisted(() => ({row: {} as Record<string, unknown>, attachments: [] as Record<string, unknown>[],
  limits: [] as number[], register: vi.fn(), status: vi.fn(), parse: vi.fn(), task: vi.fn()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'ediel_read_unattributed_technical_intake_v1') throw new Error(`Undeclared AI fixture RPC: ${name}`)
    expect(args).toEqual({p_inbound_email_message_id: 'mail1', p_source_message_id: null, p_actor_user_id: '30000000-0000-4000-8000-000000000001'})
    // These ordinary sources have no protected technical birth; null grants no authority.
    return {data: null, error: null}
  },
  from: (table: string) => {
  const result = () => ({data: table === 'inbound_email_messages' ? io.row : io.attachments, error: null})
  return {select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn((value: number) => {io.limits.push(value); return Promise.resolve(result())}),
    maybeSingle: vi.fn(() => Promise.resolve(result()))}
}}}))
vi.mock('@/lib/ediel/core/kernel', () => ({registerInboundCanonicalMessage: io.register}))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({updateInboundEmailProcessingStatus: io.status}))
vi.mock('@/lib/inbound-mail/edielEmailParser', () => ({parseInboundEmailContent: io.parse}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({createInboundMailTask: io.task}))
vi.mock('@/lib/inbound-mail/dsnTransportCandidates', () => ({projectDsnTransportCandidates: vi.fn().mockResolvedValue([])}))
import {processInboundEmailMessage} from '@/lib/inbound-mail/edielInboundProcessor'
const raw = 'AI;54321;Network;12345;Supplier;202610011200;;20261001;20261101;Ver20140401\nNET;735123456789012345;9;;;;;Street;12345;Town;12345;;;;;;;199001011234;Person;;;'
beforeEach(() => {
  vi.clearAllMocks(); io.limits.length = 0; io.attachments = []
  io.row = {company_id: '10000000-0000-4000-8000-000000000001', environment: 'test'}
  io.register.mockResolvedValue({id: '20000000-0000-4000-8000-000000000001'})
})
const process = () => processInboundEmailMessage({inboundEmailMessageId: 'mail1', actorUserId: '30000000-0000-4000-8000-000000000001'})
describe('whole physical AI/BI mailbox sources before EDIFACT extraction', () => {
  it('processes the actual canonical technical payload even without a body or attachment', async () => {
    io.row.raw_edifact_payload = raw
    expect(await process()).toMatchObject({status: 'processed'})
    expect(io.register.mock.calls[0][0].input).toMatchObject({rawPayload: raw, messageStandard: 'ai_list', environment: 'test', senderEdielId: '54321', receiverEdielId: '12345'})
    expect(io.parse).not.toHaveBeenCalled()
  })
  it('deduplicates identical physical copies without combining differing sources', async () => {
    io.row.body_text = raw; io.row.raw_edifact_payload = raw; io.attachments = [{raw_text: raw, filename: 'actual.csv'}]
    expect(await process()).toMatchObject({status: 'processed'})
    expect(io.register).toHaveBeenCalledTimes(1)
  })
  it('does not omit a different eleventh physical source', async () => {
    io.attachments = Array.from({length: 10}, () => ({raw_text: raw})); io.attachments.push({raw_text: raw.replace('54321', '54322')})
    await expect(process()).rejects.toThrow('physical_source_ambiguous')
    expect(io.register).not.toHaveBeenCalled(); expect(io.parse).not.toHaveBeenCalled()
  })
  it('holds attachment overflow without treating a prefix as a processed mail', async () => {
    io.attachments = Array.from({length: 129}, () => ({raw_text: raw}))
    expect(await process()).toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.limits).toEqual([129]); expect(io.status).toHaveBeenCalledWith(expect.objectContaining({matchStatus: 'physical_attachment_limit_exceeded'}))
    expect(io.register).not.toHaveBeenCalled(); expect(io.parse).not.toHaveBeenCalled()
  })
  it('classifies a delivery report before an embedded AI source', async () => {
    io.row.raw_email = 'Content-Type: multipart/report; report-type=delivery-status\r\n\r\nFinal-Recipient: rfc822; x@example.test\r\nAction: failed\r\nStatus: 5.1.1'
    io.row.raw_edifact_payload = raw
    expect(await process()).toMatchObject({status: 'manual_review'})
    expect(io.status).toHaveBeenCalledWith(expect.objectContaining({matchStatus: 'dsn_transport_review'}))
    expect(io.register).not.toHaveBeenCalled()
  })
})
