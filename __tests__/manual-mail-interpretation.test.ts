import { expect, it } from 'vitest'
import { interpretManualMail } from '@/lib/inbound-mail/manualMailInterpretation'
import type { ManualMailAiResult } from '@/lib/inbound-mail/manualMailAiReader'

function reading(text: string, fields: Array<{ field: string; value: string }>, outcome = 'contract_information'): ManualMailAiResult {
  return { status: 'completed', mode: 'read_only', review_required: true, model: 'gpt-6-luna', outcome,
    review_reasons: [], outcome_quote: text, fields: fields.map((field) => ({ ...field, quote: text })) } as ManualMailAiResult
}

it('accepts explicitly evidenced natural-language dates for automatic server normalization', () => {
  const text = 'Kunden kan börja hos er tidigast den 1 april 2027.\nBrytavgift: Ingen.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [
    { field: 'earliest_start', value: '1 april 2027' }, { field: 'termination_fee', value: 'Ingen' },
  ]) })
  expect(result.reasons).toEqual([])
  expect(result.extracted).toMatchObject({ earliest_supplier_start_date: '1 april 2027', termination_fee: 'Ingen' })
})

it('extracts and validates an irregular network answer without letting AI choose its tenant', () => {
  const text = 'För er kund är anläggningsnumret 735999100000000001. Nätavräkningsområdet är LKR. Årsenergin är 12 500 kWh.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [
    { field: 'facility_id', value: '735999100000000001' }, { field: 'grid_area', value: 'LKR' },
    { field: 'annual_consumption', value: '12 500 kWh' },
  ], 'facility_information') })
  expect(result.reasons).toEqual([])
  expect(result.extracted).toMatchObject({ facility_id: '735999100000000001', grid_area_code: 'LKR', annual_consumption: '12 500 kWh' })
  expect(result).not.toHaveProperty('companyId')
  expect(result).not.toHaveProperty('customerId')
})

it('binds the full explicit current-supplier label to its adjacent company name', () => {
  const text = 'Nuvarande elhandelsföretag är E.ON Energilösningar AB.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'current_supplier', value: 'E.ON Energilösningar AB' }], 'facility_information') })
  expect(result.reasons).toEqual([])
  expect(result.extracted.current_supplier).toBe('E.ON Energilösningar AB')
})

it.each([
  ['Kunden kan inte börja den 1 april 2027.', 'negated_reply'],
  ['Kunden kan börja den 1 april 2027.\n\nDetta förutsätter att kunden säger upp avtalet.', 'conditional_reply'],
  ['Kunden kan börja den 1 april 2027.\n\nDatumet är preliminärt.', 'conditional_reply'],
])('does not promote a quoted but qualified date: %s', (text, reason) => {
  expect(interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'earliest_start', value: '1 april 2027' }]) }).reasons).toContain(reason)
})

it('rejects a date whose meaning is contract-end when AI labels it earliest-start', () => {
  const text = 'Avtalet gäller till och med 2027-03-31.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'earliest_start', value: '2027-03-31' }]) })
  expect(result.reasons).toContain('ai_field_meaning_unverified:earliest_start')
  expect(result.extracted.earliest_supplier_start_date).toBeFalsy()
})

it('does not silently replace a contradictory deterministic value', () => {
  const text = 'Tidigaste start: 2027-04-01.\nTidigaste start: 2027-05-01.'
  const result = interpretManualMail({ authoredText: text, extracted: { earliest_supplier_start_date: '2027-04-01' },
    reading: reading(text, [{ field: 'earliest_start', value: '2027-05-01' }]) })
  expect(result.reasons).toContain('conflicting_field:earliest_supplier_start_date')
})

it('does not mix two facilities or person identities in one automatic update', () => {
  const text = 'Anläggnings-ID: 735999100000000001\nAnläggnings-ID: 735999100000000002'
  expect(interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000001' } }).reasons).toContain('multiple_facilities')
})

it('does not mistake distinct explicitly labelled facility and metering IDs for two facilities', () => {
  const text = 'Anläggnings-ID: 735999100000000001\nMätpunkts-ID: 735999100000000002\nNätområde: LKR'
  expect(interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000001', metering_point_id: '735999100000000002', grid_area_code: 'LKR' } }).reasons).toEqual([])
})

it.each([
  'För Erik är anläggningsnumret 735999100000000002.\nFör Anna är anläggningsnumret 735999100000000001.\nNätområde: LKR',
  'För Anna är anläggningsnumret 735999100000000001.\nFör Erik är anläggningsnumret 735999100000000002.\nNätområde: LKR',
])('does not let AI choose another customer\'s inflected facility number: %s', (text) => {
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'facility_id', value: '735999100000000002' }], 'facility_information') })
  expect(result.reasons).toContain('multiple_facilities')
})

it('holds an unlabelled extra 18-digit identifier instead of guessing its role', () => {
  const text = 'Anläggnings-ID: 735999100000000001\nReferens: 735999100000000002\nNätområde: LKR'
  expect(interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000001' } }).reasons).toContain('multiple_facilities')
})

it.each([
  ['facility_id', '735999100000000002', 'facility_id'],
  ['metering_point_id', '735999100000000001', 'metering_point_id'],
])('does not bind a same-clause %s to the other identifier role', (field, value, target) => {
  const text = 'För er kund är anläggningsnumret 735999100000000001; mätpunkten 735999100000000002.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field, value }], 'facility_information') })
  expect(result.reasons).toContain(`ai_field_meaning_unverified:${field}`)
  expect(result.extracted[target as 'facility_id' | 'metering_point_id']).toBeUndefined()
})

it('accepts distinct facility and metering roles adjacent to their values on one line', () => {
  const text = 'För er kund är anläggningsnumret 735999100000000001; mätpunkten 735999100000000002.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [
    { field: 'facility_id', value: '735999100000000001' }, { field: 'metering_point_id', value: '735999100000000002' },
  ], 'facility_information') })
  expect(result.reasons).toEqual([])
  expect(result.extracted).toMatchObject({ facility_id: '735999100000000001', metering_point_id: '735999100000000002' })
})

it.each([
  ['Kunden kan börja den 1 april 2027.\nDetta datum är en uppskattning.', 'uncertain_reply'],
  ['Kunden kan börja den 1 april 2027.\nDatumet gäller för annan kund.', 'other_customer_reply'],
])('retains natural-language full-text qualifications: %s', (text, reason) => {
  expect(interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'earliest_start', value: '1 april 2027' }]) }).reasons).toContain(reason)
})

it.each([
  'Fullmakten är godkänd, men uppgifterna ovan gäller inte kunden.',
  'Uppgifterna ovan gäller inte kunden, men fullmakten är godkänd.',
])('does not erase a customer negation inside a POA acceptance: %s', (qualifier) => {
  const text = `Anläggnings-ID: 735999100000000002\nNätområde: LKR\n${qualifier}`
  expect(interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000002', grid_area_code: 'LKR' } }).reasons).toContain('negated_reply')
})

it.each([
  'Fullmakten är godkänd. BankID krävs inte.',
  'Fullmakten är godkänd och behöver inte kompletteras med organisationsnummer.',
  'Fullmakten är godkänd och BankID krävs inte.',
  'BankID krävs inte och fullmakten är godkänd.',
])('keeps exact explicit POA acceptance harmless: %s', (acceptance) => {
  const text = `Anläggnings-ID: 735999100000000001\nNätområde: LKR\n${acceptance}`
  expect(interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000001', grid_area_code: 'LKR' } }).reasons).toEqual([])
})

it('does not bind the contract-end date to an earlier start label on the same line', () => {
  const text = 'Tidigaste start: 2027-04-01; Avtalsslut: 2027-03-31.'
  const result = interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'earliest_start', value: '2027-03-31' }]) })
  expect(result.reasons).toContain('ai_field_meaning_unverified:earliest_start')
  expect(result.extracted.earliest_supplier_start_date).toBeUndefined()
})

it('rejects a deterministic facility value bound only to the metering role', () => {
  const text = 'Anläggnings-ID: 735999100000000001; Mätpunkts-ID: 735999100000000002.'
  const result = interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000002' } })
  expect(result.reasons).toContain('field_meaning_unverified:facility_id')
})

it('keeps AI-reported uncertainty as a blocking reason', () => {
  const text = 'Tidigaste start: 2027-04-01.'
  const candidate = { ...reading(text, [{ field: 'earliest_start', value: '2027-04-01' }]), review_reasons: ['uncertain'] } as ManualMailAiResult
  expect(interpretManualMail({ authoredText: text, extracted: {}, reading: candidate }).reasons).toContain('ai_review_required:uncertain')
})

it('does not auto-apply a legacy completed AI reading with no qualifier assessment', () => {
  const text = 'Tidigaste start: 2027-04-01.'
  const candidate = { ...reading(text, [{ field: 'earliest_start', value: '2027-04-01' }]) } as Record<string, unknown>
  delete candidate.review_reasons
  expect(interpretManualMail({ authoredText: text, extracted: {}, reading: candidate as ManualMailAiResult }).reasons).toContain('ai_evidence_invalid')
})

it('does not treat a rejection or completion request as a facility answer', () => {
  const text = 'Fullmakten måste kompletteras innan vi lämnar ut uppgifter. Anläggnings-ID: 735999100000000001'
  expect(interpretManualMail({ authoredText: text, extracted: {}, reading: reading(text, [{ field: 'facility_id', value: '735999100000000001' }], 'completion_requested') }).reasons).toContain('counterparty_requires_action')
})

it('rejects candidates sourced from another body', () => {
  const text = 'Tidigaste start: 2027-04-01.'
  expect(interpretManualMail({ authoredText: text, extracted: {}, reading: reading('Ett annat mejl: 2027-05-01', [{ field: 'earliest_start', value: '2027-05-01' }]) }).reasons).toContain('ai_evidence_invalid')
})

it('retains deterministic extraction when AI is unavailable', () => {
  const text = 'Anläggnings-ID: 735999100000000001\nNätområde: LKR'
  expect(interpretManualMail({ authoredText: text, extracted: { facility_id: '735999100000000001', grid_area_code: 'LKR' },
    reading: { status: 'failed', reason: 'rate_limited' } })).toMatchObject({ reasons: [], extracted: { facility_id: '735999100000000001', grid_area_code: 'LKR' } })
})
