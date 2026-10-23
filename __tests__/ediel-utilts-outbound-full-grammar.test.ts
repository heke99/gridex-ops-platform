import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: vi.fn(async () => 'E5SE5A') }))
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'
import { validateUnsmGrammar } from '@/lib/ediel/core/unsmGrammar'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

const input = (code: 'E66' | 'E73', payload: Record<string, unknown>) => ({
  code, environment: 'test' as const, senderEdielId: '11111', receiverEdielId: '22222',
  applicationReference: '23-DDQ-E66-S', externalReference: 'DOC-OWN', transactionReference: 'TX-OWN',
  payload: { legalSenderEdielId: '33333', legalReceiverEdielId: '44444', meterPointId: '735999100001686670', gridAreaId: 'TES',
    periodStart: '2026-09-30T00:00:00+01:00', periodEnd: '2026-10-01T00:00:00+01:00',
    registrationTime: '2026-10-01T10:00:00+01:00', siteType: 'Consumption', ...payload },
})

describe('actual UTILTS outbound producer full selected 02B grammar', () => {
  it.each(['E66', 'E73'] as const)('writes the source-required active-energy product in its own %s SG5 before dates and observations', async code => {
    // Swedish U5 p80: LIN is used for both E66 and E73. Its C212 owns
    // 7140=8716867000030 (active energy), 3055=9 (GS1); 7143/1131 are unused.
    const draft = await buildUtiltsOutboundDraft(input(code, code === 'E66' ? { quantity: 5 } : {}))
    const raw = draft.rawPayload!, wire = tokenizeEdifact(raw)
    const products = wire.segments.filter(segment => segment.tag === 'LIN')
    expect(products).toHaveLength(1)
    expect(segmentComposite(products[0], 3, wire.una)).toEqual(['8716867000030', '', '', '9'])
    const ide = wire.segments.find(segment => segment.tag === 'IDE')!
    const locations = wire.segments.filter(segment => segment.tag === 'LOC')
    const delivery = wire.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, wire.una)[0] === '324')!
    expect(products[0].index).toBeGreaterThan(ide.index)
    expect(locations.every(segment => segment.index < products[0].index)).toBe(true)
    expect(products[0].index).toBeLessThan(delivery.index)
    expect(validateUnsmGrammar(raw)).toMatchObject({ qualification: 'qualified', syntaxOk: true })
    expect(preflightEdielPayload({ rawPayload: raw, messageStandard: 'edifact', mode: 'send' }).issues
      .some(issue => issue.code === 'UTILTS_FIELD_506_MISSING')).toBe(false)
    if (code === 'E73') expect(raw).not.toMatch(/'(SEQ|QTY|MEA)\+/)
  })

  it.each(['KWH', 'MWH', 'GWH'])('keeps the declared %s active-energy unit with the explicit source product', async unit => {
    // U5 p85 lists these energy units. WH/WHR is not in that national list.
    const draft = await buildUtiltsOutboundDraft(input('E66', { quantity: 5, unit, productId: '8716867000030' }))
    expect(draft.rawPayload).toContain("LIN+++8716867000030:::9'")
    expect(draft.rawPayload).toContain(`MEA+AAZ++${unit}'`)
    expect(draft.rawPayload).toContain("QTY+136:5'")
  })

  it.each(['E66', 'E73'] as const)('%s refuses an explicit power, amount, unknown or malformed product instead of relabelling it as energy', async code => {
    for (const productId of ['8716867000016', '7331507000020', 'not-a-product', 8716867000030]) {
      await expect(buildUtiltsOutboundDraft(input(code, { productId, ...(code === 'E66' ? { quantity: 5 } : {}) })))
        .rejects.toThrow('utilts_outbound_active_energy_product_required')
    }
  })

  it.each(['E66', 'E73'] as const)('%s refuses unsupported energy spelling, power and reactive-energy units', async code => {
    for (const unit of ['WH', 'WHR', 'KWT', 'K3']) {
      await expect(buildUtiltsOutboundDraft(input(code, { unit, ...(code === 'E66' ? { quantity: 5 } : {}) })))
        .rejects.toThrow('utilts_outbound_active_energy_unit_required')
    }
  })

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
    expect(raw).toContain("NAD+MS+33333:SVK:260'NAD+MR+44444:SVK:260'")
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
