import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CustomerOpsReadiness, CustomerLegalAcceptance, CustomerDocument, CustomerOpsTimelineEvent } from '@/lib/opsMaster/readiness'
import type { CommunicationLog } from '@/lib/email/communicationLogs'
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/customers/[id]/email-actions', () => ({ resendCustomerEmailAction: async () => {} }))
import LegalCard from '@/components/admin/customers/CustomerLegalReadinessCard'
import { CustomerCommunicationSection } from '@/app/admin/customers/[id]/page.part-3'
const readiness = { hasTerms: false, hasPrivacy: false, hasWithdrawal: false, hasPriceSnapshot: false, hasPowerOfAttorneyAcceptance: false, hasActivePowerOfAttorney: false, hasFacility: false, hasMeteringPoint: false, hasGridOwner: false, hasGridArea: false, blockers: [{ code: 'price_snapshot_missing', label: 'RAW_SNAPSHOT', action: 'RAW_ACTION' }], nextAction: { label: 'Begär uppgifter', hrefTab: 'data-requests', description: '' } } as unknown as CustomerOpsReadiness
const acceptance = { id: 'acceptance', acceptance_type: 'RAW_ACCEPTANCE', accepted_at: '2026-11-15T10:00:00Z', source: 'RAW_SOURCE' } as CustomerLegalAcceptance
const document = { id: 'document', document_type: 'power_of_attorney', title: 'Fullmakt från kunden', created_at: '2026-11-15T10:00:00Z' } as CustomerDocument
const timeline = [{ title: 'RAW_TITLE', event_type: 'RAW_EVENT', source: 'domain_event', source_id: 'event', created_at: '2026-11-15T10:00:00Z', metadata: {} }] as CustomerOpsTimelineEvent[]
const legal = (platform = false) => renderToStaticMarkup(React.createElement(LegalCard, { customerId: 'customer', readiness, acceptances: [acceptance], documents: [document], timeline, isPlatformAdmin: platform }))
const log = (status: string, id = status) => ({ id, customer_id: 'customer', event_key: 'RAW_EVENT', template_key: 'RAW_TEMPLATE', subject: null, recipient_email: 'kund@example.invalid', status, created_at: '2026-11-15T10:00:00Z', error_message: 'RAW_PROVIDER_ERROR' }) as CommunicationLog
beforeEach(() => { vi.stubGlobal('React', React) })
it('legal company view has no broken tab links or technical fallback labels', () => {
  const html = legal()
  expect(html).toContain('href="/admin/customers/customer"')
  for (const technical of ['?tab=data-requests', '?tab=documents', 'RAW_ACCEPTANCE', 'RAW_SOURCE', 'RAW_TITLE', 'RAW_EVENT', 'RAW_SNAPSHOT', 'RAW_ACTION', 'prissnapshot', 'Kan skicka kundmail', '>power_of_attorney<']) expect(html).not.toContain(technical)
  expect(html).toContain('Fullmakt från kunden')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/legal-readiness-company.html`, `<main>${html}</main>`)
})
it('legal platform view retains the original evidence and links to the real document tab', () => {
  const html = legal(true)
  expect(html).toContain('RAW_SOURCE')
  expect(html).toContain('RAW_TITLE')
  expect(html).toContain('?tab=authorization-documents')
  expect(html).not.toContain('?tab=documents')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/legal-readiness-platform.html`, `<main>${html}</main>`)
})
it('legal lists keep all loaded records available beyond the former silent limits', () => {
  const html = renderToStaticMarkup(React.createElement(LegalCard, { customerId: 'customer', readiness, acceptances: [], documents: Array.from({ length: 12 }, (_, i) => ({ ...document, id: `doc-${i}`, title: `Dokument ${i}` })), timeline: Array.from({ length: 15 }, (_, i) => ({ ...timeline[0], source_id: `event-${i}`, event_type: 'customer.created' })), powersOfAttorney: Array.from({ length: 6 }, (_, i) => ({ id: `poa-${i}`, status: 'RAW_POA_STATUS', method: 'RAW_METHOD', scope: 'RAW_SCOPE' })) }))
  expect(html).toContain('Dokument 11')
  expect(html).toContain('Tidigare händelser (5)')
  expect(html).not.toContain('RAW_POA_STATUS')
  expect(html).not.toContain('RAW_METHOD')
  expect(html).not.toContain('RAW_SCOPE')
  expect(html.match(/Dokument: saknas/g)).toHaveLength(6)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/legal-long-company.html`, `<main>${html}</main>`)
})
it('communication does not expose internal subjects, unknown states or provider errors to companies', () => {
  const html = renderToStaticMarkup(React.createElement(CustomerCommunicationSection, { logs: [log('NEW_INTERNAL_STATUS')] }))
  for (const technical of ['RAW_EVENT', 'RAW_TEMPLATE', 'NEW_INTERNAL_STATUS', 'RAW_PROVIDER_ERROR']) expect(html).not.toContain(technical)
  expect(html).not.toContain('<form')
  expect(html).toContain('Status behöver granskas')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/communication-company.html`, `<main>${html}</main>`)
})
it.each([['delivered','Levererad'], ['bounced','Kunde inte levereras'], ['complained','Anmält av mottagaren'], ['cancelled','Avbruten']])('communication explains %s truthfully', (status, label) => {
  const html = renderToStaticMarkup(React.createElement(CustomerCommunicationSection, { logs: [log(status)] }))
  expect(html).toContain(label)
})
it('communication preserves authorized resend fields in a collapsed action menu', () => {
  const html = renderToStaticMarkup(React.createElement(CustomerCommunicationSection, { logs: [log('failed')], canResend: true }))
  expect(html).toContain('name="customer_id" value="customer"')
  expect(html).toContain('name="log_id" value="failed"')
  expect(html).toContain('Fler åtgärder')
  expect(html).not.toMatch(/<details[^>]*open/)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/communication-writer-company.html`, `<main>${html}</main>`)
})
it('communication keeps older loaded messages available past the former limit of 25', () => {
  const logs = Array.from({ length: 35 }, (_, i) => ({ ...log('sent', `message-${i}`), subject: `Meddelande ${i}` }))
  const html = renderToStaticMarkup(React.createElement(CustomerCommunicationSection, { logs }))
  expect(html).toContain('Meddelande 34')
  expect(html).toContain('Tidigare meddelanden (25)')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/communication-long-company.html`, `<main>${html}</main>`)
})
it('platform communications retain protocol evidence without unauthorized resend forms', () => {
  const html = renderToStaticMarkup(React.createElement(CustomerCommunicationSection, { logs: [log('failed')], isPlatformAdmin: true }))
  expect(html).toContain('RAW_EVENT')
  expect(html).toContain('RAW_PROVIDER_ERROR')
  expect(html).not.toContain('<form')
})

it('timeline uses actual communication status instead of a title that implies successful sending', () => {
  const html = renderToStaticMarkup(React.createElement(LegalCard, { customerId: 'customer', readiness, acceptances: [], documents: [], timeline: [{ ...timeline[0], source: 'communication_log', title: 'Avtalsbekräftelse skickad', metadata: { status: 'queued' } }] }))
  expect(html).toContain('Väntar på utskick')
  expect(html).not.toContain('Avtalsbekräftelse skickad')
})
it('omits resend for an incomplete log even when the operator has permission', () => {
  const html = renderToStaticMarkup(React.createElement(CustomerCommunicationSection, { logs: [{ ...log('failed'), template_key: null }], canResend: true }))
  expect(html).not.toContain('<form')
})
it('server caller passes resend permission matching the unchanged server action', () => {
  const page = fs.readFileSync('app/admin/customers/[id]/page.part-4.tsx', 'utf8')
  expect(page).toContain('hasPermissionRequirement(access.permissions, { anyOf: ["customers.read", "customers.write"] })')
  expect(page.match(/canResend={canResendCustomerEmail}/g)).toHaveLength(2)
  expect(page).toContain('isPlatformAdmin={isPlatformAdmin}\n            customerIdentity=')
})
