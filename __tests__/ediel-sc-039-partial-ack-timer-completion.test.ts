// masterplan: SC-039
// Actual deadline projection/sweep with modeled storage. Not native or whole SC-039 approval.
// Ported from donor c1ef7e96; P27 whole-rejection and direction cases added in review.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { inboundAckTimerCompletion } from '@/lib/ediel/sla/ackTimerCompletion'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'

const io = vi.hoisted(() => ({ source: {} as Record<string, unknown>, acks: [] as Record<string, unknown>[],
  timer: {} as Record<string, unknown>, event: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = []
  let fields: string[] | null = null, patch: Record<string, unknown> | null = null
  const rows = () => table === 'ediel_sla_timers' ? [io.timer]
    : table === 'ediel_messages' ? [io.source, ...io.acks] : []
  const execute = () => rows().filter(row => filters.every(filter => filter(row))).map(row => {
    if (patch) Object.assign(row, patch)
    return fields ? Object.fromEntries(fields.map(key => [key, row[key]])) : { ...row }
  })
  const q: Record<string, unknown> = {}
  Object.assign(q, { select: (value: string) => { fields = value.split(',').map(field => field.trim()); return q },
    eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
    order: () => q, limit: () => q, update: (value: Record<string, unknown>) => { patch = value; return q },
    maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: execute(), error: null }).then(resolve) })
  return q
} } }))

function wire(family: 'PRODAT' | 'APERAK', body: string[], acknowledgement = false) {
  return EdifactEnvelopeCodec.encode({ sender: acknowledgement ? 'TRANSPORT_R' : 'TRANSPORT_S',
    receiver: acknowledgement ? 'TRANSPORT_S' : 'TRANSPORT_R', environment: 'test',
    applicationReference: '23-DDQ-PRODAT', interchangeReference: acknowledgement ? 'ACKI' : 'SOURCEI',
    acknowledgementRequest: true, messages: [{ messageReference: acknowledgement ? 'ACKM' : 'SOURCEM',
      messageTypeToken: family === 'PRODAT' ? 'PRODAT:D:97A:UN:E2SE6A' : 'APERAK:D:96A:UN:E2SE6A', businessSegments: body }] })
}
function source(options: { code?: string; missingLi?: boolean; multiRegister?: boolean } = {}) {
  const first = ['LIN+1++POINT-A:::9', 'RFF+LI:LI-A']
  const second = [`LIN+${options.multiRegister ? '3' : '2'}++POINT-B:::9`, ...(options.missingLi ? [] : ['RFF+LI:LI-B'])]
  const registers = options.multiRegister ? ['LIN+2+1:2+POINT-A:::9'] : []
  if (options.multiRegister) first[0] = 'LIN+1+1:1+POINT-A:::9'
  return { id: 'source', company_id: 'tenant-a', environment: 'test' as const, direction: 'inbound' as const,
    message_family: 'PRODAT' as const, raw_payload: wire('PRODAT', [`BGM+${options.code ?? 'Z05'}+SOURCE-D+9`,
      'NAD+FR+LEGAL_S:160:SVK+++++++SE', 'NAD+DO+LEGAL_R:160:SVK+++++++SE', ...first, ...registers, ...second]) }
}
function ack(objects: Array<{ id: string; li?: string | null; negative?: boolean }>, extra: Record<string, unknown> = {}) {
  const body = ['BGM+++34', 'RFF+ACW:SOURCE-D', 'NAD+FR+LEGAL_R:160:SVK+++++++SE', 'NAD+DO+LEGAL_S:160:SVK+++++++SE',
    ...objects.flatMap(object => [`ERC+${object.negative ? '42' : '100'}::260`,
      object.negative ? 'FTX+AAO++260::260+Felaktigt Natomradesid BAD' : 'FTX+AAO+++OK',
      `RFF+Z07:${object.id}`, ...(object.li ? [`RFF+LI:${object.li}`] : [])])]
  return { id: objects.map(object => object.id).join('-'), company_id: 'tenant-a', environment: 'test', related_message_id: 'source',
    direction: 'outbound', status: 'sent', message_sent_at: '2026-10-13T12:00:00Z', message_family: 'APERAK',
    ack_outcome: objects.some(object => object.negative) ? 'negative' : 'positive', raw_payload: wire('APERAK', body, true),
    validation_report: { sourceMessageId: 'source', ackScope: 'object' }, ...extra }
}
const a = { id: 'POINT-A', li: 'LI-A' }, b = { id: 'POINT-B', li: 'LI-B' }
const completion = (acks: Record<string, unknown>[], original = source()) =>
  inboundAckTimerCompletion({ source: original, timerType: 'aperak_due', acknowledgements: acks })

beforeEach(() => {
  vi.clearAllMocks(); io.event.mockResolvedValue(null); io.source = source(); io.acks = [ack([a])]
  io.timer = { id: 'timer', company_id: 'tenant-a', ediel_message_id: 'source', timer_type: 'aperak_due',
    status: 'open', warning_at: '2026-10-13T12:00:00Z', critical_at: '2026-10-13T12:15:00Z', due_at: '2026-10-13T12:30:00Z' }
})

describe('partial PRODAT responses retain every own object deadline', () => {
  it('does not resolve B after only A was acknowledged', () => { expect(completion([ack([a])])).toBeNull() })
  it('does not let duplicate A replies cover B', () => { expect(completion([ack([a]), ack([a])])).toBeNull() })
  it('resolves all objects from separate positive replies', () => { expect(completion([ack([a]), ack([b])])).toBe('resolved') })
  it('resolves one complete mixed positive and negative reply', () => { expect(completion([ack([a, { ...b, negative: true }])])).toBe('resolved') })
  it('resolves complete separate positive and negative replies', () => { expect(completion([ack([a]), ack([{ ...b, negative: true }])])).toBe('resolved') })
  it('uses actual Z07 membership for a negative object with absent LI', () => {
    expect(completion([ack([a, { id: 'POINT-B', negative: true }])], source({ missingLi: true }))).toBe('resolved')
  })
  it('does not turn an invented LI into coverage of a source without LI', () => {
    expect(completion([ack([a, { ...b, negative: true }])], source({ missingLi: true }))).toBeNull()
  })
  it('groups multi-register objects by their actual first register', () => {
    expect(completion([ack([a, b])], source({ code: 'Z04', multiRegister: true }))).toBe('resolved')
  })
  it.each([
    ['queued', { status: 'queued' }], ['foreign tenant', { company_id: 'tenant-b' }],
    ['foreign environment', { environment: 'production' }], ['foreign source', { related_message_id: 'other-source' }],
    ['wrong direction', { direction: 'inbound' }], ['missing raw', { raw_payload: null }],
  ])('keeps B pending for %s response', (_name, change) => {
    expect(completion([ack([a]), ack([b], change)])).toBeNull()
  })
  it.each([
    ['wrong original', (raw: string) => raw.replace('RFF+ACW:SOURCE-D', 'RFF+ACW:OTHER')],
    ['wrong legal sender', (raw: string) => raw.replace('NAD+FR+LEGAL_R', 'NAD+FR+OTHER')],
    ['wrong LI', (raw: string) => raw.replace('RFF+LI:LI-B', 'RFF+LI:OTHER')],
    ['wrong object', (raw: string) => raw.replace('RFF+Z07:POINT-B', 'RFF+Z07:OTHER')],
    ['wrong envelope sender', (raw: string) => raw.replace('TRANSPORT_R', 'OTHER')],
  ])('ignores physical %s even when report claims coverage', (_name, change) => {
    const reply = ack([b]); reply.raw_payload = change(reply.raw_payload)
    expect(completion([ack([a]), reply])).toBeNull()
  })
  it('retains source-qualified whole-header negative completion even for malformed source', () => {
    expect(completion([ack([], { ack_outcome: 'negative', raw_payload: wire('APERAK', ['BGM+++27', 'RFF+ACW:SOURCE-D', 'ERC+42::260', 'FTX+AAO++202::260+Felaktigt Meddelandenamn BAD'], true), validation_report: { sourceMessageId: 'source', ackScope: 'message' } })],
      { ...source(), raw_payload: 'broken source' })).toBe('resolved')
  })
  it('does not turn a partial object negative into a whole-message result through editable metadata', () => {
    expect(completion([ack([{ ...a, negative: true }], { validation_report: { sourceMessageId: 'source', ackScope: 'message' } })])).toBeNull()
  })
  it('does not borrow a foreign whole-header declaration', () => {
    expect(completion([ack([], { ack_outcome: 'negative', validation_report: { sourceMessageId: 'other', ackScope: 'message' } })])).toBeNull()
  })
  it('preserves technical syntax-rejection cancellation', () => {
    expect(completion([ack([], { message_family: 'CONTRL', ack_outcome: 'negative' })])).toBe('cancelled')
  })
  it('keeps the real overdue sweep expired for an unanswered sibling', async () => {
    expect(await checkAckDeadlines({ actorUserId: 'actor', companyId: 'tenant-a', now: '2026-10-13T12:31:00Z' }))
      .toEqual({ warning: 0, critical: 0, expired: 1, updated: 1 })
    expect(io.timer.status).toBe('expired')
    expect(io.event).toHaveBeenCalledWith(expect.objectContaining({ eventStatus: 'error', payload: expect.objectContaining({ status: 'expired' }) }))
  })
  it('resolves the real sweep after complete physical replies using selected source/ACK bytes', async () => {
    io.acks = [ack([a]), ack([b])]
    expect(await checkAckDeadlines({ actorUserId: 'actor', now: '2026-10-13T12:31:00Z' }))
      .toEqual({ warning: 0, critical: 0, expired: 0, updated: 1 })
    expect(io.timer.status).toBe('resolved')
  })

  // P27 rejects the whole original (P-17 LIN sequence, header, duplicate 103)
  // even when it names only the defective object; it must not leave B to expire.
  const p27 = (refs: string[], extra: Record<string, unknown> = {}, acw = 'SOURCE-D') => ack([], { ack_outcome: 'negative',
    raw_payload: wire('APERAK', ['BGM+++27', `RFF+ACW:${acw}`, 'NAD+FR+LEGAL_R:160:SVK+++++++SE', 'NAD+DO+LEGAL_S:160:SVK+++++++SE',
      'ERC+40::260', 'FTX+AAO++103::260+Dubblett av meddelandet', ...refs], true), validation_report: {}, ...extra })
  it('resolves a physical P27 whole rejection that names only one object', () => {
    expect(completion([p27(['RFF+Z07:POINT-A', 'RFF+LI:LI-A'])])).toBe('resolved')
  })
  it('resolves a physical P27 whole rejection without object references', () => {
    expect(completion([p27([])])).toBe('resolved')
  })
  it('does not accept a P27 rejection of another original document', () => {
    expect(completion([p27(['RFF+Z07:POINT-A', 'RFF+LI:LI-A'], {}, 'OTHER-D')])).toBeNull()
  })
  it('does not accept a P27 rejection explicitly bound to another source', () => {
    expect(completion([p27([], { validation_report: { sourceMessageId: 'other', ackScope: 'message' } })])).toBeNull()
  })
  it('does not accept a P27 row whose stored outcome is not negative', () => {
    expect(completion([p27([], { ack_outcome: 'positive' })])).toBeNull()
  })
  it('does not accept an unsent P27 rejection', () => {
    expect(completion([p27([], { status: 'queued' })])).toBeNull()
  })
  it.each([['missing', undefined], ['outbound', 'outbound']] as const)('fails closed for %s source direction', (_name, direction) => {
    const original = { ...source(), direction } as unknown as ReturnType<typeof source>
    expect(completion([ack([a]), ack([b])], original)).toBeNull()
    expect(completion([p27([])], original)).toBeNull()
  })
  it('resolves the real sweep from a P27 whole rejection', async () => {
    io.acks = [p27(['RFF+Z07:POINT-A', 'RFF+LI:LI-A'])]
    expect(await checkAckDeadlines({ actorUserId: 'actor', companyId: 'tenant-a', now: '2026-10-13T12:31:00Z' }))
      .toEqual({ warning: 0, critical: 0, expired: 0, updated: 1 })
    expect(io.timer.status).toBe('resolved')
  })
})
