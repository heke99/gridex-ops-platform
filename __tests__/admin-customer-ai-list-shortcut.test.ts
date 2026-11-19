import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CustomerEdielOperationsCard from '@/components/admin/customers/CustomerEdielOperationsCard'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

const ids = {
  company: '10000000-0000-4000-8000-000000000001',
  outsider: '10000000-0000-4000-8000-000000000002',
  customer: '10000000-0000-4000-8000-000000000003',
  site: '10000000-0000-4000-8000-000000000004',
  secondSite: '10000000-0000-4000-8000-000000000005',
  actor: '10000000-0000-4000-8000-000000000006',
}

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  companyId: null as string | null,
  hasMembership: true,
  isPlatformAdmin: true,
  actorLookupFailed: false,
  calls: [] as Array<{ companyId: string; actorUserId: string; permission: string }>,
}))

vi.mock('@/lib/admin/guards', () => ({
  requireAdminPageAccess: async () => ({
    companyId: state.companyId, permissions: state.permissions, userId: ids.actor, isPlatformAdmin: state.isPlatformAdmin,
  }),
}))
vi.mock('@/lib/ediel/services/authorization', () => ({
  assertEdielTenantActor: async (input: { companyId: string; actorUserId: string; permission: string }) => {
    state.calls.push(input)
    if (state.actorLookupFailed) throw new Error('synthetic actor lookup failure')
    if (!state.hasMembership) {
      throw new EdielExecutionFailure(
        { kind: 'security_quarantine', code: 'EDIEL_TENANT_ACTOR_FORBIDDEN' },
        'ediel_tenant_actor_forbidden',
      )
    }
  },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ids.actor } } }) } }),
}))
vi.mock('@/app/admin/ediel/actions', () => ({
  pollMailboxAction: vi.fn(),
  prepareSwitchZ03Action: vi.fn(),
  prepareSwitchZ09Action: vi.fn(),
  sendEdielMessageAction: vi.fn(),
}))
vi.mock('@/components/admin/ediel/EdielRouteIssueActions', () => ({ default: () => null }))
vi.mock('@/lib/ediel/recommendations', () => ({
  getRecommendationSummary: () => ({ routeHealth: {}, routeIssues: [], routeSummary: '' }),
}))
vi.mock('@/lib/ediel/types', () => ({ isActiveEdielMessageFamily: () => false }))

function site(overrides: Partial<CustomerSiteRow> = {}): CustomerSiteRow {
  return { id: ids.site, customer_id: ids.customer, company_id: ids.company, site_name: 'E2E anläggning', ...overrides } as CustomerSiteRow
}

async function render(sites = [site()], isPlatformAdmin = true) {
  return renderToStaticMarkup(await CustomerEdielOperationsCard({
    customerId: ids.customer, sites, meteringPoints: [], gridOwners: [], switchRequests: [],
    dataRequests: [], communicationRoutes: [], routeProfiles: [], edielMessages: [],
    recommendationRoutes: [], isPlatformAdmin,
  }))
}

beforeEach(() => {
  state.permissions = ['communication.read', 'communication.write', 'customers.read']
  state.companyId = ids.company
  state.hasMembership = true
  state.isPlatformAdmin = true
  state.actorLookupFailed = false
  state.calls = []
  vi.stubGlobal('React', React)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('customer Ediel preparation shortcut', () => {
  it('preselects the verified customer and their single eligible facility', async () => {
    const html = await render()

    expect(html).toContain('Förbered AI-lista')
    expect(html).toContain('/admin/ediel/ai-list?customerId=' + ids.customer + '&amp;siteId=' + ids.site)
    expect(state.calls).toEqual([{ companyId: ids.company, actorUserId: ids.actor, permission: 'communication.write' }])
  })

  it('preselects the customer without guessing a facility when several are eligible', async () => {
    const html = await render([site(), site({ id: ids.secondSite })])

    expect(html).toContain('/admin/ediel/ai-list?customerId=' + ids.customer + '"')
    expect(html).not.toContain('&amp;siteId=')
  })

  it('does not infer a single facility from a bounded list with unverifiable rows', async () => {
    const unavailable = Array.from({ length: 99 }, (_, index) => site({
      id: '10000000-0000-7000-8000-' + String(index).padStart(12, '0'),
    }))
    const html = await render([site(), ...unavailable])

    expect(html).toContain('/admin/ediel/ai-list?customerId=' + ids.customer + '"')
    expect(html).not.toContain('&amp;siteId=')
  })

  it.each(['communication.write', 'communication.read', 'customers.read'])('hides the shortcut without explicit %s', async missing => {
    state.permissions = state.permissions.filter(permission => permission !== missing)

    expect(await render()).not.toContain('Förbered AI-lista')
    expect(state.calls).toEqual([])
  })

  it('hides the shortcut when the tenant actor membership is denied', async () => {
    state.hasMembership = false

    const html = await render()
    expect(html).not.toContain('Förbered AI-lista')
    expect(html).toContain('Ediel operations')
    expect(state.calls).toHaveLength(1)
  })

  it('does not apply selected-company permissions to a facility in another company', async () => {
    expect(await render([site({ company_id: ids.outsider })])).not.toContain('Förbered AI-lista')
    expect(state.calls).toEqual([])
  })

  it('does not look up actor access without a selected company', async () => {
    state.companyId = null

    expect(await render()).not.toContain('Förbered AI-lista')
    expect(state.calls).toEqual([])
  })

  it('does not expose the technical shortcut to the non-platform card', async () => {
    expect(await render([site()], false)).not.toContain('Förbered AI-lista')
    expect(state.calls).toEqual([])
  })

  it('requires current platform access even when rendering the technical card', async () => {
    state.isPlatformAdmin = false

    expect(await render()).not.toContain('Förbered AI-lista')
    expect(state.calls).toEqual([])
  })

  it('preserves the Ediel operations card when actor access cannot be verified', async () => {
    state.actorLookupFailed = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const html = await render()
    expect(html).not.toContain('Förbered AI-lista')
    expect(html).toContain('Öppna Ediel Live Center')
    expect(warn).toHaveBeenCalledExactlyOnceWith('Could not verify Ediel AI-list shortcut access')
  })
})
