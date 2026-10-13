import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  platform: false,
  companyId: 'guard-A' as string | null | undefined,
  legacy: vi.fn(),
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}))

const context = () => ({
  userId: 'operator', email: 'operator@example.invalid', roles: [], permissions: ['users.read'],
  isAdmin: true, isPlatformAdmin: io.platform, companyId: io.companyId,
})

vi.mock('@/lib/admin/guards', () => ({
  requireAdminAccess: async () => ({
    userId: 'operator', email: 'operator@example.invalid', roles: [], permissions: ['users.read'],
    isAdmin: true, isPlatformAdmin: io.platform, companyId: io.companyId,
  }),
  isPlatformAdminContext: (admin: { isPlatformAdmin?: boolean }) => admin.isPlatformAdmin === true,
}))
vi.mock('@/lib/tenant/scope', () => ({
  getOperationalCompanyScope: io.legacy,
  isMissingRelationError: () => false,
  TENANT_COMPANY_REQUIRED_MESSAGE: 'Bolag saknas',
  TenantCompanyRequiredError: class extends Error {},
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const read = { table, filters: [] as Array<[string, unknown]> }
    io.reads.push(read)
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query },
      maybeSingle: async () => {
        const id = read.filters.find(([key]) => key === 'id')?.[1]
        return { data: {
          id, name: id === 'guard-A' ? 'Bolag A' : 'Legacybolag B',
          ediel_production_status: id === 'guard-A' ? 'live' : 'test',
          ediel_production_enabled: id === 'guard-A', live_ediel_enabled: id === 'guard-A',
          live_approved_at: id === 'guard-A' ? '2026-10-13T00:00:00Z' : null,
        }, error: null }
      },
    }
    return query
  },
} }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'company_view' }) }) }))
vi.mock('@/lib/auth/logoutAction', () => ({ logoutAction: async () => undefined }))
vi.mock('@/components/admin/AdminSidebar', () => ({
  default: ({ workspaceName, isCompanyLiveEnabled, selectedCompanyId }: {
    workspaceName: string; isCompanyLiveEnabled: boolean; selectedCompanyId: string | null
  }) => React.createElement('nav', {
    'data-live-enabled': String(isCompanyLiveEnabled), 'data-selected-company': selectedCompanyId ?? '',
  }, workspaceName),
}))

import { resolveAdminSelectedCompanyReadScope, resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { TenantCompanyRequiredError } from '@/lib/tenant/scope'
import { getTenantLiveAccessForAdmin } from '@/lib/tenant/liveAccess'
import AdminLayout from '@/app/admin/layout'

beforeEach(() => {
  io.platform = false
  io.companyId = 'guard-A'
  io.reads = []
  io.legacy.mockReset().mockResolvedValue({
    companyId: 'legacy-B', companyName: 'Legacybolag B', memberships: [],
    message: null, requiresCompany: false,
  })
  vi.stubGlobal('React', React)
})

it('uses an explicit canonical selected company without a membership fallback', async () => {
  expect(await resolveAdminSelectedCompanyReadScope(context())).toMatchObject({ companyId: 'guard-A' })
  expect(io.legacy).not.toHaveBeenCalled()
})

it('rejects an explicit null tenant company before a selected read can become global', async () => {
  io.companyId = null
  await expect(resolveAdminSelectedCompanyReadScope(context())).rejects.toBeInstanceOf(TenantCompanyRequiredError)
  expect(io.legacy).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it('preserves authoritative null for callers with an explicit empty-state or HTTP refusal', async () => {
  io.companyId = null
  expect(await resolveAdminSelectedCompanyReadScope(context(), { allowMissing: true })).toMatchObject({ companyId: null })
  expect(io.legacy).not.toHaveBeenCalled()
  expect(io.reads).toEqual([])
})

it.each(['guard-A', null])('keeps the platform canonical selection %s authoritative', async companyId => {
  io.platform = true
  io.companyId = companyId
  expect(await resolveAdminSelectedCompanyReadScope(context())).toMatchObject({ companyId, isPlatformAdmin: true })
  expect(io.legacy).not.toHaveBeenCalled()
})

it('retains the operational fallback only for an older context without a canonical field', async () => {
  io.companyId = undefined
  expect(await resolveAdminSelectedCompanyReadScope(context())).toMatchObject({ companyId: 'legacy-B' })
  expect(io.legacy).toHaveBeenCalledOnce()
})

it('reads the live flag for the guard company and frames the actual tenant shell consistently', async () => {
  const live = await getTenantLiveAccessForAdmin(context())
  expect(live).toMatchObject({ companyId: 'guard-A', companyName: 'Bolag A', canUseLiveEdiel: true })
  const html = renderToStaticMarkup(await AdminLayout({ children: React.createElement('p', null, 'Arbetskö') }))
  expect(html).toContain('Bolag A')
  expect(html).toContain('data-live-enabled="true"')
  expect(html).not.toContain('Legacybolag B')
  expect(io.reads.every(read => read.filters.some(([key, value]) => key === 'id' && value === 'guard-A'))).toBe(true)
})

it('fails the live gate closed for an explicit null tenant company', async () => {
  io.companyId = null
  await expect(getTenantLiveAccessForAdmin(context())).rejects.toBeInstanceOf(TenantCompanyRequiredError)
  expect(io.reads).toEqual([])
})

it('renders the friendly empty shell without data for an explicit null tenant company', async () => {
  io.companyId = null
  const html = renderToStaticMarkup(await AdminLayout({ children: null }))
  expect(html).toContain('Inget aktivt bolag')
  expect(html).toContain('Bolag saknas')
  expect(io.reads).toEqual([])
})

it('does not depend on a legacy membership lookup when the global-read guard already identifies a tenant', async () => {
  io.legacy.mockRejectedValue(new Error('legacy_membership_unavailable'))
  expect(await resolveAdminTenantReadScope(context())).toMatchObject({ companyId: 'guard-A' })
  expect(io.legacy).not.toHaveBeenCalled()
})

it('keeps platform live access global without reading a tenant live flag', async () => {
  io.platform = true
  io.companyId = null
  expect(await getTenantLiveAccessForAdmin(context())).toMatchObject({ companyId: null, canUseLiveEdiel: true })
  expect(io.reads).toEqual([])
})

it.each(['guard-A', null])('keeps the actual platform company-view selection %s canonical', async companyId => {
  io.platform = true
  io.companyId = companyId
  const html = renderToStaticMarkup(await AdminLayout({ children: null }))
  expect(html).toContain(`data-selected-company="${companyId ?? ''}"`)
  expect(html).not.toContain('Legacybolag B')
  expect(io.reads).toEqual([])
})
