import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  context: { userId: 'actor', email: 'operator@example.invalid', permissions: ['cases.read', 'customers.read'], roles: ['operations'], isPlatformAdmin: false, companyId: 'company-a' },
  scope: { companyId: 'company-a' as string | null, companyName: 'Bolag A', isPlatformAdmin: false },
  cases: [] as Array<typeof caseA>,
  calls: [] as string[],
  events: [{ id: 'event-a', company_id: 'company-a', message: 'Granskning skapad', created_at: '2026-09-23T10:00:00Z', event_type: 'created', event_status: 'info' }],
  sourceCompany: 'company-a', customerCompany: 'company-a',
}))

vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async (key: string) => { io.calls.push(`guard:${key}`); return io.context } }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => io.scope }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: io.scope.companyId, memberships: [{ companyId: 'company-a', status: 'active', companyStatus: 'active' }] }) }))
vi.mock('@/lib/customer-cases/db', () => ({
  listCustomerCases: async (options: Record<string, unknown>) => { io.calls.push(`list:${JSON.stringify(options)}`); return io.cases.filter((row) => row.source === options.source && (!options.companyId || row.company_id === options.companyId) && (!Array.isArray(options.statuses) || options.statuses.includes(row.status))).slice(Number(options.offset ?? 0), Number(options.offset ?? 0) + Number(options.limit ?? 200)) },
  getCustomerCaseById: async (id: string, companyId: string | null) => { io.calls.push(`case:${id}:${companyId}`); return io.cases.find((row) => row.id === id && (!companyId || row.company_id === companyId)) ?? null },
  listCustomerCaseEvents: async (id: string, companyId: string | null) => { io.calls.push(`events:${id}:${companyId}`); return io.events },
  customerCaseStatusLabel: (value: string) => value,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => ({
  select: () => {
    const filters: Record<string, string> = {}
    const query = { eq: (key: string, value: string) => { filters[key] = value; return query }, maybeSingle: async () => {
      io.calls.push(`${table}:${JSON.stringify(filters)}`)
      return { data: filters.company_id === (table === 'ediel_messages' ? io.sourceCompany : io.customerCompany) ? { id: filters.id, company_id: filters.company_id } : null, error: null }
    } }
    return query
  },
}) } }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))
vi.mock('next/navigation', async (original) => ({ ...(await original()), notFound: () => { throw new Error('not-found') } }))

const caseA = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: 'company-a', customer_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', source: 'ediel_inbound_state_machine', title: 'Granska oväntat PRODAT', description: 'Fullständig beskrivning av inkommande meddelande', next_action: 'Kontrollera avsändarens riktning', reason_category: 'ediel_unexpected_direction', metadata: { review_intent: 'ediel_unexpected_direction', source_ediel_message_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, status: 'open', priority: 'high', created_at: '2026-09-23T10:00:00Z', updated_at: '2026-09-23T10:00:00Z' }

describe('dedicated Ediel case route', () => {
  beforeEach(() => {
    io.context.permissions = ['cases.read', 'customers.read']
    io.context.isPlatformAdmin = false
    io.scope = { companyId: 'company-a', companyName: 'Bolag A', isPlatformAdmin: false }
    io.cases = [caseA, { ...caseA, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', company_id: 'company-b', title: 'Hemligt B' }]
    io.calls = []
    io.sourceCompany = 'company-a'
    io.customerCompany = 'company-a'
  })

  it('reads exact ID independently of the list window and shows typed intent, full instructions and events', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(io.calls).toContain(`case:${caseA.id}:company-a`)
    expect(io.calls).toContain(`events:${caseA.id}:company-a`)
    expect(html).toContain('ediel_unexpected_direction')
    expect(html).toContain(caseA.description)
    expect(html).toContain(caseA.next_action)
    expect(html).toContain('Granskning skapad')
    expect(html).toContain(`/admin/customers/${caseA.customer_id}`)
    expect(html).not.toContain(`/admin/ediel/messages/${caseA.metadata.source_ediel_message_id}`)
  })

  it('rejects cross-company and non-Ediel exact IDs before reading events or references', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    await expect(Page({ searchParams: Promise.resolve({ caseId: io.cases[1].id }) })).rejects.toThrow('not-found')
    io.cases[0] = { ...caseA, source: 'tenant_support_web' }
    await expect(Page({ searchParams: Promise.resolve({ caseId: caseA.id }) })).rejects.toThrow('not-found')
    expect(io.calls).not.toContain(`events:${caseA.id}:company-a`)
    expect(io.calls.some((entry) => entry.startsWith('ediel_messages:'))).toBe(false)
  })

  it('makes no service reads with missing tenant scope; platform can read but has no status form', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    io.scope.companyId = null
    const empty = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(empty).toContain('Bolagskoppling saknas')
    expect(io.calls).toEqual(['guard:customer.cases'])
    io.scope.isPlatformAdmin = true
    io.context.isPlatformAdmin = true
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(html).toContain(caseA.description)
    expect(html).toContain(`/admin/ediel/messages/${caseA.metadata.source_ediel_message_id}`)
    expect(html).not.toContain('name="status"')
  })

  it('does not link a source/customer in another company', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    io.sourceCompany = 'company-b'
    io.customerCompany = 'company-b'
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(html).not.toContain(`/admin/customers/${caseA.customer_id}`)
    expect(html).not.toContain(`/admin/ediel/messages/${caseA.metadata.source_ediel_message_id}`)
  })

  it('shows status triage only to a writable selected-company cases writer', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    io.context.permissions = ['cases.read', 'cases.write']
    const writable = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(writable).toContain('name="status"')
    io.context.permissions = ['cases.read']
    const readonly = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(readonly).not.toContain('name="status"')
  })

  it('matches the open card with a DB-filtered exception cohort and never silently reopens an unsupported current status', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    await Page({ searchParams: Promise.resolve({ view: 'exceptions' }) })
    expect(io.calls.some((entry) => entry.startsWith('list:') && entry.includes('"statuses":["open","action_required","awaiting_external_response","billing_blocked","manual_follow_up"]'))).toBe(true)
    io.context.permissions = ['cases.read', 'cases.write']
    io.cases[0] = { ...caseA, status: 'billing_blocked' }
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ caseId: caseA.id }) }))
    expect(html).toContain('Aktuell status: billing_blocked')
    expect(html).toContain('<option value="" disabled="" selected="">Välj ny status</option>')
  })

  it('reaches more than 200 open Ediel cases through deterministic page links and preserves the exception view on exact detail', async () => {
    const { default: Page } = await import('@/app/admin/ediel/operational-cases/page')
    io.cases = Array.from({ length: 202 }, (_, index) => ({ ...caseA, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, '0')}`, title: `Ediel cohort ${index + 1}` }))
    const first = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view: 'exceptions' }) }))
    expect(first).toContain('/admin/ediel/operational-cases?view=exceptions&amp;page=2')
    expect(first).not.toContain('Ediel cohort 202')
    const second = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ view: 'exceptions', page: '2', caseId: io.cases[201].id }) }))
    expect(io.calls.some((entry) => entry.includes('"offset":200') && entry.includes('"limit":201'))).toBe(true)
    expect(second).toContain('Ediel cohort 202')
    expect(second).toContain(`caseId=${io.cases[201].id}&amp;view=exceptions&amp;page=2`)
    expect(second).toContain('/admin/ediel/operational-cases?view=exceptions&amp;page=1')
    await expect(Page({ searchParams: Promise.resolve({ view: 'exceptions', page: '0' }) })).rejects.toThrow('not-found')
    await expect(Page({ searchParams: Promise.resolve({ view: 'exceptions', page: 'garbage' }) })).rejects.toThrow('not-found')
  })
})
