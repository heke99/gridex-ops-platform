// An ordinary Ediel e-mail stores the EDIFACT attachment twice: once as
// inbound_email_messages.raw_edifact_payload (extracted at reception) and once
// as the attachment's raw_text. The processor must hand the parser one copy;
// two copies of a UNA interchange made every attachment-borne file fail with
// edifact_dangling_release_character (and without UNA doubled the segments).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ parsedInputs: [] as Array<{ attachmentText?: string | null }>, parsed: [] as unknown[], parseErrors: [] as string[], mailCompany: null as string | null, linkedCompanies: [] as Array<string | null>, persisted: true }))
const mocks = vi.hoisted(() => ({ update: vi.fn(), task: vi.fn(), tenant: vi.fn() }))

vi.mock('@/lib/inbound-mail/edielEmailParser', async (original) => {
  const actual = await original<typeof import('@/lib/inbound-mail/edielEmailParser')>()
  return { ...actual, parseInboundEmailContent: (input: Parameters<typeof actual.parseInboundEmailContent>[0]) => {
    io.parsedInputs.push(input)
    try { const result = actual.parseInboundEmailContent(input); io.parsed.push(result); return result }
    catch (error) { io.parseErrors.push((error as Error).message); throw error }
  } }
})

const wire = [
  "UNA:+.? '", "UNB+UNOC:3+80001:ZZ+70001:ZZ+260902:0600+260901000001++23-DDQ-E66-T++++1'", "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
  "BGM+E66::260+M260901000001+9+AB'", "DTM+137:202609020600:203'", "DTM+735:?+0200:406'", "MKS+23+E02::260'",
  "NAD+MS+80001:SVK:260'", "NAD+MR+70001:SVK:260'", "NAD+DDQ'", "IDE+24+T260901000001'", "LOC+172+735999000000000017::9'",
  "LOC+239+TES:SVK:260'", "LIN+++8716867000030:::9'", "DTM+324:202609010000202609020000:719'", "DTM+597:202609020600:203'",
  "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'", "CCI+++E12::260'", "CAV+E17::260'",
  "SEQ++1'", "QTY+136:0.125'", "DTM+597:202609010000:203'", "STS+7++21::260'",
]
const raw = [...wire, `UNT+${wire.length - 1}+1'`, "UNZ+1+260901000001'"].join('\n')

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const result = () => table === 'inbound_email_messages'
      ? { data: { id: 'mail1', company_id: io.mailCompany, environment: 'test', raw_email: null, body_text: 'Ediel', raw_edifact_payload: raw, has_attachments: true }, error: null }
      : table === 'inbound_email_attachments'
        ? { data: [{ id: 'att1', inbound_email_message_id: 'mail1', filename: 'E66.edi', raw_text: raw, is_edifact_candidate: true }], error: null }
        : { data: null, error: null }
    const query: Record<string, unknown> = {}
    let nullOnly = false
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'not', 'or']) query[method] = () => query
    query.is = (column: string, value: unknown) => { if (column === 'company_id' && value === null) nullOnly = true; return query }
    query.update = (patch: { company_id?: string }) => {
      query.then = (resolve: (value: unknown) => unknown) => {
        if (table === 'inbound_email_messages' && patch.company_id && (!nullOnly || io.mailCompany === null)) io.mailCompany = patch.company_id
        return Promise.resolve({ data: null, error: null }).then(resolve)
      }
      return query
    }
    query.maybeSingle = async () => result()
    query.single = async () => result()
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return query
  },
  rpc: async () => ({ data: null, error: null }),
} }))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({
  updateInboundEmailProcessingStatus: mocks.update,
  createParseResult: vi.fn(),
  createInboundEdielMessage: vi.fn(async (input: { companyId: string }) => { io.linkedCompanies.push(io.mailCompany); void input; return io.persisted ? 'message1' : null }),
  createUnresolvedInboundEdielMessage: vi.fn(), applySafeInboundStatusUpdate: vi.fn(),
}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: mocks.task }))
vi.mock('@/lib/inbound-mail/inboundMatcher', () => ({
  matchOutboundRequestForInbound: async () => ({ status: 'missing', entityId: null, entityType: null, reasons: ['unsolicited periodic values'], candidates: [] }),
  matchMeteringPointForInbound: async () => ({ status: 'missing', entityId: null, entityType: null, reasons: [], candidates: [] }),
}))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: mocks.tenant }))

import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'

beforeEach(() => {
  io.parsedInputs = []; io.parsed = []; io.parseErrors = []; io.mailCompany = null; io.linkedCompanies = []; io.persisted = true
  vi.clearAllMocks()
  mocks.tenant.mockResolvedValue({ status: 'unresolved', companyId: null, reasons: ['fixture stops after parse'], evidence: [] })
})

describe('inbound e-mail with an EDIFACT attachment', () => {
  it('parses one copy of the interchange and keeps all of its segments', async () => {
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1' }).catch(() => undefined)
    expect(io.parseErrors).toEqual([])
    expect(io.parsedInputs).toHaveLength(1)
    expect(io.parsedInputs[0].attachmentText?.match(/UNA:/g)).toHaveLength(1)
    expect(io.parsed[0]).toMatchObject({ messageFamily: 'UTILTS', messageCode: 'E66', segments: expect.any(Array) })
    expect((io.parsed[0] as { segments: unknown[] }).segments).toHaveLength(wire.length + 1)
  })

  it('attributes shared-mailbox mail to the verified tenant before an Ediel message is created from it', async () => {
    mocks.tenant.mockResolvedValue({ status: 'resolved', companyId: 'tenant-a', reasons: [], evidence: [], shared: null })
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' }).catch(() => undefined)
    expect(io.mailCompany).toBe('tenant-a')
    expect(io.linkedCompanies).toEqual(['tenant-a'])
  })

  it('stops instead of re-attributing mail that already belongs to another tenant', async () => {
    io.mailCompany = 'tenant-b'
    mocks.tenant.mockResolvedValue({ status: 'resolved', companyId: 'tenant-a', reasons: [], evidence: [], shared: null })
    await expect(processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })).rejects.toThrow('inbound_email_tenant_attribution_conflict')
    expect(io.mailCompany).toBe('tenant-b')
    expect(io.linkedCompanies).toEqual([])
  })

  it('fails the job for retry when the Ediel original could not be persisted, without a misleading review task', async () => {
    io.persisted = false
    mocks.tenant.mockResolvedValue({ status: 'resolved', companyId: 'tenant-a', reasons: [], evidence: [], shared: null })
    await expect(processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })).rejects.toThrow('ediel_inbound_original_persistence_required')
    expect(mocks.task).not.toHaveBeenCalled()
  })
})
