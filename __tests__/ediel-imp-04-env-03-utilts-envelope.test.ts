// masterplan: IMP-04, AT-IMP-04, ENV-03, AT-ENV-03
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

const input = (extra: Record<string, unknown> = {}) => ({
  code: 'E66' as const, environment: 'test' as const, senderEdielId: '11111', receiverEdielId: '22222',
  applicationReference: '23-DDQ-E66-S', externalReference: 'DOC-OWN', transactionReference: 'TX-OWN',
  payload: { legalSenderEdielId: '33333', legalReceiverEdielId: '44444', meterPointId: '735999100001686670', gridAreaId: 'TES',
    periodStart: '2026-09-30T00:00:00+01:00', periodEnd: '2026-10-01T00:00:00+01:00',
    registrationTime: '2026-10-01T10:00:00+01:00', siteType: 'Consumption', quantity: 5, readingType: 'E12' },
  ...extra,
})
const unbParties = (raw: string) => {
  const t = tokenizeEdifact(raw), unb = t.segments.find(s => s.tag === 'UNB')
  return { sender: segmentComposite(unb, 2, t.una), receiver: segmentComposite(unb, 3, t.una) }
}

describe('IMP-04: UTILTS does not use an invented sub-address', () => {
  it('on_failure/prohibited: an empty registered sub-address stays empty; no UTILTS/PRODAT/SCH/GRIDEX is invented', async () => {
    for (const empty of [{}, { senderSubAddress: null, receiverSubAddress: null }]) {
      const raw = (await buildUtiltsOutboundDraft(input(empty))).rawPayload!
      const { sender, receiver } = unbParties(raw)
      expect(sender[0]).toBe('11111'); expect(receiver[0]).toBe('22222')
      expect(sender[2] ?? '').toBe(''); expect(receiver[2] ?? '').toBe('')
      for (const invented of ['UTILTS', 'PRODAT', 'SCH', 'GRIDEX']) expect(raw).not.toMatch(new RegExp(`UNB\\+[^']*:${invented}[+']`))
    }
  })
  it('on_pass: an exactly registered value is preserved unchanged', async () => {
    const raw = (await buildUtiltsOutboundDraft(input({ senderSubAddress: 'GRIDEX', receiverSubAddress: null }))).rawPayload!
    expect(unbParties(raw).sender[2]).toBe('GRIDEX')
    expect(unbParties(raw).receiver[2] ?? '').toBe('')
  })
})

describe('ENV-03: counters are computed from the actually serialised structure', () => {
  const counts = (raw: string) => {
    const t = tokenizeEdifact(raw), seg = t.segments
    const unh = seg.findIndex(s => s.tag === 'UNH'), unt = seg.findIndex(s => s.tag === 'UNT')
    const unbRef = segmentComposite(seg.find(s => s.tag === 'UNB'), 5, t.una)[0], unz = seg.find(s => s.tag === 'UNZ')
    return { declaredUnt: Number(seg[unt].elements[1]), actual: unt - unh + 1, untRef: seg[unt].elements[2], unhRef: seg[unh].elements[1],
      unzCount: Number(unz?.elements[1]), messages: seg.filter(s => s.tag === 'UNH').length, unzRef: segmentComposite(unz, 2, t.una)[0], unbRef }
  }
  it('on_pass: the UTILTS producer UNT includes UNH and UNT and UNZ count/ref match UNB', async () => {
    const c = counts((await buildUtiltsOutboundDraft(input())).rawPayload!)
    expect(c.declaredUnt).toBe(c.actual); expect(c.untRef).toBe(c.unhRef)
    expect(c.unzCount).toBe(c.messages); expect(c.unzRef).toBe(c.unbRef)
  })
  it('on_pass: the codec recomputes counters for every message and segment count change', () => {
    for (const extra of [[], ['FTX+AAO+++A'], ['FTX+AAO+++A', 'FTX+AAO+++B', 'FTX+AAO+++C']]) {
      const raw = EdifactEnvelopeCodec.encode({ sender: '11111', receiver: '22222', interchangeReference: 'I1', applicationReference: '23-DDQ-E66-S', environment: 'test', acknowledgementRequest: true,
        messages: [{ messageReference: 'M1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ['BGM+E66+DOC+9', ...extra] },
          { messageReference: 'M2', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ['BGM+E66+DOC2+9'] }] })
      const t = tokenizeEdifact(raw)
      const unts = t.segments.filter(s => s.tag === 'UNT').map(s => Number(s.elements[1]))
      expect(unts).toEqual([2 + 1 + extra.length, 3])
      expect(Number(t.segments.find(s => s.tag === 'UNZ')?.elements[1])).toBe(2)
    }
  })
  it('on_failure: duplicate technical message references are refused', () => {
    expect(() => EdifactEnvelopeCodec.encode({ sender: '11111', receiver: '22222', interchangeReference: 'I1', environment: 'test', acknowledgementRequest: true,
      messages: [{ messageReference: 'M1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ['BGM+E66+DOC+9'] }, { messageReference: 'M1', messageTypeToken: 'UTILTS:D:02B:UN:E5SE5A', businessSegments: ['BGM+E66+DOC2+9'] }] }))
      .toThrow('edifact_message_reference_duplicate')
  })
})

import { buildProdatInboundRaw, buildUtiltsInboundRaw } from '@/lib/ediel/testing/selftest'
import { sampleParseTests } from '@/lib/inbound-mail/smokeTests'
const untMatchesStructure = (raw: string) => {
  const seg = tokenizeEdifact(raw).segments, unh = seg.findIndex(s => s.tag === 'UNH'), unt = seg.findIndex(s => s.tag === 'UNT')
  return { declared: Number(seg[unt].elements[1]), actual: unt - unh + 1, unzCount: Number(seg.find(s => s.tag === 'UNZ')?.elements[1]), messages: seg.filter(s => s.tag === 'UNH').length }
}
describe('ENV-03: simulated and smoke-test interchanges carry no stale handwritten counters', () => {
  const base = { senderEdielId: '11111', receiverEdielId: '22222', externalReference: 'X1', transactionReference: 'T1', meterPointId: '735999100001686670' }
  it.each([
    ['PRODAT minimal', () => buildProdatInboundRaw({ ...base, code: 'Z04', customerName: 'Kund' })],
    ['PRODAT with start', () => buildProdatInboundRaw({ ...base, code: 'Z04', customerName: 'Kund', requestedStartDate: '2026-11-01' })],
    ['PRODAT with address', () => buildProdatInboundRaw({ ...base, code: 'Z04', customerName: 'Kund', city: 'Ort' })],
    ['PRODAT with start and address', () => buildProdatInboundRaw({ ...base, code: 'Z04', customerName: 'Kund', requestedStartDate: '2026-11-01', street: 'Gata 1' })],
    ['UTILTS minimal', () => buildUtiltsInboundRaw({ ...base, code: 'E66', periodStart: '2026-10-01', periodEnd: '2026-10-02' })],
    ['UTILTS quantity only', () => buildUtiltsInboundRaw({ ...base, code: 'E66', periodStart: '2026-10-01', periodEnd: '2026-10-02', quantity: 5 })],
    ['UTILTS reading type only', () => buildUtiltsInboundRaw({ ...base, code: 'E66', periodStart: '2026-10-01', periodEnd: '2026-10-02', readingType: 'E12' })],
    ['UTILTS both', () => buildUtiltsInboundRaw({ ...base, code: 'E66', periodStart: '2026-10-01', periodEnd: '2026-10-02', quantity: 5, readingType: 'E12' })],
  ])('%s: UNT equals the serialised UNH..UNT count', (_, build) => {
    const c = untMatchesStructure(build())
    expect(c.declared).toBe(c.actual); expect(c.unzCount).toBe(c.messages)
  })
  it('every inbound smoke-test sample declares UNT from its actual structure', () => {
    const results = sampleParseTests()
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      const parsed = (result.details as { parsed?: { rawPayload?: string } } | undefined)?.parsed
      expect(parsed?.rawPayload, result.name).toBeTruthy()
      const c = untMatchesStructure(parsed!.rawPayload!)
      expect(c.declared, result.name).toBe(c.actual)
    }
  })
})
