import { describe, expect, it } from 'vitest'
import { normalizeManualFacilityFacts } from '@/lib/inbound-mail/manualFacilityFacts'

describe('source-bound network facility facts', () => {
  it('keeps omitted optional facts optional for an otherwise valid facility response', () => {
    expect(normalizeManualFacilityFacts({ extracted: { facility_id: '735999100000000001' }, authoredText: 'Anläggnings-ID: 735999100000000001' })).toEqual({ ok: true, reasons: [], facts: {} })
  })

  it.each([
    ['annual_consumption', '12 500 kWh', 'För er kund gäller följande. Årsenergin är 12 500 kWh.', { annualConsumptionKwh: 12500 }],
    ['current_supplier', 'E.ON Energilösningar AB', 'För er kund är nuvarande elhandelsföretag E.ON Energilösningar AB. Mätmetod: Tim.', { currentSupplierName: 'E.ON Energilösningar AB', meteringMethod: 'Tim' }],
    ['metering_method', 'Tim', 'Här följer uppgifterna. Mätmetod är Tim.', { meteringMethod: 'Tim' }],
    ['reporting_frequency', 'timvis', 'Mätvärdena rapporteras timvis.', { reportingFrequency: 'timvis', readingFrequency: 'hourly' }],
  ])('normalizes an explicit prose %s without requiring a whole-line label', (source, raw, authoredText, expected) => {
    const result = normalizeManualFacilityFacts({ extracted: { [source]: raw }, authoredText })
    expect(result).toEqual({ ok: true, reasons: [], facts: expected })
  })

  it('retains conflicting inflected energy values as a blocking source conflict', () => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: '12 500 kWh' }, authoredText: 'Årsenergin är 12 500 kWh. Årsförbrukningen är 15 000 kWh.' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_conflicting_values')
    expect(result.facts.annualConsumptionKwh).toBeUndefined()
  })

  it.each(['Årsenergin är -12 500 kWh.', 'Årsenergin är 12 500 kW.', 'Är årsenergin 12 500 kWh?'])('does not promote a negative, wrong unit or question in prose: %s', authoredText => {
    const result = normalizeManualFacilityFacts({ extracted: {}, authoredText })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_invalid')
    expect(result.facts.annualConsumptionKwh).toBeUndefined()
  })

  it.each([
    ['current_supplier', 'E.ON', 'Nuvarande leverantör är E.ON; eller Vattenfall.', 'current_supplier_source_mismatch'],
    ['annual_consumption', '12 500 kWh', 'Årsenergin är 12 500 kWh. Med förbehåll för korrigering.', 'annual_consumption_source_mismatch'],
  ])('does not discard an unrecognized continuation after a prose %s', (source, raw, authoredText, reason) => {
    const result = normalizeManualFacilityFacts({ extracted: { [source]: raw }, authoredText })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain(reason)
  })

  it.each([
    ['12 500 kWh', 12500],
    ['12\u00a0500 kWh', 12500],
    ['12\u202f500,75 kWh', 12500.75],
    ['12500,5 kWh', 12500.5],
    ['12,5 MWh', 12500],
    ['1 250,75 MWh', 1250750],
    ['12500 kWh/år', 12500],
    ['0 kWh', 0],
  ])('normalizes annual energy %s to %s kWh', (raw, expected) => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: raw }, authoredText: `Årsenergi: ${raw}` })
    expect(result).toEqual({ ok: true, reasons: [], facts: { annualConsumptionKwh: expected } })
  })

  it.each(['12500', '-12500 kWh', 'Infinity kWh', '12 500 kW', '10 000–12 000 kWh', '10000-12000 kWh', '12.500 kWh', '1 25 kWh', '1e8 kWh', '999999999999999999999 MWh', 'ca 12 500 kWh'])('requires review for malformed or ambiguous annual energy %s', (raw) => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: raw }, authoredText: `Årsenergi: ${raw}` })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_invalid')
    expect(result.facts.annualConsumptionKwh).toBeUndefined()
  })

  it('does not accept a value that differs from the labeled source line', () => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: '12000 kWh' }, authoredText: 'Årsenergi: 12500 kWh' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_source_mismatch')
    expect(result.facts.annualConsumptionKwh).toBeUndefined()
  })

  it('does not accept a claimed field merely because its number appears elsewhere', () => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: '12500 kWh' }, authoredText: 'Uppskattad framtida förbrukning: 12500 kWh' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_source_missing')
  })

  it('requires review for a malformed mentioned value even when extraction omitted it', () => {
    const result = normalizeManualFacilityFacts({ extracted: { facility_id: '735999100000000001' }, authoredText: 'Årsenergi: 10 000–12 000 kWh' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_invalid')
  })

  it.each(['Årsenergi -12500 kWh', 'Årsenergi - 12500 kWh', 'Årsenergi: - 12500 kWh'])('does not turn a source-only negative value into positive energy: %s', (authoredText) => {
    const result = normalizeManualFacilityFacts({ extracted: {}, authoredText })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_invalid')
    expect(result.facts.annualConsumptionKwh).toBeUndefined()
  })

  it('recovers an unambiguous labeled fact from source when extraction omitted it', () => {
    const result = normalizeManualFacilityFacts({ extracted: {}, authoredText: 'Årsförbrukning: 12,5 MWh' })
    expect(result).toEqual({ ok: true, reasons: [], facts: { annualConsumptionKwh: 12500 } })
  })

  it('keeps equivalent repeated units unambiguous', () => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: '12500 kWh' }, authoredText: 'Årsenergi: 12500 kWh\nÅrsförbrukning: 12,5 MWh' })
    expect(result).toEqual({ ok: true, reasons: [], facts: { annualConsumptionKwh: 12500 } })
  })

  it('requires review when the source gives two different annual values', () => {
    const result = normalizeManualFacilityFacts({ extracted: { annual_consumption: '12500 kWh' }, authoredText: 'Årsenergi: 12500 kWh\nÅrsförbrukning: 15000 kWh' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('annual_consumption_conflicting_values')
    expect(result.facts.annualConsumptionKwh).toBeUndefined()
  })

  it.each(['E.ON Energilösningar AB', 'Vattenfall', '7H Kraft & Energi AB'])('retains the explicit supplier name %s without inventing an identifier', (raw) => {
    const result = normalizeManualFacilityFacts({ extracted: { current_supplier: raw }, authoredText: `Nuvarande elhandelsföretag: ${raw}` })
    expect(result).toEqual({ ok: true, reasons: [], facts: { currentSupplierName: raw } })
    expect(Object.keys(result.facts)).toEqual(['currentSupplierName'])
  })

  it.each(['735999100000000001', '556123-4567', 'SE556123456701', '23X-SUPPLIER-123', 'abcdefab-cdef-abcd-efab-cdefabcdefab', 'E.ON om uppsägningen godkänns', 'E.ON (om godkänt)', 'E.ON, förutsatt att kunden godkänner', 'https://supplier.test', 'support@supplier.test', 'Okänd', 'E.ON eller Vattenfall'])('requires review for an ID, unknown or conditional supplier value %s', (raw) => {
    const result = normalizeManualFacilityFacts({ extracted: { current_supplier: raw }, authoredText: `Nuvarande leverantör: ${raw}` })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('current_supplier_invalid')
    expect(result.facts.currentSupplierName).toBeUndefined()
  })

  it('does not take the sender signature as proof of the current supplier', () => {
    const result = normalizeManualFacilityFacts({ extracted: { current_supplier: 'E.ON Energilösningar AB' }, authoredText: 'Med vänlig hälsning\nE.ON Energilösningar AB' })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain('current_supplier_source_missing')
  })

  it.each(['Schablon', 'Tim', 'Kvart', 'Timavräkning', 'Kvartsmätning'])('keeps a recognized metering method %s as raw metadata', (raw) => {
    expect(normalizeManualFacilityFacts({ extracted: { metering_method: raw }, authoredText: `Mätmetod: ${raw}` })).toEqual({ ok: true, reasons: [], facts: { meteringMethod: raw } })
  })

  it.each([
    ['Timvis', 'hourly'],
    ['Dygnsvis', 'daily'],
    ['Månadsvis', 'monthly'],
    ['Manuell', 'manual'],
  ])('maps explicit reporting frequency %s to %s', (raw, expected) => {
    const result = normalizeManualFacilityFacts({ extracted: { reporting_frequency: raw }, authoredText: `Rapporteringsfrekvens: ${raw}` })
    expect(result).toEqual({ ok: true, reasons: [], facts: { reportingFrequency: raw, readingFrequency: expected } })
  })

  it.each(['Kvartsvis', '15 minuter', 'quarter-hourly'])('retains quarter-hour reporting %s without pretending it is hourly', (raw) => {
    const result = normalizeManualFacilityFacts({ extracted: { reporting_frequency: raw }, authoredText: `Rapporteringsfrekvens: ${raw}` })
    expect(result).toEqual({ ok: true, reasons: [], facts: { reportingFrequency: raw } })
    expect(result.facts.readingFrequency).toBeUndefined()
  })

  it.each([
    ['metering_method', 'Mätmetod: ibland', 'metering_method_invalid'],
    ['reporting_frequency', 'Rapporteringsfrekvens: när möjligt', 'reporting_frequency_invalid'],
  ])('requires review for malformed mentioned %s', (_field, authoredText, reason) => {
    const result = normalizeManualFacilityFacts({ extracted: {}, authoredText })
    expect(result.ok).toBe(false)
    expect(result.reasons).toContain(reason)
  })
})
