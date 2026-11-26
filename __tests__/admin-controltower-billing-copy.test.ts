import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ tables: {} as Record<string, Array<Record<string, unknown>>>, permissions: [] as string[] }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/lib/admin/guards', async () => {
  const { hasPermissionRequirement } = await import('@/lib/admin/accessModel')
  const requireFixtureAccess = (requirement: Parameters<typeof hasPermissionRequirement>[1]) => {
    if (!hasPermissionRequirement(io.permissions, requirement)) throw new Error('Forbidden')
  }
  return {
    isPlatformAdminContext: () => false,
    requireAdminActionAccess: async (requirement: Parameters<typeof hasPermissionRequirement>[1]) => requireFixtureAccess(requirement),
    requireCompanyScopedActionAccess: async (companyId: string, requirement: Parameters<typeof hasPermissionRequirement>[1]) => {
      if (companyId !== 'synthetic-company') throw new Error('Forbidden')
      requireFixtureAccess(requirement)
    },
    requireAdminPageKeyAccess: async () => ({ userId: 'synthetic-operator', email: 'operator@example.test', permissions: io.permissions }),
  }
})
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminTenantReadScope: async () => ({ companyId: 'synthetic-company', isPlatformAdmin: false }),
  resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'synthetic-company', isPlatformAdmin: false }),
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: 'synthetic-company', companyName: 'Testbolag' }), isMissingRelationError: () => false }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-operator' } } }) } }) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const filters: Array<(row: Record<string, unknown>) => boolean> = []
      let start = 0
      let end = Number.POSITIVE_INFINITY
      const query = {
        select: () => query,
        range: (from: number, to: number) => { start = from; end = to; return query },
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
        neq: () => query, is: () => query,
        in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query },
        order: () => query, limit: () => query,
        maybeSingle: async () => ({
          data: (io.tables[table] ?? []).find(row => filters.every(filter => filter(row))) ?? null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) => {
          const data = (io.tables[table] ?? []).filter(row => filters.every(filter => filter(row)))
          return Promise.resolve({ data: data.slice(start, end + 1), count: data.length, error: null }).then(resolve)
        },
      }
      return query
    },
  },
}))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
vi.mock('@/app/admin/controltower/actions', () => ({ createControlTowerCasesAction: vi.fn(), resolveControlTowerQueueItemAction: vi.fn(), runControlTowerPeriodMotorAction: vi.fn() }))

import ControlTowerPage from '@/app/admin/controltower/page'
import UnderlaysPage from '@/app/admin/billing/underlays/page'
import UnderlayDetailPage from '@/app/admin/billing/underlays/[id]/page'

function visibleText(html: string) { return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ') }
beforeEach(() => { io.tables = { companies: [{ id: 'synthetic-company', status: 'active' }] }; io.permissions = ['cases.read', 'cases.write']; vi.stubGlobal('React', React) })

it('describes an actionable case and task with Swedish priority and status', async () => {
  io.tables.customer_cases = [{
    id: 'synthetic-case', company_id: 'synthetic-company', customer_id: 'synthetic-customer', title: 'Följ upp nätägaren',
    status: 'awaiting_external_response', priority: 'high', reason_category: 'missing_authorization', source: 'tenant_support_admin', metadata: { support_case: true }, created_at: '2026-10-13T10:00:00Z',
  }]
  io.tables.customer_operation_tasks = [{ id: 'synthetic-task', company_id: 'synthetic-company', customer_id: 'synthetic-customer', title: 'Granska fullmakten', status: 'pending_review', priority: 'normal', created_at: '2026-10-13T10:00:00Z' }]
  const text = visibleText(renderToStaticMarkup(await ControlTowerPage({ searchParams: Promise.resolve({}) })))
  expect(text).toContain('Hög')
  expect(text).toContain('Väntar på externt svar')
  expect(text).toContain('Normal')
  expect(text).toContain('Väntar på granskning')
  expect(text).not.toContain('awaiting_external_response')
  expect(text).not.toContain('pending_review')
  expect(text).not.toContain('missing_authorization')
})

it('translates underlay readiness and pricing-run status in the real list and detail views', async () => {
  io.tables.billing_underlays = [{ id: 'synthetic-underlay', company_id: 'synthetic-company', status: 'validated', readiness_status: 'ready', underlay_year: 2026, underlay_month: 10, total_kwh: 10, price_area: 'SE3', calculated_total_sek_inc_vat: 20 }]
  io.tables.billing_underlay_items = [{ id: 'synthetic-item', company_id: 'synthetic-company', billing_underlay_id: 'synthetic-underlay', status: 'incomplete', quantity_kwh: 10 }]
  io.tables.pricing_runs = [{ id: 'synthetic-run', company_id: 'synthetic-company', billing_underlay_id: 'synthetic-underlay', status: 'success', total_inc_vat: 20, total_ex_vat: 16, vat_amount: 4 }]
  const list = visibleText(renderToStaticMarkup(await UnderlaysPage()))
  const detail = visibleText(renderToStaticMarkup(await UnderlayDetailPage({ params: Promise.resolve({ id: 'synthetic-underlay' }) })))
  expect(list).toContain('Validerat / Redo')
  expect(list).not.toContain('validated / ready')
  expect(detail).toContain('Validerat')
  expect(detail).toContain('Ofullständig')
  expect(detail).toContain('Klar')
  expect(detail).not.toContain('incomplete')
  expect(detail).not.toContain('success')
})


it('routes a blocked billing item to its own underlay and keeps other scoped queue actions', async () => {
  const underlay = 'a1010000-0000-4000-8000-000000000061'
  io.tables.gridex_batch_2c_drift_queue_v = [
    { queue_type: 'billing_export_item', company_id: 'synthetic-company',
      source_id: 'billing-item', title: 'Blockerad fakturarad', payload: { billing_underlay_id: underlay } },
    { queue_type: 'customer_case', company_id: 'synthetic-company', source_id: 'case-item', title: 'Annat kundärende' },
    { queue_type: 'billing_export_item', company_id: 'other-company',
      source_id: 'foreign-billing-item', title: 'Främmande faktura', payload: { billing_underlay_id: underlay } },
  ]
  const view = async () => renderToStaticMarkup(await ControlTowerPage({ searchParams: Promise.resolve({}) }))
  const reader = await view()
  expect(reader).not.toContain(underlay)
  expect(reader).toContain('Blockeringen hanteras i faktureringen.')
  io.permissions.push('billing_underlay.read')
  const operator = await view()
  expect(operator).toContain(`href="/admin/billing/underlays/${underlay}"`)
  expect(operator).not.toContain('name="queue_type" value="billing_export_item"')
  expect(operator).toContain('name="queue_type" value="customer_case"')
  expect(operator).not.toContain('Främmande faktura')
})
