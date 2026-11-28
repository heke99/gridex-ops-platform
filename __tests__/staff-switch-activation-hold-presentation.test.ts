import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, expect, it, vi } from 'vitest'

const ids = vi.hoisted(() => ({
  company: '94200000-0000-4000-8000-000000000001',
  customer: '94200000-0000-4000-8000-000000000002',
  request: '94200000-0000-4000-8000-000000000003',
  site: '94200000-0000-4000-8000-000000000004',
  confirmation: '94200000-0000-4000-8000-000000000005',
  period: '94200000-0000-4000-8000-000000000006',
  actor: '94200000-0000-4000-8000-000000000007',
}))
const fixture = vi.hoisted(() => ({
  platform: true,
  mayActivate: true,
  status: 'accepted',
  lifecycleBlocked: false,
  pausedAt: null as string | null,
  marketStart: '',
  evidenceReads: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ notFound: () => { throw Error('not-found') } }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: () => null }))
vi.mock('@/components/admin/CustomerName', () => ({ default: () => 'Syntetisk kund' }))
vi.mock('@/lib/admin/guards', () => ({
  isPlatformAdminContext: (actor: { isPlatformAdmin: boolean }) => actor.isPlatformAdmin,
  requireAdminActionAccess: async () => ({ userId: ids.actor }),
  requireAdminPageKeyAccess: async () => ({
    userId: ids.actor,
    permissions: ['masterdata.write', 'switching.read'],
    roles: [],
    isPlatformAdmin: fixture.platform,
  }),
}))
vi.mock('@/lib/tenant/adminScope', () => ({
  resolveAdminTenantReadScope: async () => ({ isPlatformAdmin: fixture.platform, companyId: ids.company }),
}))
vi.mock('@/lib/operations/switchActivationAuthority', () => ({
  readSwitchActivationCompanyIds: async (_client: unknown, actor: string, companies: string[]) => {
    expect(actor).toBe(ids.actor)
    expect(companies).toEqual([ids.company])
    return new Set(fixture.mayActivate ? companies : [])
  },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => client() }))
vi.mock('@/lib/masterdata/db', () => ({
  listGridOwners: async () => [],
  listMeteringPointsBySiteIds: async () => [],
}))
vi.mock('@/lib/operations/db', () => ({
  listPowersOfAttorneyByCustomerId: async () => [],
  listSupplierSwitchEventsByRequestIds: async () => [],
}))
vi.mock('@/lib/operations/readiness', () => ({
  evaluateSiteSwitchReadiness: () => ({ isReady: true, issues: [] }),
}))
vi.mock('@/lib/cis/db', () => ({ listOutboundDispatchEventsByRequestIds: async () => [] }))
vi.mock('@/app/admin/cis/actions', () => ({
  queueSupplierSwitchOutboundAction: vi.fn(),
  updateOutboundRequestStatusAction: vi.fn(),
}))
vi.mock('@/app/admin/operations/actions', () => ({
  finalizeSupplierSwitchExecutionAction: vi.fn(),
  retryOutboundFromSwitchDetailAction: vi.fn(),
  updateSupplierSwitchStatusFromAdminAction: vi.fn(),
  validateSupplierSwitchBeforeProcessingAction: vi.fn(),
}))
vi.mock('@/app/admin/ediel/actions', () => ({
  prepareSwitchZ03Action: vi.fn(),
  prepareSwitchZ05Action: vi.fn(),
  prepareSwitchZ09Action: vi.fn(),
  sendEdielMessageAction: vi.fn(),
}))

import SwitchDetailPage from '@/app/admin/operations/switches/[id]/page'
import { readCompleteBulkReadySelection } from '@/lib/operations/readyBulkCandidates'
import { stockholmMarketDate } from '@/lib/operations/supplierSwitchActivation'

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: ids.actor, email: 'staff@example.invalid' } } }) },
    from(table: string) {
      const civilStart = stockholmMarketDate(new Date(fixture.marketStart))
      const request = {
        id: ids.request,
        company_id: ids.company,
        customer_id: ids.customer,
        site_id: ids.site,
        status: fixture.status,
        request_type: 'switch',
        lifecycle_blocked: fixture.lifecycleBlocked,
        paused_at: fixture.pausedAt,
        confirmed_start_date: civilStart,
        requested_start_date: civilStart,
        inbound_z04_message_id: ids.confirmation,
        metering_point_id: null,
        created_at: null,
      }
      let single: unknown = null
      let rows: unknown[] = []
      if (table === 'supplier_switch_requests') {
        single = request
        rows = [request]
      }
      if (table === 'customer_sites') {
        single = { id: ids.site, company_id: ids.company, customer_id: ids.customer, site_name: 'Syntetisk anläggning' }
      }
      if (table === 'customer_supply_periods') {
        fixture.evidenceReads += 1
        rows = [{
          id: ids.period,
          company_id: ids.company,
          source_switch_request_id: ids.request,
          source_message_id: ids.confirmation,
          source: 'ediel_qualified_source',
          source_process: 'supplier_switch_confirmation',
          status: 'confirmed_by_grid_owner',
          market_start_at: fixture.marketStart,
        }]
      }
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        or: (scope: string) => {
          if (table === 'customer_supply_periods') {
            expect(scope).toBe(
              `and(company_id.eq.${ids.company},source_switch_request_id.eq.${ids.request},source_message_id.eq.${ids.confirmation})`,
            )
          }
          return query
        },
        maybeSingle: async () => ({ data: single, error: null }),
        then: (resolve: (result: { data: unknown[]; count: number; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: rows, count: rows.length, error: null })),
      }
      return query
    },
  }
}

beforeEach(() => {
  fixture.platform = true
  fixture.mayActivate = true
  fixture.status = 'accepted'
  fixture.lifecycleBlocked = false
  fixture.pausedAt = null
  fixture.marketStart = new Date(Date.now() - 2 * 86_400_000).toISOString()
  fixture.evidenceReads = 0
})

async function renderedSwitch() {
  const page = await SwitchDetailPage({ params: Promise.resolve({ id: ids.request }) })
  return renderToStaticMarkup(page)
}

it('offers the platform action with due and uniquely linked Z04 evidence', async () => {
  expect(await renderedSwitch()).toContain('Slutför byte nu')
  expect(fixture.evidenceReads).toBe(1)
})

it('withholds the platform action for a future market start', async () => {
  fixture.marketStart = new Date(Date.now() + 2 * 86_400_000).toISOString()
  expect(await renderedSwitch()).not.toContain('Slutför byte nu')
  expect(fixture.evidenceReads).toBe(1)
})

it('withholds the platform action if the company activation grant is absent', async () => {
  fixture.mayActivate = false
  expect(await renderedSwitch()).not.toContain('Slutför byte nu')
  expect(fixture.evidenceReads).toBe(1)
})

it('withholds the platform action for an already completed request', async () => {
  fixture.status = 'completed'
  expect(await renderedSwitch()).not.toContain('Slutför byte nu')
  expect(fixture.evidenceReads).toBe(0)
})

it('withholds the action for a lifecycle-blocked request in both Staff views', async () => {
  fixture.lifecycleBlocked = true
  fixture.platform = false
  expect(await renderedSwitch()).not.toContain('Slutför leverantörsbyte')

  fixture.platform = true
  const page = await renderedSwitch()
  expect(page).not.toContain('Slutför byte nu')
  expect(page).toContain('Ärendet är pausat och behöver granskas innan leveransstart.')
})

it('withholds the platform action for an operator-paused request', async () => {
  fixture.pausedAt = new Date().toISOString()
  expect(await renderedSwitch()).not.toContain('Slutför byte nu')
})

it('keeps a lifecycle-blocked row out of due bulk activation without discarding the accepted record', async () => {
  fixture.lifecycleBlocked = true
  const selection = await readCompleteBulkReadySelection(client() as unknown as SupabaseClient, ids.company)
  expect(selection.accepted.map(row => row.id)).toEqual([ids.request])
  expect(selection.ready).toEqual([])
  expect(fixture.evidenceReads).toBe(0)
})

it('keeps native bulk eligibility unchanged for a historical timestamp without an active lifecycle block', async () => {
  fixture.pausedAt = new Date().toISOString()
  const selection = await readCompleteBulkReadySelection(client() as unknown as SupabaseClient, ids.company)
  expect(selection.ready.map(row => row.id)).toEqual([ids.request])
})
