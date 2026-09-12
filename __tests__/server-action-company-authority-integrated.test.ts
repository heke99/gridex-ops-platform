import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ingestBillingUnderlayAction,
  ingestMeteringValueAction,
  updateOutboundRequestStatusAction,
  updatePartnerExportStatusAction,
} from '@/app/admin/cis/actions'
import {
  closeCustomerLifecycleImpl,
  saveCustomerProfileImpl,
} from '@/app/admin/customers/[id]/profile-actions.part-1'
import {
  archiveCustomerImpl,
  markCustomerAsTestDataImpl,
} from '@/app/admin/customers/[id]/profile-actions.part-2'
import { createEdielPortalTestCustomerAction } from '@/app/admin/ediel/actions.part-4'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { assertCompanyAccessForGuard } from '@/lib/tenant/entityGuards'

type Membership = {
  companyId: string
  companyStatus: string | null
  membershipRole: string
}

type Mutation = {
  table: string
  kind: 'insert' | 'update' | 'delete'
  values?: unknown
  filters: Record<string, unknown>
}

const ALL_PERMISSIONS = [
  'switching.write',
  'metering.write',
  'billing_underlay.write',
  'partner_exports.write',
  'masterdata.write',
  'communication.write',
]

const io = vi.hoisted(() => ({
  cookie: 'A' as string | null,
  canonicalCompanyId: 'A' as string | null,
  targetCompanyId: 'B' as string | null,
  submittedCompanyId: 'B' as string | null,
  platform: false,
  permissionsByCompany: {} as Record<string, string[]>,
  memberships: [] as Membership[],
  rowStatus: 'active',
  effects: [] as string[],
  mutations: [] as Mutation[],
  authRpc: vi.fn(),
  serviceRpc: vi.fn(),
  from: vi.fn(),
  revalidate: vi.fn(),
  audit: vi.fn(),
  graph: vi.fn(),
  cis: {
    updateOutbound: vi.fn(),
    updatePartnerExport: vi.fn(),
    ingestMetering: vi.fn(),
    ingestBilling: vi.fn(),
  },
}))

vi.mock('react', () => ({ cache: (fn: unknown) => fn }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => io.cookie ? { value: io.cookie } : undefined,
  }),
}))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`) },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'actor', email: 'actor@example.test' } },
        error: null,
      }),
    },
    rpc: io.authRpc,
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: io.from,
    rpc: io.serviceRpc,
    storage: { from: vi.fn() },
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))

vi.mock('@/lib/audit/actionLogger', () => ({
  logAdminActionAndUsage: io.audit,
  logUsageEvent: io.audit,
}))
vi.mock('@/lib/customer-contracts/db', () => ({ addCustomerContractEvent: vi.fn() }))
vi.mock('@/lib/tenant/emailTemplates', () => ({ queueTenantTemplateEmail: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({
  bulkQueueMissingBillingUnderlays: vi.fn(),
  bulkQueueMissingMeterValues: vi.fn(),
  bulkQueueReadySupplierSwitches: vi.fn(),
  createOutboundRequest: vi.fn(),
  ingestBillingUnderlay: io.cis.ingestBilling,
  ingestMeteringValue: io.cis.ingestMetering,
  saveCommunicationRoute: vi.fn(),
  syncGridOwnerDataRequestFromOutbound: vi.fn(),
  updateGridOwnerDataRequestStatus: vi.fn(),
  updateOutboundRequestStatus: io.cis.updateOutbound,
  updatePartnerExportStatus: io.cis.updatePartnerExport,
}))
vi.mock('@/lib/masterdata/db', () => ({
  listMeteringPointsBySiteIds: vi.fn(),
  getCustomerSiteById: vi.fn(),
  getGridOwnerById: vi.fn(),
  getMeteringPointById: vi.fn(),
}))
vi.mock('@/lib/operations/db', () => ({
  createSupplierSwitchEvent: vi.fn(),
  getSupplierSwitchRequestById: vi.fn(),
  listAllSupplierSwitchRequests: vi.fn(),
  syncCustomerOperationsForCustomer: vi.fn(),
  updateSupplierSwitchRequestStatus: vi.fn(),
}))
vi.mock('@/lib/ediel/orchestrator', () => ({
  createAckDraftForMessage: vi.fn(),
  createNegativeUtiltsResponse: vi.fn(),
  prepareAndQueueAiList: vi.fn(),
  prepareAndQueueEdielZ03: vi.fn(),
  prepareAndQueueEdielZ04: vi.fn(),
  prepareAndQueueEdielZ05: vi.fn(),
  prepareAndQueueEdielZ06: vi.fn(),
  prepareAndQueueEdielZ09: vi.fn(),
  prepareAndQueueEdielZ10: vi.fn(),
  prepareAndQueueEdielZ13: vi.fn(),
  prepareAndQueueEdielZ14: vi.fn(),
  prepareAndQueueEdielZ15: vi.fn(),
  prepareAndQueueEdielZ18: vi.fn(),
  prepareAndQueueUtiltsE66: vi.fn(),
  prepareAndQueueUtiltsE73: vi.fn(),
  sendQueuedEdielMessage: vi.fn(),
}))
vi.mock('@/lib/cis/edielAutomation', () => ({ ensureAndPrepareUtiltsFromDataRequest: vi.fn() }))
vi.mock('@/app/admin/operations/control-actions', () => ({ bulkQueueReadyBillingExportsAction: vi.fn() }))
vi.mock('@/lib/ediel/actionAccess', () => ({
  requireEdielSendActionAccess: vi.fn(),
  requireEdielWriteActionAccess: vi.fn(),
}))
vi.mock('@/lib/ediel/testing/utiltsAckOverrides', () => ({ applyUtiltsTestAckPlanOverride: vi.fn() }))
vi.mock('@/lib/ediel/core/kernel', () => ({
  registerInboundCanonicalMessage: vi.fn(),
  resolveCanonicalOutboundContext: vi.fn(),
}))
vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: vi.fn(),
  createEdielTestRun: vi.fn(),
  listAckMessagesForSource: vi.fn(),
  updateEdielMessageStatus: vi.fn(),
}))
vi.mock('@/lib/ediel/testing/selftest', () => ({ runEdielSelfTest: vi.fn() }))
vi.mock('@/lib/ediel/utilts', () => ({ buildInboundUtiltsMessageInput: vi.fn() }))
vi.mock('@/lib/ediel/utiltsEngine', () => ({
  runUtiltsRuntimeForMessage: vi.fn(),
  serializeUtiltsRuntimeUtiltsErrMessageText: vi.fn(),
}))
vi.mock('@/lib/ediel/prodat', () => ({ isProdatSwitchCode: vi.fn() }))
vi.mock('@/lib/ediel/flows/shared', () => ({
  finalizeOutboundDraft: vi.fn(),
  makeServerClient: async () => ({ from: io.from }),
}))
vi.mock('@/lib/ediel/flows/utiltsDataRequest', () => ({ processInboundUtiltsMessage: vi.fn() }))
vi.mock('@/lib/ediel/portalTestCustomer', () => ({
  createEdielPortalTestCustomerGraph: io.graph,
}))
vi.mock('@/lib/ediel/safeApplyReview', () => ({
  approveSafeMasterdataChanges: vi.fn(),
  rejectSafeMasterdataChanges: vi.fn(),
}))
vi.mock('@/app/admin/ediel/actions.part-3', () => ({
  REPLACEABLE_TGT_ACK_STATUSES: new Set(['draft']),
}))


function membership(
  companyId: string,
  companyStatus: string | null = 'active',
  membershipRole = 'admin',
): Membership {
  return { companyId, companyStatus, membershipRole }
}

function makeQuery(table: string) {
  let kind: Mutation['kind'] | 'read' = 'read'
  let values: unknown
  let columns = ''
  const filters: Record<string, unknown> = {}

  const finish = async (single: boolean) => {
    if (kind !== 'read') {
      io.mutations.push({ table, kind, values, filters: { ...filters } })
      io.effects.push(`mutation:${table}`)
      throw new Error(`TERMINAL:mutation:${table}`)
    }

    if (table === 'company_memberships') {
      return {
        data: io.memberships.map(row => ({
          company_id: row.companyId,
          membership_role: row.membershipRole,
          status: 'active',
          companies: {
            id: row.companyId,
            name: `Company ${row.companyId}`,
            slug: row.companyId.toLowerCase(),
            org_number: null,
            status: row.companyStatus,
          },
        })),
        error: null,
      }
    }

    if (table === 'companies') {
      const companyId = String(filters.id ?? io.targetCompanyId ?? '')
      const company = io.memberships.find(row => row.companyId === companyId)
      const status = company?.companyStatus ?? (companyId ? 'active' : null)
      return {
        data: companyId ? {
          id: companyId,
          name: `Company ${companyId}`,
          slug: companyId.toLowerCase(),
          org_number: null,
          status,
        } : null,
        error: null,
      }
    }

    if (table === 'customers') {
      const data = columns === 'company_id'
        ? { company_id: io.targetCompanyId }
        : {
            id: 'customer-target',
            company_id: io.targetCompanyId,
            status: io.rowStatus,
            customer_type: 'private',
            first_name: 'Test',
            last_name: 'User',
          }
      return { data, error: null }
    }

    if (table === 'outbound_requests' || table === 'partner_exports') {
      return { data: { company_id: io.targetCompanyId }, error: null }
    }

    return { data: single ? null : [], error: null }
  }

  const chain = {
    select: (value = '') => { columns = value; return chain },
    eq: (key: string, value: unknown) => { filters[key] = value; return chain },
    in: (key: string, value: unknown) => { filters[key] = value; return chain },
    is: (key: string, value: unknown) => { filters[key] = value; return chain },
    order: () => chain,
    limit: () => chain,
    update: (next: unknown) => { kind = 'update'; values = next; return chain },
    insert: (next: unknown) => { kind = 'insert'; values = next; return chain },
    delete: () => { kind = 'delete'; return chain },
    single: () => finish(true),
    maybeSingle: () => finish(true),
    then: <TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => finish(false).then(onfulfilled, onrejected),
  }

  return chain
}

function form(values: Record<string, string>): FormData {
  const result = new FormData()
  for (const [key, value] of Object.entries(values)) result.set(key, value)
  return result
}

const actionCases = [
  {
    name: 'CIS outbound request status',
    action: () => updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-target', customer_id: 'customer-target', status: 'acknowledged',
    })),
  },
  {
    name: 'CIS partner export status',
    action: () => updatePartnerExportStatusAction(form({
      export_id: 'export-target', customer_id: 'customer-target', status: 'acknowledged',
    })),
  },
  {
    name: 'CIS metering ingestion',
    action: () => ingestMeteringValueAction(form({
      customer_id: 'customer-target', metering_point_id: 'point-target', value_kwh: '12.5',
    })),
  },
  {
    name: 'CIS billing-underlay ingestion',
    action: () => ingestBillingUnderlayAction(form({ customer_id: 'customer-target' })),
  },
  {
    name: 'profile save',
    action: () => saveCustomerProfileImpl(form({
      customer_id: 'customer-target', customer_type: 'private', first_name: 'Test', last_name: 'User',
    })),
  },
  {
    name: 'profile lifecycle close',
    action: () => closeCustomerLifecycleImpl(form({
      customer_id: 'customer-target', confirm_close: 'AVSLUTA', lifecycle_mode: 'terminate',
    })),
  },
  {
    name: 'profile test-data mark',
    action: () => markCustomerAsTestDataImpl(form({ customer_id: 'customer-target' })),
  },
  {
    name: 'profile archive',
    action: () => archiveCustomerImpl(form({
      customer_id: 'customer-target', confirm_archive: 'ARKIVERA',
    })),
  },
  {
    name: 'Ediel portal test graph',
    action: () => createEdielPortalTestCustomerAction(form({
      companyId: io.submittedCompanyId ?? '',
      testSuite: 'PRODAT',
      roleCode: 'supplier',
      testCaseCode: 'SYNTHETIC',
      agreementStartDateTime: '202609120000',
      powerOfAttorneyReference: 'synthetic',
      customerName: 'Test User',
      customerPersonalNumber: '200001010000',
      customerEmail: 'synthetic@example.test',
      facilityId: '735000000000000001',
      gridAreaId: 'AAA',
    })),
  },
] as const

beforeEach(() => {
  vi.clearAllMocks()
  io.cookie = 'A'
  io.canonicalCompanyId = 'A'
  io.targetCompanyId = 'B'
  io.submittedCompanyId = 'B'
  io.platform = false
  io.permissionsByCompany = {
    A: [...ALL_PERMISSIONS],
    B: ['customers.read'],
  }
  io.memberships = [membership('A'), membership('B')]
  io.rowStatus = 'active'
  io.effects = []
  io.mutations = []

  io.authRpc.mockImplementation(async (
    name: string,
    args: { p_selected_company_id?: string | null },
  ) => {
    expect(name).toBe('canonical_authenticated_tenant_context')
    return {
      data: {
        authorized: true,
        user_id: 'actor',
        user_email: 'actor@example.test',
        selected_company_id: io.canonicalCompanyId,
        is_platform_admin: io.platform,
        roles: io.platform ? ['platform_admin'] : ['custom_role'],
        permissions: io.permissionsByCompany[io.canonicalCompanyId ?? ''] ?? [],
        requested_company_id: args.p_selected_company_id ?? null,
      },
      error: null,
    }
  })
  io.serviceRpc.mockImplementation(async (name: string) => {
    expect(name).toBe('gridex_get_user_roles')
    return { data: io.platform ? ['platform_admin'] : ['custom_role'], error: null }
  })
  io.from.mockImplementation(makeQuery)

  const terminal = (name: string) => async () => {
    io.effects.push(name)
    throw new Error(`TERMINAL:${name}`)
  }
  io.cis.updateOutbound.mockImplementation(terminal('domain:update-outbound'))
  io.cis.updatePartnerExport.mockImplementation(terminal('domain:update-export'))
  io.cis.ingestMetering.mockImplementation(terminal('domain:ingest-metering'))
  io.cis.ingestBilling.mockImplementation(terminal('domain:ingest-billing'))
  io.graph.mockImplementation(terminal('graph:ediel'))
})

async function expectDenied(action: () => Promise<unknown>, pattern: RegExp) {
  await expect(action()).rejects.toThrow(pattern)
  expect(io.effects).toEqual([])
  expect(io.mutations).toEqual([])
}

async function expectTerminal(action: () => Promise<unknown>) {
  await expect(action()).rejects.toThrow(/^TERMINAL:/)
  expect(io.effects).toHaveLength(1)
}

describe('integrated canonical guard, scope, entity and action chain', () => {
  it.each(actionCases)('$name denies selected A -> target B with real membership resolution', async ({ action }) => {
    await expectDenied(action, /behörighet/)
  })

  it.each(actionCases)('$name denies the reverse selected B -> target A pair', async ({ action }) => {
    io.cookie = 'B'
    io.canonicalCompanyId = 'B'
    io.targetCompanyId = 'A'
    io.submittedCompanyId = 'A'
    io.permissionsByCompany.B = [...ALL_PERMISSIONS]
    await expectDenied(action, /behörighet/)
  })

  it.each(actionCases)('$name denies a mismatched selection even when both companies grant every key', async ({ action }) => {
    io.permissionsByCompany.B = [...ALL_PERMISSIONS]
    await expectDenied(action, /behörighet/)
  })

  it.each(actionCases)('$name binds the no-cookie canonical A instead of unsorted operational B', async ({ action }) => {
    io.cookie = null
    io.memberships = [membership('B'), membership('A')]
    await expectDenied(action, /behörighet/)
    expect(io.authRpc).toHaveBeenCalledWith(
      'canonical_authenticated_tenant_context',
      { p_selected_company_id: null },
    )
  })

  it.each(actionCases)('$name retains the same-company positive path', async ({ action }) => {
    io.targetCompanyId = 'A'
    io.submittedCompanyId = 'A'
    await expectTerminal(action)
  })

  it.each(actionCases)('$name retains the real action permission denial', async ({ action }) => {
    io.targetCompanyId = 'A'
    io.submittedCompanyId = 'A'
    io.permissionsByCompany.A = ['customers.read']
    await expectDenied(action, /^Forbidden$/)
  })

  it('Ediel retains the exact real all-of permission requirement', async () => {
    io.targetCompanyId = 'A'
    io.submittedCompanyId = 'A'
    io.permissionsByCompany.A = ['masterdata.write', 'switching.write']
    await expectDenied(actionCases[8].action, /^Forbidden$/)
  })

  it.each(actionCases)('$name preserves authoritative platform cross-company access', async ({ action }) => {
    io.platform = true
    io.memberships = []
    await expectTerminal(action)
  })

  it.each(actionCases)('$name preserves target lifecycle denial for platform access', async ({ action }) => {
    io.platform = true
    io.memberships = [membership('B', 'paused')]
    await expectDenied(action, /pausat|blockerad/i)
  })

  it.each(actionCases)('$name rejects a paused canonical company through the real guards', async ({ action }) => {
    io.cookie = 'B'
    io.canonicalCompanyId = 'B'
    io.targetCompanyId = 'B'
    io.submittedCompanyId = 'B'
    io.permissionsByCompany.B = [...ALL_PERMISSIONS]
    io.memberships = [membership('A'), membership('B', 'paused')]
    await expectDenied(action, /pausat|blockerad/i)
  })

  it.each(actionCases)('$name rejects a canonical company without active membership', async ({ action }) => {
    io.targetCompanyId = 'A'
    io.submittedCompanyId = 'A'
    io.memberships = [membership('B')]
    await expectDenied(action, /pausat|bolagskoppling|operativt/i)
  })

  it('uses the canonical company directly in the shared entity helper', async () => {
    io.cookie = null
    io.memberships = [membership('B'), membership('A')]
    const guard = await requireAdminActionAccess(['masterdata.write'])
    await expect(assertCompanyAccessForGuard('B', guard)).rejects.toThrow(/behörighet/)
    await expect(assertCompanyAccessForGuard('A', guard)).resolves.toBe('A')
  })

  it.each(actionCases.slice(0, 8))('$name rejects missing loaded ownership before an effect', async ({ action }) => {
    io.targetCompanyId = null
    await expectDenied(action, /bolagskoppling/)
  })

  it('Ediel rejects missing submitted ownership before the graph', async () => {
    io.submittedCompanyId = null
    await expectDenied(actionCases[8].action, /behörighet|companyId saknas/)
  })

  it.each(actionCases)('$name rejects a missing canonical company before an effect', async ({ action }) => {
    io.cookie = null
    io.canonicalCompanyId = null
    await expectDenied(action, /Unauthorized|pausat|operativt/i)
  })
})
