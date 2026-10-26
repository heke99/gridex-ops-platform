// reality-defects: I-B4v
// I-B4v: besides the contract-signed job (I-B4), two staff paths created a queued switch request without the site's
// signed contract: the authorization-document upload and the platform admin's manual switch form. The database dispatch
// guard (gridex_guard_supplier_switch_dispatch) refuses every queued switch without its exact contract
// (supplier_switch_exact_contract_required, 23514). Both paths now bind the newest signed contract of exactly the
// tenant, customer and site; without one they bind none and the guard decides as before.
import { beforeEach, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  contracts: [] as Record<string, unknown>[],
  filters: [] as string[],
  creates: [] as Record<string, unknown>[],
}))

const COMPANY = '00000000-0000-4000-8000-000000000002'
const OTHER_COMPANY = '00000000-0000-4000-8000-000000000020'
const CUSTOMER = '00000000-0000-4000-8000-000000000003'
const SITE = '00000000-0000-4000-8000-000000000004'
const OTHER_SITE = '00000000-0000-4000-8000-000000000040'
const POINT = '00000000-0000-4000-8000-000000000005'
const CONTRACT = '00000000-0000-4000-8000-000000000030'

// customer_contracts read through the service client, with the exact filters the helper applies.
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: (table: string) => {
      const eqs: [string, unknown][] = []
      let siteOr = ''
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: unknown) => { eqs.push([c, v]); io.filters.push(`${table}.${c}`); return q },
        or: (expr: string) => { siteOr = expr; return q },
        maybeSingle: async () => {
          const siteIds = [...siteOr.matchAll(/(?:customer_site_id|site_id)\.eq\.([0-9a-f-]+)/g)].map(m => m[1])
          const hit = io.contracts
            .filter(r => eqs.every(([c, v]) => r[c] === v))
            .filter(r => siteIds.includes(String(r.customer_site_id ?? '')) || siteIds.includes(String(r.site_id ?? '')))
            .sort((a, b) => String(b.signed_at).localeCompare(String(a.signed_at)))
          return { data: hit[0] ?? null, error: null }
        },
      })
      return q
    },
    rpc: async () => ({ data: null, error: null }),
  },
}))

const site = { id: SITE, company_id: COMPANY, customer_id: CUSTOMER, grid_owner_id: null, current_supplier_id: null }
const point = { id: POINT, company_id: COMPANY, customer_id: CUSTOMER, site_id: SITE, status: 'active', grid_owner_id: null }
const readiness = { isReady: true, candidateMeteringPointId: POINT, customerId: CUSTOMER, siteId: SITE, issues: [] }

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({}) }))
vi.mock('@/lib/operations/readiness', () => ({ evaluateSiteSwitchReadiness: () => readiness }))
vi.mock('@/lib/operations/db', () => ({
  findCustomerSiteById: async () => site,
  listMeteringPointsForSite: async () => [point],
  listPowersOfAttorneyByCustomerId: async () => [],
  findOpenSupplierSwitchRequestForSite: async () => null,
  createSupplierSwitchRequest: async (_client: unknown, params: Record<string, unknown>) => {
    io.creates.push(params)
    return { id: 'switch-1', customer_id: CUSTOMER, site_id: SITE, metering_point_id: POINT, validation_snapshot: {} }
  },
  updateSupplierSwitchValidationSnapshot: async () => ({ id: 'switch-1', customer_id: CUSTOMER, site_id: SITE, metering_point_id: POINT }),
  assignAuthorizationDocumentToSwitchRequest: async () => undefined,
  syncOperationTasksFromReadiness: async () => undefined,
  saveCustomerAuthorizationDocument: async () => undefined,
  savePowerOfAttorney: async () => undefined,
  syncCustomerOperationsForCustomer: async () => undefined,
  syncCustomerOperationsForSite: async () => undefined,
  assignAuthorizationDocumentToGridOwnerRequest: async () => undefined,
  assignAuthorizationDocumentToOutboundRequest: async () => undefined,
  buildGridOwnerDataRequestAutomationKey: () => 'k',
  buildOutboundRequestAutomationKey: () => 'k',
  buildSupplierSwitchRequestAutomationKey: () => 'doc-key',
  createSupplierSwitchEvent: async () => undefined,
  findOpenGridOwnerDataRequestByDocument: async () => null,
  findOpenOutboundRequestByDocument: async () => null,
  listSupplierSwitchRequestsByCustomerId: async () => [],
  updateSupplierSwitchRequestStatus: async () => undefined,
}))

// The manual form's surrounding guards, all passing, so the test reaches the switch creation.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('next/server', () => ({ after: () => undefined }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => ({ userId: 'staff-1', isPlatformAdmin: true }) }))
vi.mock('@/lib/tenant/entityGuards', () => ({ assertCustomerSiteTenant: async () => undefined, assertMeteringPointTenant: async () => undefined }))
vi.mock('@/lib/operations/businessActions/actionPreflight', () => ({ actionPreflight: async () => ({ ok: true, issues: [] }) }))
vi.mock('@/lib/operations/businessActions/startSupplierSwitch', () => ({ startSupplierSwitch: async () => undefined }))
vi.mock('@/lib/legal/gridOwnerLegalPayload', () => ({ prepareLegalPayloadForGridOwner: async () => ({ ok: true, missing: [] }) }))
vi.mock('@/app/admin/customers/[id]/actions.part-4', () => ({ requireCustomerMutationContext: async () => ({ companyId: COMPANY }) }))
vi.mock('@/app/admin/customers/[id]/actions.part-1', () => ({
  auditRouteDecisionForCustomerAction: async () => ({ decisionStatus: 'ready' }),
  buildCustomerDocumentPath: () => 'p',
  formValue: (formData: FormData, key: string) => { const v = formData.get(key); return typeof v === 'string' ? v : null },
  insertAuditLog: async () => undefined,
  messageCodeForBusinessProcess: () => 'Z03',
  normalizeDateOrNull: (v: string | null) => v,
  normalizeSwitchRequestType: () => 'switch',
  reconcileSupplierSwitchesForCustomerSites: async () => undefined,
  recordCustomerActionResult: async () => undefined,
  toBoolean: () => false,
}))

import { findLatestSignedContractIdForSite } from '@/lib/customer-operations/switchReadiness'
import { ensureSwitchRequestAndOutboundFromDocument } from '@/app/admin/customers/[id]/document-actions.part-1'
import { createSupplierSwitchRequestAction } from '@/app/admin/customers/[id]/actions.part-2'

beforeEach(() => {
  io.creates = []
  io.filters = []
  io.contracts = [
    { id: CONTRACT, company_id: COMPANY, customer_id: CUSTOMER, customer_site_id: SITE, status: 'signed', signed_at: '2026-10-01' },
    // An older signed contract, another tenant's and another site's contract never win.
    { id: 'older', company_id: COMPANY, customer_id: CUSTOMER, customer_site_id: SITE, status: 'signed', signed_at: '2026-01-01' },
    { id: 'foreign-tenant', company_id: OTHER_COMPANY, customer_id: CUSTOMER, customer_site_id: SITE, status: 'signed', signed_at: '2026-10-20' },
    { id: 'other-site', company_id: COMPANY, customer_id: CUSTOMER, customer_site_id: OTHER_SITE, status: 'signed', signed_at: '2026-10-21' },
    { id: 'draft', company_id: COMPANY, customer_id: CUSTOMER, customer_site_id: SITE, status: 'draft', signed_at: '2026-10-22' },
  ]
})

const document = { id: 'doc-1', document_type: 'power_of_attorney', title: 'Fullmakt', file_path: 'x' } as never

it("the newest signed contract of exactly the tenant, customer and site is chosen", async () => {
  await expect(findLatestSignedContractIdForSite({ companyId: COMPANY, customerId: CUSTOMER, siteId: SITE })).resolves.toBe(CONTRACT)
  expect(io.filters).toEqual(expect.arrayContaining(['customer_contracts.company_id', 'customer_contracts.customer_id', 'customer_contracts.status']))
  await expect(findLatestSignedContractIdForSite({ companyId: OTHER_COMPANY, customerId: CUSTOMER, siteId: OTHER_SITE })).resolves.toBeNull()
})

it('a switch created from an uploaded authorization document carries the site contract', async () => {
  await ensureSwitchRequestAndOutboundFromDocument({ actorUserId: 'staff-1', customerId: CUSTOMER, siteId: SITE, document,
    requestType: 'switch', requestedStartDate: '2027-01-01', autoQueueOutbound: false })
  expect(io.creates).toHaveLength(1)
  expect(io.creates[0]).toMatchObject({ contractId: CONTRACT, automationOrigin: 'document_upload' })
})

it('the manual switch form creates its request in the tenant with the site contract', async () => {
  const form = new FormData()
  form.set('customer_id', CUSTOMER)
  form.set('site_id', SITE)
  form.set('requested_start_date', '2027-01-01')
  await createSupplierSwitchRequestAction(form)
  expect(io.creates).toHaveLength(1)
  expect(io.creates[0]).toMatchObject({ contractId: CONTRACT, companyId: COMPANY })
})

it('without a signed contract neither path invents one (the guard decides)', async () => {
  io.contracts = io.contracts.filter(r => r.status !== 'signed' || r.company_id !== COMPANY || r.customer_site_id !== SITE)
  await ensureSwitchRequestAndOutboundFromDocument({ actorUserId: 'staff-1', customerId: CUSTOMER, siteId: SITE, document,
    requestType: 'switch', requestedStartDate: '2027-01-01', autoQueueOutbound: false })
  const form = new FormData()
  form.set('customer_id', CUSTOMER)
  form.set('site_id', SITE)
  await createSupplierSwitchRequestAction(form)
  expect(io.creates.map(c => c.contractId)).toEqual([null, null])
})
