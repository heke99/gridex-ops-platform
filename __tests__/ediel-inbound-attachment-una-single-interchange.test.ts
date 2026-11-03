// Regression 20261029-3f1a8ab1/claude-track3/004: an EDIFACT attachment copied into
// raw_edifact_payload must not be concatenated with itself into two interchanges.
import {beforeEach, describe, expect, it, vi} from 'vitest'
const io = vi.hoisted(() => ({row: {} as Record<string, unknown>, attachments: [] as Record<string, unknown>[],
  calls: [] as Array<{args: Record<string, unknown>; result?: unknown; error?: string}>, status: vi.fn(), task: vi.fn()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {
  rpc: async () => ({data: null, error: null}),
  from: (table: string) => {
    const result = () => ({data: table === 'inbound_email_messages' ? io.row : io.attachments, error: null})
    return {select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn(() => Promise.resolve(result())), maybeSingle: vi.fn(() => Promise.resolve(result()))}
  }}}))
vi.mock('@/lib/inbound-mail/edielEmailParser', async (orig) => {
  const actual = await orig<typeof import('@/lib/inbound-mail/edielEmailParser')>()
  return {...actual, parseInboundEmailContent: (args: Parameters<typeof actual.parseInboundEmailContent>[0]) => {
    const call: (typeof io.calls)[number] = {args: args as Record<string, unknown>}
    io.calls.push(call)
    try { call.result = actual.parseInboundEmailContent(args) } catch (e) { call.error = (e as Error).message }
    return null // stop after parsing; downstream flow is out of scope
  }}
})
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({updateInboundEmailProcessingStatus: io.status}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({createInboundMailTask: io.task}))
vi.mock('@/lib/inbound-mail/dsnTransportCandidates', () => ({projectDsnTransportCandidates: vi.fn().mockResolvedValue([])}))
import {processInboundEmailMessage} from '@/lib/inbound-mail/edielInboundProcessor'
import {splitMimeParts} from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const payload = (una: boolean, ref = 'FXREF1') => `${una ? "UNA:+.? '" : ''}UNB+UNOC:3+70007:14+16700:14+261029:1200+${ref}'UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+FXDOC1+9'UNT+3+1'UNZ+1+${ref}'`
const head = 'From: dso@t3.sim.invalid\r\nTo: ediel@t3.sim.invalid\r\nSubject: fx\r\nMIME-Version: 1.0\r\n'
function mime(kind: 'edifact-b64' | 'text-att' | 'inline', una: boolean) {
  const p = payload(una)
  if (kind === 'inline') return head + 'Content-Type: text/plain; charset=utf-8\r\n\r\n' + p + '\r\n'
  const part = kind === 'edifact-b64'
    ? 'Content-Type: application/EDIFACT; name="fx.edi"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="fx.edi"\r\n\r\n' + Buffer.from(p).toString('base64') + '\r\n'
    : 'Content-Type: text/plain; charset=utf-8; name="fx.txt"\r\nContent-Disposition: attachment; filename="fx.txt"\r\n\r\n' + p + '\r\n'
  return head + 'Content-Type: multipart/mixed; boundary="B1"\r\n\r\n--B1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSe bilaga.\r\n--B1\r\n' + part + '--B1--\r\n'
}
function load(raw: string) {
  const s = splitMimeParts(Buffer.from(raw))
  io.row = {company_id: '10000000-0000-4000-8000-000000000001', environment: 'test', raw_email: raw,
    body_text: s.bodyText, raw_edifact_payload: s.rawEdifactPayload}
  io.attachments = s.attachments.map((a, i) => ({id: `att${i}`, raw_text: a.rawText, filename: a.filename}))
}
const unb = (v: unknown) => (String(v ?? '').match(/UNB\+/g) ?? []).length
const run = () => processInboundEmailMessage({inboundEmailMessageId: 'mail1', actorUserId: '30000000-0000-4000-8000-000000000001'})
beforeEach(() => { vi.clearAllMocks(); io.calls.length = 0 })

describe('single physical interchange is parsed once (finding 004)', () => {
  for (const [kind, una] of [['edifact-b64', true], ['edifact-b64', false], ['text-att', true], ['text-att', false], ['inline', true], ['inline', false]] as const) {
    it(`${kind} una=${una}: exactly one UNB is parsed and parsing does not throw`, async () => {
      load(mime(kind, una))
      await run()
      expect(io.calls).toHaveLength(1)
      const call = io.calls[0]
      expect(call.error).toBeUndefined()
      expect(unb(call.args.attachmentText) + (kind === 'inline' && !call.args.attachmentText ? 1 : 0)).toBe(1)
      const result = call.result as {messageCode?: string; interchangeReference?: string; rawPayload: string}
      expect(result).toMatchObject({messageCode: 'E66', interchangeReference: 'FXREF1'})
      expect(unb(result.rawPayload)).toBe(1)
    })
  }
  it('two genuinely different interchanges are not silently collapsed', async () => {
    load(mime('edifact-b64', false))
    io.row.raw_edifact_payload = payload(false, 'OTHERREF')
    await run()
    const text = String(io.calls[0].args.attachmentText)
    expect(unb(text)).toBe(2)
    expect(text).toContain('OTHERREF'); expect(text).toContain('FXREF1')
  })
})

import {segmentUntrimmedRaw, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
describe('released trailing space before a segment terminator (finding 004, track4/2 variant)', () => {
  const ic = "UNA:+.? 'UNB+UNOC:3+70007:14+16700:14+261029:1200+FXREF1'\r\nFTX+AAA+++ABC? '\r\nUNZ+1+FXREF1'\r\n"
  it('keeps the released space as data and does not throw', () => {
    const ftx = tokenizeEdifact(ic).segments.find(s => s.tag === 'FTX')!
    expect(ftx.raw).toBe('FTX+AAA+++ABC? ')
    expect(ftx.elements[4]).toBe('ABC ')
    expect(segmentUntrimmedRaw(ftx)).toBe('FTX+AAA+++ABC? ')
  })
  it('still trims unreleased whitespace and line breaks around segments', () => {
    const segs = tokenizeEdifact("  UNB+UNOC:3+A+B+261029:1200+R1'\n  FTX+AAA+++X  '\r\nUNZ+1+R1'  \n").segments
    expect(segs.map(s => s.raw)).toEqual(['UNB+UNOC:3+A+B+261029:1200+R1', 'FTX+AAA+++X', 'UNZ+1+R1'])
    expect(segmentUntrimmedRaw(segs[1])).toBe('  FTX+AAA+++X  ')
  })
  it('a double release (escaped release char) followed by space is still trimmed', () => {
    const ftx = tokenizeEdifact("UNB+UNOC:3+A+B+261029:1200+R1'FTX+AAA+++X??  'UNZ+1+R1'").segments[1]
    expect(ftx.raw).toBe('FTX+AAA+++X??'); expect(ftx.elements[4]).toBe('X?')
  })
})

describe('UNA service advice that is not at offset 0 is never released data (finding 004 follow-up)', () => {
  const tail = "UNB+UNOC:3+A+B+261029:1200+R1'FTX+AAA+++ABC? 'UNZ+1+R1'"
  it.each(['unexpected-prefix', '  junk\r\n', "UNB+UNOC:3+A+B+261029:1200+R0'UNZ+0+R0'"])('rejects %j before UNA', prefix => {
    expect(() => tokenizeEdifact(`${prefix}UNA:+.? '${tail}`)).toThrow('edifact_dangling_release_character')
  })
  it('a leading UNA still allows the released trailing space', () => {
    expect(tokenizeEdifact(`UNA:+.? '${tail}`).segments.find(s => s.tag === 'FTX')!.elements[4]).toBe('ABC ')
  })
})
