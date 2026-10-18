import { expect, it } from 'vitest'
import { interpretManualMail } from '@/lib/inbound-mail/manualMailInterpretation'
import { normalizeManualFacilityFacts } from '@/lib/inbound-mail/manualFacilityFacts'
import type { ManualMailAiResult } from '@/lib/inbound-mail/manualMailAiReader'

function reading(text: string, fields: Array<{ field: string; value: string }>): ManualMailAiResult {
  return { status: 'completed', mode: 'read_only', review_required: true, model: 'gpt-6-luna', outcome: 'facility_information',
    review_reasons: [], outcome_quote: text, fields: fields.map(field => ({ ...field, quote: text })) } as ManualMailAiResult
}

it.each([
  'För er kund är anläggningsnumret 735999100000000001. Nätavräkningsområdet är LKR. Årsenergin är 12 500 kWh.',
  'Årsenergin är 12 500 kWh. Nätavräkningsområdet är LKR. Anläggningsnumret är 735999100000000001.',
])('carries the irregular quoted network reply through actual interpretation and source-bound fact normalization: %s', text => {
  const interpreted = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [
    { field: 'facility_id', value: '735999100000000001' }, { field: 'grid_area', value: 'LKR' }, { field: 'annual_consumption', value: '12 500 kWh' },
  ]) })
  expect(interpreted.reasons).toEqual([])
  expect(interpreted.extracted).toMatchObject({ facility_id: '735999100000000001', grid_area_code: 'LKR' })
  expect(normalizeManualFacilityFacts({ extracted: interpreted.extracted, authoredText: text })).toEqual({
    ok: true, reasons: [], facts: { annualConsumptionKwh: 12500 },
  })
})

it('keeps exact supplier, metering and reporting prose candidates compatible with the downstream normalizer', () => {
  const text = 'Nuvarande elhandelsföretag är E.ON Energilösningar AB. Mätmetod är Tim. Mätvärdena rapporteras timvis.'
  const interpreted = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [
    { field: 'current_supplier', value: 'E.ON Energilösningar AB' }, { field: 'metering_method', value: 'Tim' }, { field: 'reporting_frequency', value: 'timvis' },
  ]) })
  expect(interpreted.reasons).toEqual([])
  expect(normalizeManualFacilityFacts({ extracted: interpreted.extracted, authoredText: text })).toEqual({
    ok: true, reasons: [], facts: { currentSupplierName: 'E.ON Energilösningar AB', meteringMethod: 'Tim', reportingFrequency: 'timvis', readingFrequency: 'hourly' },
  })
})

it('does not let a matching number in another sentence supply the annual-energy meaning', () => {
  const text = 'Årsenergin är 12 500 kWh. Nästa års prognos är 15 000 kWh.'
  const interpreted = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'annual_consumption', value: '15 000 kWh' }]) })
  expect(interpreted.reasons).toContain('ai_field_meaning_unverified:annual_consumption')
  expect(interpreted.extracted.annual_consumption).toBeUndefined()
})

it.each([
  ['Årsenergin är inte 12 500 kWh.', 'negated_reply'],
  ['Årsenergin är 12 500 kWh. Detta är en uppskattning.', 'uncertain_reply'],
  ['Årsenergin är 12 500 kWh. Uppgiften gäller annan kund.', 'other_customer_reply'],
])('retains full-text safety gates before accepting prose facts: %s', (text, reason) => {
  const interpreted = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'annual_consumption', value: '12 500 kWh' }]) })
  expect(interpreted.reasons).toContain(reason)
})
