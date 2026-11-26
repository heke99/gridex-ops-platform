import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))

const io = vi.hoisted(() => ({
  platform: false, writer: false, attachmentError: false,
  cases: [] as Array<Record<string, unknown>>, events: [] as Array<Record<string, unknown>>,
  list: vi.fn(), detail: vi.fn(), eventRead: vi.fn(),
  readThroughSdk: false, caseReads: [] as URL[],
  customerRows: [] as Array<{ id: string; company_id: string; full_name: string }>,
  optionReads: [] as Array<{ companyId: unknown; exactId: unknown; limit?: number }>,
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'staff', email: 'staff@example.invalid', companyId: 'company-a', roles: [], permissions: io.writer ? ['cases.read', 'cases.write'] : ['cases.read'], isPlatformAdmin: io.platform }),
  isPlatformAdminContext: () => io.platform,
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: vi.fn() }))
vi.mock('@/lib/customer-cases/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/customer-cases/db')>()
  return {
    listCustomerCases: (...args: Parameters<typeof actual.listCustomerCases>) =>
      io.readThroughSdk ? actual.listCustomerCases(...args) : io.list(...args),
    getCustomerCaseById: io.detail,
    listCustomerCaseEvents: io.eventRead,
  }
})
vi.mock('@/lib/customer-service/supportAttachments', () => ({
  SUPPORT_ATTACHMENT_LIST_PAGE_SIZE: 100,
  listSupportAttachmentsPage: async () => {
    if (io.attachmentError) throw new Error('read_failed')
    return { items: [], page: { next_cursor: null, has_more: false } }
  },
}))
vi.mock('@/app/admin/customer-cases/actions', () => ({ createCustomerCaseFromFormAction: async () => {}, updateCustomerCaseStatusAction: async () => {}, addInternalNoteAction: async () => {}, recordPhoneInteractionAction: async () => {}, replyToCustomerAction: async () => {}, uploadSupportAttachmentAction: async () => {} }))
vi.mock('@/lib/supabase/service', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const client = createClient('https://synthetic.invalid', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input))
      expect(url.origin + url.pathname).toBe('https://synthetic.invalid/rest/v1/customer_cases')
      expect(init?.method).toBe('GET')
      io.caseReads.push(url)
      let rows = io.cases.filter(row => url.searchParams.get('company_id') === 'eq.' + row.company_id
        && url.searchParams.get('customer_id') === 'eq.' + row.customer_id)
      const support = url.searchParams.get('or')
      if (support) {
        expect(support).toBe('(and(source.is.null,metadata.cs.{"support_case":true}),and(source.neq.ediel_inbound_state_machine,or(source.match.^tenant_support_,metadata.cs.{"support_case":true})))')
        rows = rows.filter(row => row.source !== 'ediel_inbound_state_machine'
          && ((row.metadata as { support_case?: unknown } | undefined)?.support_case === true
            || (typeof row.source === 'string' && row.source.startsWith('tenant_support_'))))
      }
      expect(url.searchParams.get('order')).toBe('created_at.desc')
      return Response.json(rows.slice(0, Number(url.searchParams.get('limit'))))
    } },
  })
  return { supabaseService: {
  from(table: string) {
    if (table === 'customer_cases' && io.readThroughSdk) return client.from(table)
    expect(table).toBe('customers')
    const filters = new Map<string, unknown>()
    const results = () => {
      expect(filters.get('company_id')).toBe('company-a')
      return io.customerRows.filter(row => row.company_id === filters.get('company_id')
        && (!filters.has('id') || row.id === filters.get('id')))
    }
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.set(key, value); return query },
      order: (key: string, options: { ascending: boolean }) => {
        expect(key).toBe('created_at')
        expect(options.ascending).toBe(false)
        return query
      },
      limit: async (limit: number) => {
        io.optionReads.push({ companyId: filters.get('company_id'), exactId: filters.get('id'), limit })
        return { data: results().slice(0, limit), error: null }
      },
      maybeSingle: async () => {
        expect(filters.has('id')).toBe(true)
        io.optionReads.push({ companyId: filters.get('company_id'), exactId: filters.get('id') })
        return { data: results()[0] ?? null, error: null }
      },
    }
    return query
  },
  } }
})
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found') } }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title, subtitle }: { title: string; subtitle: string }) => React.createElement('header', null, React.createElement('h1', null, title), React.createElement('p', null, subtitle)) }))
import CasesPage from '@/app/admin/customer-cases/page'
import DetailPage from '@/app/admin/customer-cases/[caseId]/page'
import BillingCard from '@/components/admin/customers/CustomerBillingMeteringCard'
import type { BillingUnderlayRow } from '@/lib/cis/types'

const activeCaseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const selectedCustomerId = '00000000-0000-4000-8000-000000000010'
const otherCustomerId = '00000000-0000-4000-8000-000000000020'
const caseRow = (id: string, status = 'open') => ({ id: id === 'open' ? activeCaseId : id, company_id: 'company-a', customer_id: selectedCustomerId, customer_name: 'Syntetisk kund', title: `Ärende ${id}`, status, priority: 'normal', source: 'tenant_support_phone', reason_category: 'support', created_at: '2026-11-15T10:00:00Z' })
beforeEach(() => {
  vi.stubGlobal('React', React)
  io.platform = false; io.writer = false; io.attachmentError = false
  io.cases = [caseRow('open'), caseRow('closed', 'closed')]
  io.events = Array.from({ length: 14 }, (_, i) => ({ id: `event-${i}`, event_type: 'support_internal_note', message: `Historik ${i}`, payload: { visibility: 'internal' }, created_at: '2026-11-15T10:00:00Z' })).reverse()
  io.list.mockReset().mockImplementation(async () => io.cases)
  io.customerRows = [{ id: selectedCustomerId, company_id: 'company-a', full_name: 'Syntetisk kund' }]
  io.optionReads = []
  io.readThroughSdk = false
  io.caseReads = []
  io.detail.mockReset().mockImplementation(async () => io.cases[0])
  io.eventRead.mockReset().mockImplementation(async () => io.events)
})
const list = async () => renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({}) }))
const detail = async () => renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ caseId: activeCaseId }) }))

it('keeps active cases visible and closed history collapsed without technical source names', async () => {
  const html = await list()
  expect(io.list).toHaveBeenCalledWith({ companyId: 'company-a', supportOnly: true, limit: 200 })
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
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer: selectedCustomerId, channel: 'phone' }) }))
  expect(io.optionReads).toEqual([{ companyId: 'company-a', exactId: undefined, limit: 200 }])
  expect(html).toContain('name="expected_company_id" value="company-a"')
  expect(html).toContain('name="idempotency_key"')
  expect(html).toContain('<option value="' + selectedCustomerId + '" selected="">')
  expect(html).toContain('<option value="phone" selected="">')
  expect(html.match(/name="case_id"/g)).toHaveLength(1)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/support-writer-company.html`, html)
})
it('selects an older tenant customer from the card without expanding the 200 options', async () => {
  io.writer = true
  const newerCustomers = Array.from({ length: 200 }, (_, index) => ({
    id: 'newer-' + index, company_id: 'company-a', full_name: 'Senare kund ' + index,
  }))
  io.customerRows.unshift(...newerCustomers)
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer: selectedCustomerId, channel: 'phone' }) }))
  expect(html).toContain('<option value="' + selectedCustomerId + '" selected="">')
  expect(io.optionReads).toEqual([
    { companyId: 'company-a', exactId: undefined, limit: 200 },
    { companyId: 'company-a', exactId: selectedCustomerId },
  ])
  expect(html.split('<select name="customer_id"')[1].split('</select>')[0].match(/<option /g)).toHaveLength(201)
  expect(html).not.toContain('value="newer-199"')
})
it.each([
  { customer: 'invalid', exactId: null },
  { customer: otherCustomerId, exactId: otherCustomerId },
])('does not append or select a malformed or foreign customer $customer', async ({ customer, exactId }) => {
  io.writer = true
  io.cases = []
  io.customerRows.push({ id: otherCustomerId, company_id: 'company-b', full_name: 'Främmande kund' })
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer }) }))
  expect(io.optionReads).toEqual([
    { companyId: 'company-a', exactId: undefined, limit: 200 },
    ...(exactId ? [{ companyId: 'company-a', exactId }] : []),
  ])
  expect(html).toContain('<option value="" selected="">Välj kund</option>')
  expect(html).not.toContain('Främmande kund')
})

it('keeps older support with only qualified cases inside the database page cap', async () => {
  io.readThroughSdk = true
  const olderCases = [
    { ...caseRow('old-phone'), title: 'Older qualified phone case' },
    { ...caseRow('old-legacy-null'), source: null, metadata: { support_case: true }, title: 'Qualified legacy support case' },
    { ...caseRow('old-other-tenant'), company_id: 'company-b', title: 'Foreign support case' },
    { ...caseRow('old-other-customer'), customer_id: otherCustomerId, title: 'Different customer support case' },
  ]
  io.cases = [
    { ...caseRow('ediel-legacy-marker'), source: 'ediel_inbound_state_machine', metadata: { support_case: true } },
    { ...caseRow('wrong-regex-prefix'), source: 'tenantXsupportYphone' },
    { ...caseRow('string-support-marker'), source: null, metadata: { support_case: 'true' } },
    ...Array.from({ length: 200 }, (_, index) => ({ ...caseRow('newer-' + index), source: 'operations' })),
    ...olderCases,
  ]
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer: selectedCustomerId }) }))
  expect(html).toContain('Older qualified phone case')
  expect(html).toContain('Qualified legacy support case')
  expect(html).not.toMatch(/Foreign support case|Different customer support case|ediel-legacy-marker|wrong-regex-prefix|string-support-marker/)
  expect(io.caseReads).toHaveLength(1)
  expect(io.caseReads[0].searchParams.get('limit')).toBe('200')
  expect(io.caseReads[0].searchParams.get('company_id')).toBe('eq.company-a')
  expect(io.caseReads[0].searchParams.get('customer_id')).toBe('eq.' + selectedCustomerId)
})
it('qualifies the reader’s customer filter before limiting cases', async () => {
  io.cases.push({ ...caseRow('other'), customer_id: otherCustomerId })
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer: selectedCustomerId }) }))
  expect(io.list).toHaveBeenCalledWith({ companyId: 'company-a', customerId: selectedCustomerId, supportOnly: true, limit: 200 })
  expect(html).toContain('Ärende open')
  expect(html).not.toContain('Ärende other')
  expect(html).toContain('Visa alla supportärenden')
  expect(html).not.toContain('<form')
})
it('keeps a well-formed unmatched customer filter without widening the queue', async () => {
  io.list.mockResolvedValue([])
  const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer: otherCustomerId }) }))
  expect(io.list).toHaveBeenCalledTimes(1)
  expect(io.list).toHaveBeenCalledWith({ companyId: 'company-a', customerId: otherCustomerId, supportOnly: true, limit: 200 })
  expect(html).toContain('Inga öppna supportärenden')
  expect(html).not.toContain('Ärende open')
})
it.each([{ customer: 'invalid' }, { customer: '' }, { customer: [selectedCustomerId, otherCustomerId] }])(
  'rejects the malformed or ambiguous selector $customer without broad reads', async ({ customer }) => {
    const html = renderToStaticMarkup(await CasesPage({ searchParams: Promise.resolve({ customer }) }))
    expect(io.list).not.toHaveBeenCalled()
    expect(html).toContain('Kunden kunde inte väljas.')
    expect(html).toContain('Visa alla supportärenden')
  },
)
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
  expect(io.detail).toHaveBeenCalledWith(activeCaseId, 'company-a')
  expect(io.eventRead).toHaveBeenCalledWith(activeCaseId, 'company-a')
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
const blockedUnderlay = {
  id: 'underlay', customer_id: 'customer', underlay_year: 2026, underlay_month: 10,
  readiness_status: 'blocked', billing_block_reason: 'RAW_TECHNICAL_BLOCKER',
} as unknown as BillingUnderlayRow
const foreignUnderlay: BillingUnderlayRow = {
  ...blockedUnderlay, id: 'foreign-underlay', customer_id: 'other-customer', underlay_month: 11,
}

it('calculates billing summary on the server and keeps raw blocker evidence out of company HTML', () => {
  const source = fs.readFileSync('components/admin/customers/CustomerBillingMeteringCard.tsx', 'utf8')
  expect(source).not.toMatch(/['"]use client['"]/)
  const props = { customerId: 'customer', sites: [], meteringPoints: [], gridOwners: [], dataRequests: [], meteringValues: [], outboundRequests: [], partnerExports: [], billingUnderlays: [blockedUnderlay, foreignUnderlay] }
  const html = renderToStaticMarkup(React.createElement(BillingCard, { ...props, canReadBilling: true }))
  expect(html).toContain('Kräver åtgärd')
  expect(html).toContain('2026-10')
  expect(html).not.toContain('2026-11')
  expect(html).not.toContain('RAW_TECHNICAL_BLOCKER')
  expect(html).toContain('href="/admin/billing?customer=customer&amp;month=2026-10"')
  const restricted = renderToStaticMarkup(React.createElement(BillingCard, { ...props, canReadBilling: false }))
  expect(restricted).toContain('Kräver åtgärd')
  expect(restricted).not.toContain('/admin/billing?')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/billing-summary-company.html`, `<main>${html}</main>`)
})

it('retains platform blocker evidence inside a closed disclosure', () => {
  const html = renderToStaticMarkup(React.createElement(BillingCard, { customerId: 'customer', isPlatformAdmin: true, sites: [], meteringPoints: [], gridOwners: [], dataRequests: [], meteringValues: [], outboundRequests: [], partnerExports: [], billingUnderlays: [blockedUnderlay, foreignUnderlay] }))
  expect(html).toContain('RAW_TECHNICAL_BLOCKER')
  expect(html).toContain('2026-10')
  expect(html).not.toContain('2026-11')
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
