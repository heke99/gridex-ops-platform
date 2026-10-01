import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { validateUnsmGrammar } from '@/lib/ediel/core/unsmGrammar'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'

const input = (code: 'E66' | 'E73', payload: Record<string, unknown>) => ({
  code, environment: 'test' as const, senderEdielId: '11111', receiverEdielId: '22222',
  applicationReference: '23-DDQ-E66-S', externalReference: 'DOC-OWN', transactionReference: 'TX-OWN',
  payload: { legalSenderEdielId: '33333', legalReceiverEdielId: '44444', meterPointId: '735999100001686670', gridAreaId: 'TES',
    periodStart: '2026-09-30T00:00:00+01:00', periodEnd: '2026-10-01T00:00:00+01:00',
    registrationTime: '2026-10-01T10:00:00+01:00', siteType: 'Consumption', ...payload },
})

describe('actual UTILTS outbound producer full selected 02B grammar', () => {
  it('places transaction FTX before SG7/SG8 instead of after its own QTY observation', async () => {
    const draft = await buildUtiltsOutboundDraft(input('E66', { quantity: 5, readingType: 'E12' }))
    const raw = draft.rawPayload!
    const proof = validateUnsmGrammar(raw)
    expect(proof.qualification).toBe('qualified')
    expect(proof.sources[0].key).toBe('UTILTS:D:02B:UN')
    expect(proof.syntaxOk, JSON.stringify(proof.issues)).toBe(true)
    expect(raw.indexOf('FTX+ZZZ')).toBeLessThan(raw.indexOf('CCI+'))
    expect(raw.indexOf('FTX+ZZZ')).toBeLessThan(raw.indexOf('SEQ++1'))
    expect(raw).toContain("SEQ++1'QTY+136:5'")
    expect(raw).toContain("NAD+MS+33333::260'NAD+MR+44444::260'")
    expect(raw).not.toContain('NAD+MS+11111')
    expect(preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues
      .some(issue => issue.code.startsWith('UNSM_'))).toBe(false)
  })

  it.each(['quantity', 'valueKwh', 'requestedQuantity'])('refuses %s on E73 because the selected national Request table contains no observation quantity', async field => {
    // Source U §3.7.3 pp62–65 defines request fields through513 and no QTY.
    // Adding SEQ would make a syntactically valid observation with invented
    // request semantics; the producer must reject the unsupported input.
    await expect(buildUtiltsOutboundDraft(input('E73', { [field]: 5 })))
      .rejects.toThrow('utilts_request_quantity_not_source_supported')
  })

  it('creates a request without fabricated SEQ/QTY and still selects its own full directory', async () => {
    const draft = await buildUtiltsOutboundDraft(input('E73', {}))
    expect(draft.rawPayload).not.toMatch(/'(SEQ|QTY)\+/)
    expect(validateUnsmGrammar(draft.rawPayload!).syntaxOk).toBe(true)
  })

  it('holds missing legal source parties despite valid transport identities', async () => {
    await expect(buildUtiltsOutboundDraft(input('E66', { legalSenderEdielId: null, quantity: 5 })))
      .rejects.toThrow('utilts_legal_parties_source_required')
  })
})
