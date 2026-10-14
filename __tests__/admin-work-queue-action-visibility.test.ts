import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  queue: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'synthetic-operator', email: 'operator@example.test', permissions: [] }),
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: async () => ({ companyId: 'synthetic-company', companyName: 'Testbolag' }),
  isMissingRelationError: () => false,
}))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => ({ companyId: 'synthetic-company', companyName: 'Testbolag', isPlatformAdmin: false }) }))
vi.mock('@/lib/performance/companySummaries', () => ({ listCompanyWorkQueue: async () => io.queue }))
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async () => new Map() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query },
        not: () => query,
        or: (filter: string) => {
          const terminal = filter.match(/^status\.is\.null,status\.not\.in\.\(([^)]*)\)$/)?.[1].split(',')
          if (terminal) filters.push(row => row.status === null || row.status === undefined || !terminal.includes(String(row.status)))
          return query
        },
        order: () => query,
        limit: () => query,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: (io.tables[table] ?? []).filter(row => filters.every(filter => filter(row))), error: null,
        }).then(resolve),
      }
      return query
    },
  }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children),
}))

import WorkQueuePage from '@/app/admin/work-queue/page'

const customer = {
  id: 'synthetic-customer', company_id: 'synthetic-company', customer_number: 'TEST-1',
  full_name: 'Syntetisk kund', first_name: null, last_name: null, company_name: null,
  email: 'customer@example.test', status: 'active', source: 'manual', created_at: '2026-10-13T10:00:00Z',
}
const base = {
  id: 'synthetic-action', company_id: 'synthetic-company', customer_id: customer.id,
  operation_id: 'synthetic-operation', created_at: '2026-10-13T10:00:00Z',
}

beforeEach(() => {
  io.tables = { customers: [customer] }
  io.queue = []
  vi.stubGlobal('React', React)
})

it.each(['needs_review', 'future_review_status'])('shows an explicitly actionable %s event instead of silently dropping it', async status => {
  io.tables.customer_operation_events = [{
    ...base, status, action_required: true, title: 'Kontrollera kundens startdatum', message: 'Kunden behöver komplettera startdatum.',
    severity: 'warning', action_url: `/admin/customers/${customer.id}?tab=supplier-switch`, occurred_at: base.created_at,
  }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain('Kontrollera kundens startdatum')
  expect(html).toContain(`href="/admin/customers/${customer.id}?tab=supplier-switch"`)
  expect(html).not.toContain('Inga aktiva driftuppgifter hittades')
})

it('shows a needs-review job when no corresponding event exists', async () => {
  io.tables.customer_operation_jobs = [{ ...base, status: 'needs_review', job_type: 'supplier_switch', last_error: 'Startdatum behöver granskas.' }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain('Startdatum behöver granskas.')
  expect(html).toContain('Behöver granskning')
  expect(html).toContain(`href="/admin/customers/${customer.id}"`)
})

it('holds a new job status for review instead of excluding it before classification', async () => {
  io.tables.customer_operation_jobs = [{ ...base, status: 'future_job_review', job_type: 'supplier_switch', last_error: 'Oklassificerat arbete behöver granskas.' }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain('Oklassificerat arbete behöver granskas.')
  expect(html).not.toContain('future_job_review')
})

it.each([
  ['blocked_missing_poa', 'Fullmakt saknas'],
  ['blocked_missing_grid_owner_contact', 'Kontaktväg saknas'],
  ['blocked_missing_manual_mailbox', 'Avsändaradress saknas'],
])('keeps a persisted %s manual request visible with its business explanation', async (status, label) => {
  io.tables.grid_owner_information_requests = [{ ...base, status, dispatch_status: 'blocked', dispatch_error_message: label, outbound_request_id: null, ediel_message_id: null }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain(label)
  expect(html).not.toContain(status)
  expect(html).toContain(`href="/admin/customers/${customer.id}?tab=data-requests"`)
})

it.each(['future_manual_review', null])('reads a manual request with unclassified status %s before deciding whether it needs action', async status => {
  io.tables.grid_owner_information_requests = [{ ...base, status, dispatch_status: null, dispatch_error_message: 'Begäran behöver granskas.', outbound_request_id: null, ediel_message_id: null }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain('Begäran behöver granskas.')
  expect(html).toContain('Nätägarbegäran behöver granskning')
  if (status) expect(html).not.toContain(status)
})

it.each(['future_info_review', null])('reads an information request with unclassified status %s before deciding whether it needs action', async status => {
  io.tables.customer_info_requests = [{ ...base, status, request_type: 'z01_customer_masterdata', target_party_type: 'grid_owner', blocker_reason: 'Uppgiftsbegäran behöver granskas.', ediel_message_id: null }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain('Uppgiftsbegäran behöver granskas.')
  expect(html).toContain('Uppgiftsbegäran behöver åtgärd')
  if (status) expect(html).not.toContain(status)
})

it.each([
  ['negative_aperak', 'Mottagaren avvisade begäran'],
  ['missing_binding_info', 'Bindningstid saknas'],
  ['missing_termination_info', 'Uppsägningsinfo saknas'],
  ['ready_for_switch', 'Redo för leverantörsbyte'],
  ['process_decision_missing', 'Nästa steg behöver kontrolleras'],
  ['process_response_received', 'Svar mottaget'],
])('renders supported actionable %s as Swedish operator text', async (status, label) => {
  io.queue = [{
    id: 'synthetic-rpc-row', companyId: base.company_id, customerId: customer.id, customerLabel: customer.full_name,
    source: 'Uppgiftsbegäran', title: 'Kontrollera kunduppgifter', description: 'Syntetiskt underlag', status,
    priority: 'normal', createdAt: base.created_at, href: `/admin/customers/${customer.id}`, actionLabel: 'Öppna kundkort',
  }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain(label)
  expect(html).not.toContain(status)
})

it('keeps an ordinary waiting step out of the manual action queue', async () => {
  io.queue = [{
    id: 'synthetic-waiting', companyId: base.company_id, customerId: customer.id, customerLabel: customer.full_name,
    source: 'Uppgiftsbegäran', title: 'Invänta nätägarens svar', description: 'Begäran är skickad.', status: 'waiting_response',
    priority: 'normal', createdAt: base.created_at, href: `/admin/customers/${customer.id}`, actionLabel: 'Öppna kundkort',
  }]
  const html = renderToStaticMarkup(await WorkQueuePage())
  expect(html).toContain('Inga aktiva driftuppgifter hittades')
  expect(html).not.toContain('Invänta nätägarens svar')
})
