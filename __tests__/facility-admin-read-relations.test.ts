import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

// The duplicate customer/site FKs and absent grid-owner FK were independently
// reproduced against the actual PostgREST endpoint with limit=0. This adapter
// returns those observed schema errors and synthetic rows, never live data.
const state = vi.hoisted(() => ({ calls: [] as Array<{ table: string; select?: string; filters: Array<[string, unknown]> }>, failOwners: false }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ userId: 'actor-a', email: 'admin@example.test' }), isPlatformAdminContext: () => false }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ companyId: 'company-a' }) }))
vi.mock('@/lib/tenant/adminScope', () => ({ tenantReadCompanyId: (_platform: boolean, companyId: string) => companyId }))
vi.mock('@/lib/facility/workQueue', () => ({ listFacilityWorkQueue: async () => [], facilityMissingFieldLabel: (value: string) => value, facilityStatusLabel: (value: string) => value }))
vi.mock('@/app/admin/facility-requests/actions', () => ({ markFacilityLookupSentManuallyAction: async () => {}, completeFacilityLookupAction: async () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ from: (table: string) => {
  const call: { table: string; select?: string; filters: Array<[string, unknown]> } = { table, filters: [] }
  state.calls.push(call)
  const row = { id: 'request-a', company_id: 'company-a', customer_id: 'customer-a', customer_site_id: 'site-a', grid_owner_id: 'owner-a', status: 'waiting_response', channel: 'manual_phone', requested_fields: ['facility_id'], created_at: '2026-10-01T12:00:00Z', customer: { full_name: 'Syntetisk Kund Alfa' }, site: { street: 'Syntetisk adress Alfa', city: 'Teststad' } }
  const query: Record<string, unknown> = {
    select: (select: string) => { call.select = select; return query },
    eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query },
    in: (key: string, value: unknown) => { call.filters.push([key, value]); return query },
    order: () => query, limit: () => query,
    then: (resolve: (value: unknown) => unknown) => {
      let result: { data: unknown; error: unknown }
      if (table === 'grid_owner_information_requests') {
        const ambiguous = call.select?.includes('customer:customers(') || call.select?.includes('site:customer_sites(')
        const absent = call.select?.includes('grid_owner:grid_owners(')
        result = ambiguous || absent
          ? { data: null, error: { code: ambiguous ? 'PGRST201' : 'PGRST200' } }
          : { data: [call.select?.includes('customer:') ? row : { ...row, customer: null, site: null }], error: null }
      } else {
        result = state.failOwners
          ? { data: null, error: { code: 'unavailable' } }
          : { data: [{ id: 'owner-a', name: 'Syntetiskt Nät Alfa', ediel_id: '12345', owner_code: 'SYN' }], error: null }
      }
      return Promise.resolve(result).then(resolve)
    },
  }
  return query
} }) }))
import FacilityRequestsPage from '@/app/admin/facility-requests/page'

beforeEach(() => { state.calls = []; state.failOwners = false; vi.stubGlobal('React', React) })

it('keeps customer, site and grid-owner names with the actual relationship catalog', async () => {
  const html = renderToStaticMarkup(await FacilityRequestsPage())
  expect(html).toContain('Syntetisk Kund Alfa')
  expect(html).toContain('Syntetisk adress Alfa')
  expect(html).toContain('Syntetiskt Nät Alfa')
  const requestCalls = state.calls.filter(call => call.table === 'grid_owner_information_requests')
  expect(requestCalls).toHaveLength(1)
  expect(requestCalls[0].filters).toContainEqual(['company_id', 'company-a'])
  const ownerCall = state.calls.find(call => call.table === 'grid_owners')
  expect(ownerCall?.filters).toContainEqual(['id', ['owner-a']])
})

it('retains the named request and manual forms if shared grid-owner names are unavailable', async () => {
  state.failOwners = true
  const html = renderToStaticMarkup(await FacilityRequestsPage())
  expect(html).toContain('Syntetisk Kund Alfa')
  expect(html).toContain('Markera skickad manuellt')
  expect(html).toContain('Registrera svar från nätägare')
})
