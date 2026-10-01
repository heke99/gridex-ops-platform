import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const fixture = vi.hoisted(() => ({
  error: null as null | { code: string; message: string; digest?: string },
  reads: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}))
vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageKeyAccess: async () => ({ userId: 'actor-a', companyId: 'company-a', isPlatformAdmin: false }),
  isPlatformAdminContext: () => false,
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'actor-a' } } }) } }),
}))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: 'company-a' }) }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: { from: (table: string) => {
    const filters: Record<string, unknown> = {}
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query },
      order: () => query,
      limit: () => query,
      gte: (key: string, value: unknown) => { filters[key + '__gte'] = value; return query },
      lt: (key: string, value: unknown) => { filters[key + '__lt'] = value; return query },
      then: (resolve: (value: unknown) => void) => {
        fixture.reads.push({ table, filters: { ...filters } })
        return Promise.resolve({ data: [], error: fixture.error }).then(resolve)
      },
    }
    return query
  } },
}))

import { GET } from '@/app/admin/analytics/export/route'
import { getReportRows } from '@/lib/analytics/db'
const exportReport = () => GET(new NextRequest('http://localhost/admin/analytics/export?report=company_monthly_metrics&month=2026-09'))

describe('actual analytics attachment outcome through the actual report data helper', () => {
  beforeEach(() => { fixture.error = null; fixture.reads = [] })

  it('retains a legitimate empty scoped report as a successful empty CSV attachment', async () => {
    const response = await exportReport()
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('status\nInga rader')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="analytics-company_monthly_metrics-2026-09.csv"')
    expect(fixture.reads).toEqual([{ table: 'company_monthly_metrics', filters: { company_id: 'company-a', month: '2026-09-01' } }])
  })

  it.each([
    { code: 'PGRST205', message: 'Could not find private_relation_xyz in the schema cache PRIVATE_EXPORT' },
    { code: '42501', message: 'permission denied PRIVATE_EXPORT company-b' },
  ])('returns an explicit safe unavailable outcome for $code instead of a successful empty attachment', async error => {
    fixture.error = error
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const response = await exportReport()
      expect(response.status).toBe(500)
      expect(response.headers.get('content-disposition')).toBeNull()
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.text()
      expect(body).toBe('Kunde inte skapa rapportfil.')
      expect(body).not.toMatch(/PRIVATE_EXPORT|private_relation_xyz|company-b|Inga rader/)
      expect(fixture.reads).toHaveLength(1)
    } finally { log.mockRestore() }
  })

  it.each([
    'company_monthly_metrics', 'bidding_zone_metrics', 'grid_owner_metrics', 'missing_metering_values',
    'data_quality_issues', 'customer_monthly_metrics', 'metering_points_by_grid_owner', 'forecast_run_items',
  ])('requires an available source for the concrete report branch %s', async report => {
    fixture.error = { code: 'PGRST205', message: 'Could not find PRIVATE_REPORT_SOURCE in the schema cache' }
    const response = await GET(new NextRequest(`http://localhost/admin/analytics/export?report=${report}&month=2026-09`))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Kunde inte skapa rapportfil.')
    expect(response.headers.get('content-disposition')).toBeNull()
    expect(fixture.reads).toHaveLength(1)
    expect(fixture.reads[0].filters.company_id).toBe('company-a')
  })

  it('preserves the ordinary workspace missing-schema fallback when a strict attachment is not requested', async () => {
    fixture.error = { code: 'PGRST205', message: 'Could not find private_relation_xyz in the schema cache' }
    await expect(getReportRows('company-a', 'company_monthly_metrics', '2026-09')).resolves.toEqual([])
    expect(fixture.reads).toHaveLength(1)
  })

  it('preserves actual Next control flow rather than changing it into a file failure', async () => {
    fixture.error = { code: '', message: 'NEXT_REDIRECT', digest: 'NEXT_REDIRECT;push;/admin;307;' }
    await expect(exportReport()).rejects.toBe(fixture.error)
  })
})
