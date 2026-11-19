import type { getOpsHealth, OpsHealthRow } from '@/lib/ops/health'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type HealthSnapshot = Awaited<ReturnType<typeof getOpsHealth>>

const io = vi.hoisted(() => ({
  health: vi.fn<() => Promise<HealthSnapshot>>(),
  platform: true,
}))

vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/lib/admin/guards', () => ({
  isPlatformAdminContext: () => io.platform,
  requireAdminPageAccess: async () => ({ email: 'operator@example.invalid' }),
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminTenantReadScope: async () => ({ companyId: io.platform ? null : 'synthetic-company', companyName: 'Testbolag' }),
}))
vi.mock('@/lib/launch/readiness', () => ({ humanizeLaunchError: () => 'Fel', safeCount: async () => 0 }))
vi.mock('@/lib/ops/reconciliation', () => ({
  runProductionConsistencyChecks: async () => ({ checks: [], criticalCount: 0, warningCount: 0 }),
}))
vi.mock('@/lib/ops/health', () => ({ getOpsHealth: io.health }))
vi.mock('@/app/admin/system-health/actions', () => ({ requeueUncertainEmailAction: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      }
      return query
    },
  },
}))

import SystemHealthPage from '@/app/admin/system-health/page'

const observedSpot: OpsHealthRow = {
  check_key: 'spot_current_day_missing',
  status: 'ok',
  issue_count: 0,
  details: { expected_areas: 4 },
}
const blockedSpot: OpsHealthRow = {
  check_key: 'spot_preview_stale',
  status: 'blocking',
  issue_count: 2,
}
const internalBlocker: OpsHealthRow = {
  check_key: 'ops_health_schema',
  status: 'blocking',
  issue_count: 1,
  details: { code: 'synthetic-private-diagnostic' },
}

async function renderMarketHealth() {
  const html = renderToStaticMarkup(await SystemHealthPage())
  const start = html.indexOf('Marknadspris och tenant-API')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

beforeEach(() => {
  io.platform = true
  io.health.mockReset()
})

describe('admin market health presentation', () => {
  it('shows the current individual spot result without a coverage notice on a complete v5 snapshot', async () => {
    io.health.mockResolvedValue({ checkVersion: 'v5', schemaReady: true, rows: [observedSpot] })
    const section = await renderMarketHealth()
    expect(section).toContain('spot_current_day_missing')
    expect(section).toContain('border-emerald-200')
    expect(section).not.toContain('role="status"')
  })

  it('identifies the older snapshot and makes OK observations neutral while retaining blocking readings', async () => {
    io.health.mockResolvedValue({ checkVersion: 'v4', schemaReady: true, rows: [observedSpot, blockedSpot] })
    const section = await renderMarketHealth()
    expect(section).toContain('role="status"')
    expect(section).toContain('Begränsad marknadspriskontroll')
    expect(section).toContain('Reservversion v4')
    expect(section).toContain('spot_current_day_missing')
    expect(section).toContain('spot_preview_stale')
    expect(section).toContain('border-red-200')
    expect(section).not.toContain('border-emerald-200')
  })

  it('shows a limited result for an incomplete v5 snapshot without exposing unrelated diagnostics', async () => {
    io.health.mockResolvedValue({ checkVersion: 'v5', schemaReady: false, rows: [observedSpot, internalBlocker] })
    const section = await renderMarketHealth()
    expect(section).toContain('Begränsad marknadspriskontroll')
    expect(section).toContain('spot_current_day_missing')
    expect(section).not.toContain('ops_health_schema')
    expect(section).not.toContain('synthetic-private-diagnostic')
    expect(section).not.toContain('border-emerald-200')
  })

  it('shows unavailable coverage when an RPC failure prevents a snapshot', async () => {
    io.health.mockRejectedValue(new Error('synthetic-private-diagnostic'))
    const section = await renderMarketHealth()
    expect(section).toContain('role="status"')
    expect(section).toContain('Marknadspriskontrollerna är otillgängliga')
    expect(section).not.toContain('synthetic-private-diagnostic')
    expect(section).not.toContain('<table')
  })

  it('shows unavailable coverage when a snapshot lacks spot readings', async () => {
    io.health.mockResolvedValue({ checkVersion: null, schemaReady: false, rows: [internalBlocker] })
    const section = await renderMarketHealth()
    expect(section).toContain('Marknadspriskontrollerna är otillgängliga')
    expect(section).not.toContain('ops_health_schema')
    expect(section).not.toContain('<table')
  })

  it('shows the limited status to tenant admins with version metadata confined to platform operators', async () => {
    io.platform = false
    io.health.mockResolvedValue({ checkVersion: 'v3', schemaReady: true, rows: [observedSpot] })
    const section = await renderMarketHealth()
    expect(section).toContain('Begränsad marknadspriskontroll')
    expect(section).toContain('spot_current_day_missing')
    expect(section).not.toContain('Reservversion')
    expect(section).not.toContain('border-emerald-200')
  })
})
