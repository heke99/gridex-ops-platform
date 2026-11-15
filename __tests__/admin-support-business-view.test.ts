import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({
  platform: false, writer: false, attachmentError: false,
  cases: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>>,
  list: vi.fn(), options: vi.fn(), detail: vi.fn(), eventRead: vi.fn(),
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'staff', email: 'staff@example.invalid', companyId: 'company-a', roles: [], permissions: io.writer ? ['cases.read', 'cases.write'] : ['cases.read'], isPlatformAdmin: io.platform }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn() }))
vi.mock('@/lib/customer-cases/db', () => ({ listCustomerCases: io.list, getCustomerCaseById: io.detail, listCustomerCaseEvents: io.eventRead }))
vi.mock('@/lib/customer-cases/support', () => ({ listTenantSupportCustomerOptions: io.options }))
vi.mock('@/lib/customer-service/supportAttachments', () => ({ listSupportAttachments: async () => { if (io.attachmentError) throw new Error('read_failed'); return [] } }))
vi.mock('@/app/admin/customer-cases/actions', () => ({ createCustomerCaseFromFormAction: async () => {}, updateCustomerCaseStatusAction: async () => {}, addInternalNoteAction: async () => {}, recordPhoneInteractionAction: async () => {}, replyToCustomerAction: async () => {}, uploadSupportAttachmentAction: async () => {} }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => { throw new Error('No unscoped fallback lookup allowed') } } }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found') } }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title, subtitle }: { title: string; subtitle: string }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, subtitle)) }))
import CasesPage from '@/app/admin/customer-cases/page'
import DetailPage from '@/app/admin/customer-cases/[caseId]/page'
import BillingCard from '@/components/admin/customers/CustomerBillingMeteringCard'
import type { BillingUnderlayRow } from '@/lib/cis/types'

const caseRow = (id: string, status = 'open') => ({ id, company_id: 'company-a', customer_id: 'customer', customer_name: 'Syntetisk kund', title: `Ärende ${id}`, status, priority: 'normal', source: 'tenant_support_phone', reason_category: 'support', created_at: '2026-11-15T10:00:00Z' })
beforeEach(() => {
  vi.stubGlobal('React', React)
  io.platform = false; io.writer = false; io.attachmentError = false
  io.cases = [caseRow('open'), caseRow('closed', 'closed')]
  io.events = Array.from({ length: 14 }, (_, i) => ({ id: `event-${i}`, event_type: 'support_internal_note', message: `Historik ${i}`, payload: { visibility: 'internal' }, created_at: '2026-11-15T10:00:00Z' })).reverse()
  io.list.mockReset().mockImplementation(async () => io.cases)
  io.options.mockReset().mockResolvedValue([{ id: 'customer', label: 'Syntetisk kund' }])
  io.detail.mockReset().mockImplementation(async () => io.cases[0])
  io.eventRead.mockReset().mockImplementation(async () => io.events)
})
const list = async () => renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({}) }))
const detail = async () => renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ caseId: 'open' }) }))

it('keeps active cases visible and closed history collapsed without technical source names', async () => {
  const html = await list()
  expect(io.list).toHaveBeenCalledWith({ companyId: 'company-a', limit: 200 })
  expect(html).toContain('>Supportkö</h2>')
  expect(html).toContain('Telefon')
  expect(html).not.toContain('tenant_support_phone')
  expect(html).not.toContain('tenantens')
  expect(html).not.toContain('Totalt i supporthistorik')
  expect(html).toMatch(/<details[^>]*id="closed-support-cases"[^>]*>/)
  expect(html).not.toMatch(/<details[^>]*id="closed-support-cases"[^>]*open/)
  expect(html).toContain('Ärende closed')
  expect(html.indexOf('Ärende open')).toBeLessThan(html.indexOf('id="closed-support-cases"'))
  expect(html).not.toContain('<form')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/support-list-company.html`, html)
})
it('shows an honest empty active queue when only closed cases remain', async () => {
  io.cases = [caseRow('closed', 'resolved')]
  const html = await list()
  expect(html).toContain('Inga öppna supportärenden')
  expect(html).toContain('Ärende closed')
})
it('retains writer form tenant and idempotency fields and preselected customer', async () => {
  io.writer = true
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer: 'customer', channel: 'phone' }) }))
  expect(io.options).toHaveBeenCalledWith('company-a')
  expect(html).toContain('name="expected_company_id" value="company-a"')
  expect(html).toContain('name="idempotency_key"')
  expect(html).toContain('<option value="customer" selected="">')
  expect(html).toContain('<option value="phone" selected="">')
  expect(html.match(/name="case_id"/g)).toHaveLength(1)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/support-writer-company.html`, html)
})
it('does not make a separate unscoped lookup for a missing customer name', async () => {
  io.cases = [{ ...caseRow('no-name'), customer_name: null }]
  expect(await list()).toContain('Kunduppgifter saknas')
})
it('keeps technical channel available only in collapsed platform details', async () => {
  io.platform = true; io.writer = true
  const html = await list()
  expect(html).toContain('tenant_support_phone')
  expect(html).toContain('Tekniska uppgifter')
  expect(html).not.toContain('<form')
})
it('keeps the latest conversation visible and earlier entries available without reordering', async () => {
  const html = await detail()
  expect(io.detail).toHaveBeenCalledWith('open', 'company-a')
  expect(io.eventRead).toHaveBeenCalledWith('open', 'company-a')
  expect(html).toContain('Tidigare händelser (4)')
  expect(html).toMatch(/<details[^>]*id="earlier-support-history"[^>]*>/)
  const before = html.indexOf('Historik 0'), split = html.indexOf('</details>'), after = html.indexOf('Historik 13')
  expect(before).toBeLessThan(split); expect(after).toBeGreaterThan(split)
  expect(html).toContain('Endast internt')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/support-detail-company.html`, html)
})
it('describes failed attachment reads accurately', async () => {
  io.attachmentError = true
  const html = await detail()
  expect(html).toContain('Bilagorna kunde inte hämtas')
  expect(html).not.toContain('inte aktiverade')
})
it('provides keyboard accessible bounded lists for a long support queue', async () => {
  io.cases = Array.from({ length: 40 }, (_, i) => caseRow(`long-${i}`))
  const html = await list()
  expect(html).toContain('aria-label="Öppna supportärenden"')
  expect(html).toContain('tabindex="0"')
  expect(html).toContain('overflow-y-auto')
  expect(html).toContain('Ärende long-39')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/support-long-company.html`, html)
})
it('calculates billing summary on the server and keeps raw blocker evidence out of company HTML', () => {
  const source = fs.readFileSync('components/admin/customers/CustomerBillingMeteringCard.tsx', 'utf8')
  expect(source).not.toMatch(/['"]use client['"]/)
  const html = renderToStaticMarkup(React.createElement(BillingCard, { customerId: 'customer', sites: [], meteringPoints: [], gridOwners: [], dataRequests: [], meteringValues: [], outboundRequests: [], partnerExports: [], billingUnderlays: [{ id: 'underlay', readiness_status: 'blocked', billing_block_reason: 'RAW_TECHNICAL_BLOCKER' } as unknown as BillingUnderlayRow] }))
  expect(html).toContain('Kräver åtgärd')
  expect(html).not.toContain('RAW_TECHNICAL_BLOCKER')
  expect(html).toContain('href="/admin/billing?customer=customer"')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/billing-summary-company.html`, `<main>${html}</main>`)
})

it('retains platform blocker evidence inside a closed disclosure', () => {
  const html = renderToStaticMarkup(React.createElement(BillingCard, { customerId: 'customer', isPlatformAdmin: true, sites: [], meteringPoints: [], gridOwners: [], dataRequests: [], meteringValues: [], outboundRequests: [], partnerExports: [], billingUnderlays: [{ id: 'underlay', readiness_status: 'blocked', billing_block_reason: 'RAW_TECHNICAL_BLOCKER' } as unknown as BillingUnderlayRow] }))
  expect(html).toContain('RAW_TECHNICAL_BLOCKER')
  expect(html).toContain('<details')
  expect(html).not.toContain('<details open')
})
it('retains staff conversation controls and upload guards in writable open cases', async () => {
  io.writer = true
  const html = await detail()
  expect(html).toContain('Svara kunden')
  expect(html).toContain('name="expected_company_id" value="company-a"')
  expect(html).toContain('name="visibility"')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/support-detail-writer-company.html`, html)
})
