import { describe, expect, it, vi } from 'vitest'
import { s01L359AggregateWire } from '../scripts/helpers/utiltsS01AggregateFixture'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn(() => { throw Error('unexpected_database_io') }) } }))

// Independent oracle: actual Swedish U5 b76a61b9… pp27,53–57,61,81 and
// CURRENT TSP20260928.xls sha53034f2fd3de416a84f755b454fc72378930126446909cee5eae968111db816b,
// Tidsserieprodukter!row21 (L359), OT!row85, LOD o BAP!rows10/58.
// These fixtures represent a synthetic eSett issuer/BRP receiver. They grant
// no real legal/market authority; native reception still qualifies its source.
const original = () => energyHandoffMessage('2026-10-15', '11111111-1111-4111-8111-111111111111')
const transaction = { transactionId: 'L359-OWN', latestUpdateDate: '202607010040', quantity: '500' }
const build = () => s01L359AggregateWire(original().raw_payload!, [transaction])
const source = (raw: string) => ({ ...original(), raw_payload: raw, message_code: 'S01', application_reference: '23-DDK-S01-S', customer_id: null, site_id: null, metering_point_id: null, grid_owner_id: null })
const ownSegments = () => { const t = tokenizeEdifact(build()); return { t, own: t.segments.slice(t.segments.findIndex(s => s.tag === 'IDE')) } }

describe('current-source L359 aggregate native fixture', () => {
  it('parses a source-shaped S01 envelope with the original parties', () => {
    const raw = build(), parsed = parseInboundEmailContent({ attachmentText: raw })
    expect(parsed).toMatchObject({ messageFamily: 'UTILTS', messageCode: 'S01', senderEdielId: '91100', receiverEdielId: '21660', applicationReference: '23-DDK-S01-S' })
    expect(raw).toContain("MKS+23+E03::260'")
    expect(raw).toContain("NAD+DDK'")
  })

  it('retains ALL FIVE current catalogue PIA components in their actual order', () => {
    const { t, own } = ownSegments(), pia = own.find(s => s.tag === 'PIA')
    expect(pia).toBeDefined()
    expect([2, 3, 4, 5, 6].map(n => segmentComposite(pia, n, t.una))).toEqual([
      ['Z04', 'PC', 'SVK', '260'], ['U46', 'PT', 'SVK', '260'], ['Z02', 'OT', 'SVK', '260'],
      ['Z58', 'LOD', 'SVK', '260'], ['Z05', 'BAP', 'SVK', '260'],
    ])
  })

  it('carries one area-only monthly energy series and own SG5 field532', () => {
    const raw = build()
    expect(raw).toContain("IDE+24+L359-OWN'")
    expect(raw).toContain("LOC+239+TES:SVK:260'")
    expect(raw).toContain("DTM+324:202606010000202607010000:719'")
    expect(raw).toContain("DTM+354:1:802'")
    expect(raw).toContain("DTM+368:202607010040:203'")
    expect(raw).toContain("STS+7++E43::260'")
    expect(raw).toContain("CCI+++E02::260'\nCAV+E01::260'")
    expect(raw).toContain("QTY+136:500'")
  })

  it('does not borrow point, object, individual method, TN or observation dates from E66', () => {
    const raw = build()
    for (const forbidden of ['LOC+172', 'LOC+175', 'CCI+++E12', 'CAV+E17', 'RFF+TN', 'DTM+597', 'NAD+DDQ']) expect(raw).not.toContain(forbidden)
  })

  it('recounts UNT from the actual one-message physical segment sequence', () => {
    const t = tokenizeEdifact(build()), unh = t.segments.findIndex(s => s.tag === 'UNH'), unt = t.segments.findIndex(s => s.tag === 'UNT')
    expect(Number(segmentComposite(t.segments[unt], 1, t.una)[0])).toBe(unt - unh + 1)
  })

  it('keeps two own physical IDEs, quantities and version times separate', () => {
    const raw = s01L359AggregateWire(original().raw_payload!, [transaction, { transactionId: 'L359-SIBLING', latestUpdateDate: '202607010020', quantity: '7' }])
    const t = tokenizeEdifact(raw)
    expect(t.segments.filter(s => s.tag === 'IDE').map(s => segmentComposite(s, 2, t.una)[0])).toEqual(['L359-OWN', 'L359-SIBLING'])
    expect(t.segments.filter(s => s.tag === 'QTY').map(s => segmentComposite(s, 1, t.una)[1])).toEqual(['500', '7'])
    expect(t.segments.filter(s => s.tag === 'DTM' && segmentComposite(s, 1, t.una)[0] === '368').map(s => segmentComposite(s, 1, t.una)[1])).toEqual(['202607010040', '202607010020'])
  })

  it('passes the actual selected Swedish U5 parser/runtime guide boundary', () => {
    const message = source(build()), policy = resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'S01', direction: 'inbound', referenceDate: '2026-10-15', applicationReference: '23-DDK-S01-S' })
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
    expect(policy.guide.guideRevision).toBe('25-A-5')
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.facts.transactions[0]).toMatchObject({ transactionId: 'L359-OWN', deliveryPeriodRaw: '202606010000202607010000', latestUpdateTime: '2026-07-01T00:40:00', registrationTime: null })
  })

  it('keeps a deliberately added forbidden209 as a distinct negative fixture, without modifying its clean sibling', () => {
    const clean = build(), negative = clean.replace("IDE+24+L359-OWN'", "IDE+24+L359-OWN'\nLOC+172+735999260731000007::9'")
    expect(tokenizeEdifact(clean).segments.some(s => s.tag === 'LOC' && segmentComposite(s, 1)[0] === '172')).toBe(false)
    expect(tokenizeEdifact(negative).segments.filter(s => s.tag === 'LOC' && segmentComposite(s, 1)[0] === '172')).toHaveLength(1)
    // Rejection/negative ACK and no SQL/economic effects are asserted by the
    // actual S01/native entrypoint tests, not invented from fixture metadata.
  })
})
