import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  context: { userId: 'actor', email: 'operator@example.invalid', permissions: ['communication.read', 'cases.read'], roles: ['operations'], isPlatformAdmin: false, companyId: 'company-a' },
  scope: { companyId: 'company-a', companyName: 'Bolag A', isPlatformAdmin: false },
  rows: [] as Record<string, unknown>[],
  counts: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}))

vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => io.context }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminTenantReadScope: async () => io.scope }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: io.scope.companyId, companyName: io.scope.companyName }) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: (table: string) => ({
    select: (_columns: string, options?: { head?: boolean }) => {
      const filters: Array<[string, unknown]> = []
      const query = {
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query },
        in: (column: string, value: unknown) => { filters.push([column, value]); return query },
        neq: (column: string, value: unknown) => { filters.push([column, value]); return query },
        is: (column: string, value: unknown) => { filters.push([column, value]); return query },
        limit: () => query,
        order: () => query,
        then: (resolve: (result: unknown) => unknown) => {
          if (options?.head) {
            io.counts.push({ table, filters })
            return Promise.resolve(resolve({ count: table === 'customer_cases' ? 2 : 0, error: null }))
          }
          return Promise.resolve(resolve({ data: table === 'customer_cases' ? io.rows.filter((row) => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)) : [], error: null }))
        },
      }
      return query
    },
  }) },
}))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, title) }))

describe('Ediel operational cases at the actual Control Tower entry', () => {
  beforeEach(() => {
    io.scope.companyId = 'company-a'
    io.context.permissions = ['communication.read', 'cases.read']
    io.rows = [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', company_id: 'company-a', title: 'Granska oväntat PRODAT', source: 'ediel_inbound_state_machine', status: 'open', priority: 'high', created_at: '2026-09-23T10:00:00Z', reason_category: 'ediel_unexpected_direction' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', company_id: 'company-a', title: 'Supportfråga', source: 'tenant_support_web', status: 'open', priority: 'normal', created_at: '2026-09-23T09:00:00Z' },
    ]
    io.counts = []
  })

  it('links the actual Ediel row to its exact case and counts that source cohort separately', async () => {
    const { default: Page } = await import('@/app/admin/controltower/page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('/admin/ediel/operational-cases?caseId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    expect(html).toContain('Öppna Ediel-ärenden')
    expect(io.counts.some(({ table, filters }) => table === 'customer_cases' && filters.some(([key, value]) => key === 'source' && value === 'ediel_inbound_state_machine'))).toBe(true)
    expect(html).not.toMatch(/href="\/admin\/customer-cases"[^>]*>[^<]*Granska oväntat PRODAT/)
  })

  it('does not offer an Ediel detail link to a Control Tower reader without case access', async () => {
    io.context.permissions = ['communication.read']
    const { default: Page } = await import('@/app/admin/controltower/page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Granska oväntat PRODAT')
    expect(html).not.toContain('caseId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  })

  it('does not run unscoped service queries when a tenant has no selected company', async () => {
    io.scope.companyId = null as never
    const { default: Page } = await import('@/app/admin/controltower/page')
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Bolagskoppling saknas')
    expect(io.counts).toHaveLength(0)
  })
})
