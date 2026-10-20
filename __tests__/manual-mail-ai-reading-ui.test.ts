import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import ManualMailAiReading from '@/app/admin/manual-requests/ManualMailAiReading'
import { manualVerifiedMail } from './helpers/manualVerifiedMail'

type Row = Record<string, unknown>
const application = () => ({ version: 1, companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a',
  applied: true, sourceHash: 'a'.repeat(64), complete: true,
  terms: { earliestStartDate: '2027-04-01', effectiveStartDate: '2027-04-01', terminationFee: 'Ingen' } })
const payload = (): Row => ({ sender_credible: true, sender_verification: manualVerifiedMail('support@example.org'),
  manual_automation: { sourceHash: 'a'.repeat(64), application: application() } })
const render = (value: Row) => renderToStaticMarkup(createElement(ManualMailAiReading, {
  payload: value, companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a',
}))

it('shows committed commercial facts independently of whether an AI reading exists', () => {
  const html = render(payload())
  expect(html).toContain('Avtalsuppgifter sparade automatiskt')
  expect(html).toContain('2027-04-01')
  expect(html).toContain('Ordinarie kontroller avgör när leverantörsbytet får skickas.')
})

it('distinguishes committed partial facts from a complete supplier response and names missing information', () => {
  const value = payload()
  ;(value.manual_automation as Row).application = { ...application(), complete: false,
    terms: { contractEndDate: '2027-03-31' }, missingFields: ['earliest_supplier_start_date', 'termination_fee'] }
  const html = render(value)
  expect(html).toContain('Deluppgifter sparade automatiskt')
  expect(html).toContain('Avtalslut')
  expect(html).toContain('2027-03-31')
  expect(html).toContain('Tidigaste start hos ny leverantör')
  expect(html).toContain('Brytavgift')
  expect(html).not.toContain('Avtalsuppgifter sparade automatiskt')
})

it('shows committed facility identity and applied facts from the canonical result', () => {
  const value = payload()
  ;(value.manual_automation as Row).application = { version: 1, companyId: 'tenant-a', customerId: 'customer-a', requestId: 'request-a',
    applied: true, sourceHash: 'a'.repeat(64), result: { ok: true, facilityId: '735999100000000001', gridAreaCode: 'LKR',
      appliedFacts: { annualConsumptionKwh: 12500, currentSupplierName: 'Exempel Energi' } } }
  const html = render(value)
  expect(html).toContain('Anläggningsuppgifter sparade automatiskt')
  expect(html).toContain('735999100000000001')
  expect(html).toContain('12500')
  expect(html).toContain('Exempel Energi')
})

it.each([
  { companyId: 'tenant-b' }, { customerId: 'customer-b' }, { requestId: 'request-b' },
  { sourceHash: 'b'.repeat(64) }, { applied: false }, { version: 2 },
])('never labels mismatched or invalid application provenance as applied: %o', patch => {
  const value = payload()
  ;(value.manual_automation as Row).application = { ...application(), ...patch }
  const html = render(value)
  expect(html).not.toContain('sparade automatiskt')
  expect(html).not.toContain('2027-04-01')
  expect(html).toContain('Inväntar validering eller granskning')
})

it.each([
  { sender_credible: false },
  { sender_verification: { ...manualVerifiedMail('support@example.org'), status: 'unverified' } },
  { sender_verification: undefined },
])('does not show applied facts without verified sender provenance: %o', patch => {
  const html = render({ ...payload(), ...patch })
  expect(html).not.toContain('sparade automatiskt')
  expect(html).not.toContain('2027-04-01')
})

it('shows the AI global review flags and added field labels without claiming the reading applied facts', () => {
  const html = render({ ai_read_only: { status: 'completed', context: { company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a' },
    outcome: 'contract_information', review_reasons: ['conditional', 'multiple_facilities'],
    fields: [{ field: 'price_area', value: 'SE4', quote: 'Elområde: SE4' },
      { field: 'cancellation_registered', value: 'ja', quote: 'Uppsägning registrerad: ja' },
      { field: 'contract_status', value: 'aktivt', quote: 'Avtalsstatus: aktivt' }] } })
  expect(html).toContain('Svaret innehåller villkor')
  expect(html).toContain('Flera anläggningar anges')
  expect(html).toContain('Elområde')
  expect(html).toContain('Registrerad uppsägning')
  expect(html).toContain('Avtalsstatus')
  expect(html).toContain('Inväntar validering eller granskning')
  expect(html).not.toContain('sparade automatiskt')
})

it('keeps a previous AI reading for another request hidden', () => {
  const html = render({ ai_read_only: { status: 'completed', context: { company_id: 'tenant-b', customer_id: 'customer-b', request_id: 'request-b' },
    outcome: 'contract_information', fields: [{ field: 'earliest_start', value: '2028-01-01', quote: 'Tidigaste start: 2028-01-01' }] } })
  expect(html).toContain('gäller en annan matchning')
  expect(html).not.toContain('2028-01-01')
})

const childRequest = '22222222-2222-4222-8222-222222222222'
const siteApplication = () => ({ version: 1, parentRequestId: 'request-a', companyId: 'tenant-a', customerId: 'customer-a', siteId: 'site-a', requestId: childRequest, sourceHash: 'a'.repeat(64), status: 'applied', application: { ...application(), requestId: childRequest, terms: { earliestStartDate: '2028-07-01' } } })
it('shows confirmed per-site applications independently and preserves per-site dates', () => {
  const value = payload()
  ;(value.manual_automation as Row).site_applications = { [childRequest]: siteApplication() }
  const html = render(value)
  expect(html).toContain('Bekräftade uppgifter per anläggning')
  expect(html).toContain('2028-07-01'); expect(html).toContain('site-a')
})
it.each([{ parentRequestId: 'other' }, { companyId: 'other' }, { customerId: 'other' }, { requestId: 'other' }, { sourceHash: 'b'.repeat(64) }, { status: 'needs_review' }])('hides per-site business facts with invalid provenance %o', patch => {
  const value = payload()
  ;(value.manual_automation as Row).site_applications = { [childRequest]: { ...siteApplication(), ...patch } }
  expect(render(value)).not.toContain('2028-07-01')
})
it('does not show a child application whose own context differs from its site envelope', () => {
  const value = payload()
  ;(value.manual_automation as Row).site_applications = { [childRequest]: { ...siteApplication(), application: { ...siteApplication().application, customerId: 'other' } } }
  expect(render(value)).not.toContain('2028-07-01')
})

it('shows up to 64 AI evidence fields only for a stored multiple-facility scope', () => {
  const reading = { status: 'completed', scope_mode: 'multiple_facilities', context: { company_id: 'tenant-a', customer_id: 'customer-a', request_id: 'request-a' }, outcome: 'facility_information', fields: Array.from({ length: 64 }, (_, index) => ({ field: 'facility_id', value: `facility-${index}`, quote: `Anläggning: facility-${index}` })) }
  expect(render({ ai_read_only: reading })).toContain('facility-63')
  expect(render({ ai_read_only: { ...reading, scope_mode: undefined } })).not.toContain('facility-63')
})
