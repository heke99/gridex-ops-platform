import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ platform: false, longLists: false }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminPageKeyAccess: async () => ({ userId: 'operator', companyId: 'company', permissions: ['customers.write','communication.send','communication.read','metering.write'] }), isPlatformAdminContext: () => io.platform }))
vi.mock('@/lib/tenant/adminScope', () => ({ resolveAdminSelectedCompanyReadScope: async () => ({ companyId: 'company' }) }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope: async () => ({ memberships: [{ companyId: 'company', status: 'active', companyStatus: 'active' }] }) }))
vi.mock('@/lib/tenant/lifecycle', () => ({ isCompanyWritableInTenantWorkspace: () => true }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'operator' } } }) } }) }))
vi.mock('@/lib/ediel/services/manualPermissionOptions', () => ({ readManualServicePermissionOptions: async () => [] }))
vi.mock('@/lib/onboarding/infoRequestPortalReplies', () => ({ listPortalRepliesForInfoRequests: async () => new Map() }))
vi.mock('@/lib/ediel/operations/processNextAction', () => ({ readEdielProcessNextActions: async () => new Map() }))
vi.mock('@/lib/onboarding/infoRequests', () => ({
  listCustomersForInfoRequestSelector: async () => [{ id: 'customer', label: 'Testkund', sublabel: null }],
  listCustomerInfoRequests: async () => Array.from({ length: io.longLists ? 12 : 1 }, (_, index) => ({ id: `request-${index}`, customer_id: 'customer', request_type: 'z01_customer_masterdata', status: 'waiting_for_z02', target_party_type: 'grid_owner' })),
  listAuthorizationScopes: async () => io.longLists ? Array.from({ length: 12 }, (_, index) => ({ id: `scope-${index}`, status: 'active', scope_type: 'customer_onboarding', covers_grid_owner_data: true, covers_current_supplier_contract: true, covers_metering_data: true })) : [],
  listMeteringPermissions: async () => Array.from({ length: io.longLists ? 12 : 1 }, (_, index) => ({ id: `permission-${index}`, customer_id: 'customer', status: 'draft' })),
  listCustomerInfoRequestResourceOptions: async () => ({ sites: [], meteringPoints: [], gridOwners: [] }),
}))
vi.mock('@/app/admin/customer-info-requests/actions', () => ({ applyZ14SnapshotAction: vi.fn(), closeCustomerInfoRequestAction: vi.fn(), createAuthorizationScopeAction: vi.fn(), createCustomerInfoRequestAction: vi.fn(), createMeteringPermissionDraftAction: vi.fn(), queueCustomerInfoRequestAction: vi.fn(), queueMeteringPermissionZ13Action: vi.fn() }))
vi.mock('@/components/admin/AdminHeader', () => ({ default: ({ title }: { title: string }) => React.createElement('header', null, React.createElement('h1', null, title)) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement('a', { href }, children) }))
import Page from '@/app/admin/customer-info-requests/page'
beforeEach(() => { io.platform = false; io.longLists = false; vi.stubGlobal('React', React) })
it('renders business labels and preserves original submission values without manual technical controls', async () => {
  const html = renderToStaticMarkup(await Page())
  const visible = html.replace(/<[^>]*>/g, ' ')
  expect(visible).toContain('Väntar på nätägarens svar')
  for (const text of ['Z01','Z02','Z13','Z14','Fullmaktsmotor']) expect(visible).not.toContain(text)
  expect(html).toContain('value="z01_customer_masterdata"')
  expect(html).toContain('value="customer_onboarding"')
  expect(html).not.toContain('name="source_message_id"')
  expect(html).toContain('create-info-request')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/info-requests-company.html`,html)
})
it('retains manual message matching for the platform operator', async () => {
  io.platform = true
  const html = renderToStaticMarkup(await Page())
  expect(html).toContain('name="source_message_id"')
  expect(html).toContain('Koppla mottaget Z14-svar')
})

it('keeps long lists bounded and keyboard-accessible', async () => {
  io.longLists = true
  const html = renderToStaticMarkup(await Page())
  expect(html.match(/tabindex="0" role="region"/g)).toHaveLength(3)
  expect(html).toContain('/admin/customers/customer')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/info-requests-long-company.html`,html)
})
