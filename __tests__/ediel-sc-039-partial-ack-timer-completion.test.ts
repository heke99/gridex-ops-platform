// masterplan: SC-039
// Actual deadline projection/sweep with modeled storage. Not native or whole SC-039 approval.
// Ported from donor c1ef7e96; P27, duplicate-103, mirror and direction cases added in review.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { inboundAckTimerCompletion } from '@/lib/ediel/sla/ackTimerCompletion'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { qty, type Parts } from './fixtures/prodat-register'
import { guideOrderedFixtureRaw } from './helpers/prodatGuideOrderedFixture'
import { source as prodatSource } from './fixtures/prodat-identity'
import { mixedZ04Parts } from './helpers/mixedZ04Fixture'

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
  const registers = options.multiRegister ? ['LIN+2++POINT-A:::9+1:2'] : []
  if (options.multiRegister) first[0] = 'LIN+1++POINT-A:::9+1:1'
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

  // P27 rejects the whole original (header field 202, P-17 LIN sequence 314)
  // even when it names only the defective object; it must not leave B to expire.
  const p27 = (refs: string[], extra: Record<string, unknown> = {}, acw = 'SOURCE-D') => ack([], { ack_outcome: 'negative',
    raw_payload: wire('APERAK', ['BGM+++27', `RFF+ACW:${acw}`, 'NAD+FR+LEGAL_R:160:SVK+++++++SE', 'NAD+DO+LEGAL_S:160:SVK+++++++SE',
      ...(refs.length ? ['ERC+42::260', 'FTX+AAO++314::260+Felaktigt Sekvensnummer 1', ...refs] : ['ERC+41::260', 'FTX+AAO++202::260+Meddelandenamn saknas'])], true),
    validation_report: {}, ...extra })
  // Exact duplicateResponses.ts layout: a protocol 103 reply to a NEW reception of this original.
  const duplicate103 = (extra: Record<string, unknown> = {}, code = '103') => ack([], { ack_outcome: 'negative', source_operation_id: 'ediel_duplicate103:reception',
    raw_payload: wire('APERAK', ['BGM+++27', 'RFF+ACW:SOURCE-D', 'NAD+FR+LEGAL_R:160:SVK+++++++SE', 'NAD+DO+LEGAL_S:160:SVK+++++++SE',
      'ERC+40::260', `FTX+AAO++${code}::260+Dubblett av meddelandet`, 'RFF+Z07:POINT-A', 'RFF+LI:LI-A', 'RFF+Z07:POINT-B', 'RFF+LI:LI-B'], true),
    validation_report: {}, ...extra })
  it('resolves a physical P27 sequence rejection that names only one object', () => {
    expect(completion([p27(['RFF+Z07:POINT-A', 'RFF+LI:LI-A'])])).toBe('resolved')
  })
  it('resolves a physical P27 header rejection without object references', () => {
    expect(completion([p27([])])).toBe('resolved')
  })
  it('does not accept a P27 rejection of another original document', () => {
    expect(completion([p27(['RFF+Z07:POINT-A', 'RFF+LI:LI-A'], {}, 'OTHER-D')])).toBeNull()
  })
  it.each([
    ['envelope sender', (raw: string) => raw.replace('TRANSPORT_R', 'OTHER')],
    ['legal sender', (raw: string) => raw.replace('NAD+FR+LEGAL_R', 'NAD+FR+OTHER')],
    ['legal receiver', (raw: string) => raw.replace('NAD+DO+LEGAL_S', 'NAD+DO+OTHER')],
  ])('does not accept a P27 rejection whose %s does not mirror the source', (_name, change) => {
    const reply = p27([]); reply.raw_payload = change(String(reply.raw_payload))
    expect(completion([reply])).toBeNull()
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
  it('does not let a duplicate-103 protocol reply complete the original when it is the only APERAK', () => {
    expect(completion([duplicate103()])).toBeNull()
  })
  it('does not let a duplicate-103 protocol reply cover unanswered sibling B', () => {
    expect(completion([ack([a]), duplicate103()])).toBeNull()
  })
  it.each([
    ['physical FTX 103 alone', { source_operation_id: null }, '103'],
    ['stored duplicate owner operation alone', {}, '40'],
  ] as const)('recognizes a duplicate-103 reply by its %s', (_name, extra, code) => {
    expect(completion([duplicate103(extra, code)])).toBeNull()
  })
  it('still resolves from the genuine own replies alongside a duplicate-103 reply', () => {
    expect(completion([duplicate103(), ack([a]), ack([b])])).toBe('resolved')
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
  it('keeps the real sweep expired when only a duplicate-103 reply and one sibling were sent', async () => {
    io.acks = [ack([a]), duplicate103()]
    expect(await checkAckDeadlines({ actorUserId: 'actor', companyId: 'tenant-a', now: '2026-10-13T12:31:00Z' }))
      .toEqual({ warning: 0, critical: 0, expired: 1, updated: 1 })
    expect(io.timer.status).toBe('expired')
  })
})

// The actual PRODAT runtime decision and APERAK renderer produce the replies.
describe('producer-built PRODAT replies', () => {
  const fixture = (parts: Parts[]) => guideOrderedFixtureRaw(parts, 'Z04')
    .replace("UNB+UNOC:3+S+R+260917:1200+I++23-DDQ-PRODAT'", "UNB+UNOC:3+S:ZZ+R:ZZ+260917:1200+I++23-DDQ-PRODAT++1++1'")
  const received = (raw: string) => ({ ...prodatSource(raw, 'Z04'), company_id: 'tenant-a' }) as EdielMessageRow
  const sent = (sourceMessage: EdielMessageRow, rawPayload: string | null | undefined, outcome: 'positive' | 'negative', extra: Record<string, unknown> = {}) => ({
    id: `reply-${Math.random()}`, company_id: 'tenant-a', environment: 'test', related_message_id: sourceMessage.id, direction: 'outbound',
    status: 'sent', message_sent_at: '2026-10-13T12:00:00Z', message_family: 'APERAK', ack_outcome: outcome, raw_payload: rawPayload,
    validation_report: {}, ...extra })
  const done = (sourceMessage: EdielMessageRow, acks: Record<string, unknown>[]) =>
    inboundAckTimerCompletion({ source: sourceMessage, timerType: 'aperak_due', acknowledgements: acks })
  const valid = () => { const parts = mixedZ04Parts(), second = parts.findIndex(part => part[0] === 'LIN' && part[1] === '2'); parts.splice(second + 1, 0, qty('20')); return parts }
  const negative = (sourceMessage: EdielMessageRow) => buildAperakDraft({ sourceMessage, outcome: 'negative',
    applicationErrors: resolveCanonicalRuntimeDecision(sourceMessage).responsePlan.find(item => item.family === 'APERAK')!.applicationErrors }).rawPayload ?? ''
  /** Same bytes as lib/ediel/inbound/duplicateResponses.ts, in the real renderer's envelope. */
  const duplicateOf = (sourceMessage: EdielMessageRow) => {
    const envelope = String(buildAperakDraft({ sourceMessage, outcome: 'positive' }).rawPayload), wire = tokenizeEdifact(sourceMessage.raw_payload)
    const refs = [...new Set(wire.segments.flatMap(segment => segment.tag === 'LIN' ? [`RFF+Z07:${segment.raw.split('+')[3].split(':')[0]}`]
      : segment.tag === 'RFF' && segment.raw.startsWith('RFF+LI:') ? [segment.raw] : []))]
    const segments = envelope.split("'"), unh = segments.findIndex(part => part.startsWith('UNH+')), erc = segments.findIndex(part => part.startsWith('ERC+')),
      unt = segments.findIndex(part => part.startsWith('UNT+'))
    const body = [...segments.slice(0, erc), 'ERC+40::260', 'FTX+AAO++103::260+Dubblett av meddelandet', ...refs].map(part => part === 'BGM+++34' ? 'BGM+++27' : part)
    return [...body, `UNT+${body.length - unh + 1}+${segments[unt].split('+')[2]}`, ...segments.slice(unt + 1)].join("'")
  }

  it('resolves the actual P27 LIN-sequence (314) rejection that names only the defective object', () => {
    const parts = mixedZ04Parts(), second = parts.findIndex(part => part[0] === 'LIN' && part[1] === '2')
    parts[second] = [...parts[second].slice(0, 1), '1', ...parts[second].slice(2)]
    const sourceMessage = received(fixture(parts)), reply = negative(sourceMessage)
    expect(reply).toContain('BGM+++27'); expect(reply).toContain('FTX+AAO++314::260'); expect(reply).not.toContain('735123456789012352')
    expect(done(sourceMessage, [sent(sourceMessage, reply, 'negative')])).toBe('resolved')
  })
  it('resolves the actual P27 header (202) rejection', () => {
    const sourceMessage = received(fixture(valid()).replace('BGM+Z04+D+9+AB', 'BGM++D+9+AB')), reply = negative(sourceMessage)
    expect(reply).toContain('BGM+++27'); expect(reply).toContain('FTX+AAO++202::260')
    expect(done(sourceMessage, [sent(sourceMessage, reply, 'negative')])).toBe('resolved')
  })
  it('resolves from the actual complete P34 reply', () => {
    const sourceMessage = received(fixture(valid()))
    expect(done(sourceMessage, [sent(sourceMessage, buildAperakDraft({ sourceMessage, outcome: 'positive' }).rawPayload, 'positive')])).toBe('resolved')
  })
  it('never completes from a duplicate-103 reply, with or without the stored owner marker', () => {
    const sourceMessage = received(fixture(valid())), dup = duplicateOf(sourceMessage)
    expect(dup).toContain('BGM+++27'); expect(dup).toContain('FTX+AAO++103::260')
    for (const marker of [{ source_operation_id: 'ediel_duplicate103:reception' }, {}]) {
      expect(done(sourceMessage, [sent(sourceMessage, dup, 'negative', marker)])).toBeNull()
    }
    // The genuine complete reply still completes; the duplicate neither adds nor blocks.
    expect(done(sourceMessage, [sent(sourceMessage, dup, 'negative'), sent(sourceMessage, buildAperakDraft({ sourceMessage, outcome: 'positive' }).rawPayload, 'positive')])).toBe('resolved')
  })
})
