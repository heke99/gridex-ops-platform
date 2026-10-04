// masterplan: ENV-08, AT-ENV-08
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))

afterEach(() => vi.useRealTimers())
const input = (periodStart = '2026-07-01T00:00', periodEnd = '2026-07-02T00:00') => ({
  code: 'E66' as const, senderEdielId: '12345', receiverEdielId: '54321',
  applicationReference: '23-DDQ-E66-T', externalReference: 'DOC', transactionReference: 'TX',
  payload: { legalSenderEdielId: '12345', legalReceiverEdielId: '54321', meterPointId: '735999260731000007',
    periodStart, periodEnd, registrationTime: '2026-07-02T00:00', quantity: 5, resolution: '15', unit: 'KWH' },
})

describe('ENV08 physical outbound payload and local UNB clocks', () => {
  it.each([
    ['2026-07-01T10:15:59Z', '202607011115', '260701', '1215'],
    ['2026-01-01T10:15:59Z', '202601011115', '260101', '1115'],
    ['2026-03-29T01:30:00Z', '202603290230', '260329', '0330'],
    ['2026-10-25T01:30:00Z', '202610250230', '261025', '0230'],
  ])('converts the creation instant %s to fixed CET while UNB uses Swedish local time', async (instant, documentMinute, localDate, localMinute) => {
    vi.useFakeTimers().setSystemTime(new Date(instant))
    const draft = await buildUtiltsOutboundDraft(input())
    const wire = tokenizeEdifact(draft.rawPayload)
    const dates = wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una))
    expect(dates).toContainEqual(['137', documentMinute, '203'])
    expect(dates).toContainEqual(['735', '+0100', '406'])
    expect(segmentComposite(wire.segments.find(segment => segment.tag === 'UNB'), 4, wire.una)).toEqual([localDate, localMinute])
  })

  it.each([
    ['2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z', '202607010100202607020100'],
    ['2026-07-01T00:00:00+02:00', '2026-07-02T00:00:00+02:00', '202606302300202607012300'],
    ['2026-07-01T00:00', '2026-07-02T00:00', '202607010000202607020000'],
    ['2026-07-01', '2026-07-02', '202607010000202607020000'],
  ])('converts explicit instant periods and preserves market wall dates: %s', async (start, end, expected) => {
    const draft = await buildUtiltsOutboundDraft(input(start, end))
    const wire = tokenizeEdifact(draft.rawPayload)
    expect(wire.segments.filter(segment => segment.tag === 'DTM').map(segment => segmentComposite(segment, 1, wire.una)))
      .toContainEqual(['324', expected, '719'])
  })
})
