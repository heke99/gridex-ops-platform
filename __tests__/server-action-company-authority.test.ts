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

type Mutation = {
  table: string
  kind: 'insert' | 'update' | 'delete'
  values?: unknown
  filters: Record<string, unknown>
}

const io = vi.hoisted(() => ({
  guardCompanyId: 'A' as string | null,
  targetCompanyId: 'B' as string | null,
  platform: false,
  permissionsByCompany: {} as Record<string, string[]>,
  rowStatus: 'active',
  operationalError: null as Error | null,
  scopedError: null as Error | null,
  mutations: [] as Mutation[],
  adminAccess: vi.fn(),
  scopedAccess: vi.fn(),
  from: vi.fn(),
  operate: vi.fn(),
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

function currentGuard() {
  return {
    userId: 'actor',
    email: 'actor@example.test',
    permissions: io.permissionsByCompany[io.guardCompanyId ?? ''] ?? [],
    roles: io.platform ? ['platform_admin'] : ['custom_role'],
    isAdmin: true,
    isPlatformAdmin: io.platform,
    companyId: io.guardCompanyId,
  }
}

vi.mock('@/lib/admin/guards', () => ({
  isPlatformAdminContext: (guard: { isPlatformAdmin?: boolean }) =>
    guard.isPlatformAdmin === true,
  requireAdminActionAccess: io.adminAccess,
  requireCompanyScopedActionAccess: io.scopedAccess,
  requirePlatformAdminActionAccess: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'actor', email: 'actor@example.test' } },
        error: null,
      }),
    },
  }),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from: io.from,
    storage: { from: vi.fn() },
  },
}))

vi.mock('@/lib/tenant/scope', () => ({
  assertUserCanOperateCompany: io.operate,
  getOperationalCompanyScope: vi.fn(),
  requireOperationalCompanyId: async () => io.targetCompanyId ?? 'B',
}))

vi.mock('next/cache', () => ({ revalidatePath: io.revalidate }))

vi.mock('@/lib/audit/actionLogger', () => ({
  logAdminActionAndUsage: io.audit,
  logUsageEvent: io.audit,
}))
vi.mock('@/lib/customer-contracts/db', () => ({ addCustomerContractEvent: vi.fn() }))
vi.mock('@/lib/tenant/emailTemplates', () => ({ queueTenantTemplateEmail: vi.fn() }))
vi.mock('@/lib/admin/masterdataPermissions', () => ({
  MASTERDATA_PERMISSIONS: { WRITE: 'masterdata.write' },
}))

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
vi.mock('@/lib/tenant/governance', () => ({ requireCompanyOperationalForWrites: vi.fn() }))

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
vi.mock('@/app/admin/ediel/actions.part-1', () => ({
  formNumber: vi.fn(),
  formString: (value: FormDataEntryValue | null) => {
    if (typeof value !== 'string') return null
    return value.trim() || null
  },
  getProdatDraftBuilder: vi.fn(),
  parseEdielTestRoleCode: () => 'supplier',
  parseEdielTestSuite: () => 'PRODAT',
  requireScopedEdielMessageForAction: vi.fn(),
  revalidateEdiel: vi.fn(),
  revalidateRelatedMessage: vi.fn(),
}))
vi.mock('@/app/admin/ediel/actions.part-3', () => ({
  REPLACEABLE_TGT_ACK_STATUSES: new Set(['draft']),
}))

function makeQuery(table: string) {
  let kind: Mutation['kind'] | 'read' = 'read'
  let values: unknown
  let columns = ''
  const filters: Record<string, unknown> = {}

  const finish = async (single: boolean) => {
    if (kind !== 'read') {
      io.mutations.push({ table, kind, values, filters: { ...filters } })
      throw new Error(`reached-mutation:${table}`)
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
    select: (value: string) => { columns = value; return chain },
    eq: (key: string, value: unknown) => { filters[key] = value; return chain },
    in: (key: string, value: unknown) => { filters[key] = value; return chain },
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

const cisCases = [
  {
    name: 'outbound request status',
    action: () => updateOutboundRequestStatusAction(form({
      outbound_request_id: 'outbound-target', customer_id: 'customer-target', status: 'acknowledged',
    })),
    boundary: () => io.cis.updateOutbound,
  },
  {
    name: 'partner export status',
    action: () => updatePartnerExportStatusAction(form({
      export_id: 'export-target', customer_id: 'customer-target', status: 'acknowledged',
    })),
    boundary: () => io.cis.updatePartnerExport,
  },
  {
    name: 'metering ingestion',
    action: () => ingestMeteringValueAction(form({
      customer_id: 'customer-target', metering_point_id: 'point-target', value_kwh: '12.5',
    })),
    boundary: () => io.cis.ingestMetering,
  },
  {
    name: 'billing-underlay ingestion',
    action: () => ingestBillingUnderlayAction(form({ customer_id: 'customer-target' })),
    boundary: () => io.cis.ingestBilling,
  },
] as const

const profileCases = [
  {
    name: 'profile save',
    action: () => saveCustomerProfileImpl(form({
      customer_id: 'customer-target', customer_type: 'private', first_name: 'Test', last_name: 'User',
    })),
  },
  {
    name: 'lifecycle close',
    action: () => closeCustomerLifecycleImpl(form({
      customer_id: 'customer-target', confirm_close: 'AVSLUTA', lifecycle_mode: 'terminate',
    })),
  },
  {
    name: 'test-data mark',
    action: () => markCustomerAsTestDataImpl(form({ customer_id: 'customer-target' })),
  },
  {
    name: 'archive',
    action: () => archiveCustomerImpl(form({
      customer_id: 'customer-target', confirm_archive: 'ARKIVERA',
    })),
  },
] as const

function edielForm(companyId: string) {
  return form({
    companyId,
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
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  io.guardCompanyId = 'A'
  io.targetCompanyId = 'B'
  io.platform = false
  io.permissionsByCompany = {
    A: [
      'switching.write',
      'metering.write',
      'billing_underlay.write',
      'partner_exports.write',
      'masterdata.write',
      'communication.write',
    ],
    B: ['customers.read'],
  }
  io.rowStatus = 'active'
  io.operationalError = null
  io.scopedError = null
  io.mutations = []

  io.adminAccess.mockImplementation(async () => currentGuard())
  io.scopedAccess.mockImplementation(async (companyId: string) => {
    if (io.scopedError) throw io.scopedError
    const guard = currentGuard()
    if (!guard.isPlatformAdmin && (!guard.companyId || guard.companyId !== companyId)) {
      throw new Error('Du saknar behörighet för valt bolag.')
    }
    return guard
  })
  io.operate.mockImplementation(async (
    _userId: string,
    companyId: string | null | undefined,
  ) => {
    if (io.operationalError) throw io.operationalError
    return companyId?.trim() || io.targetCompanyId || 'B'
  })
  io.from.mockImplementation(makeQuery)

  io.cis.updateOutbound.mockRejectedValue(new Error('reached-domain:update-outbound'))
  io.cis.updatePartnerExport.mockRejectedValue(new Error('reached-domain:update-export'))
  io.cis.ingestMetering.mockRejectedValue(new Error('reached-domain:ingest-metering'))
  io.cis.ingestBilling.mockRejectedValue(new Error('reached-domain:ingest-billing'))
  io.graph.mockRejectedValue(new Error('reached-provider-boundary:ediel-graph'))
})

describe('CIS actions retain the canonical guard through entity loading', () => {
  it.each(cisCases)('$name denies selected A -> loaded B before its domain boundary', async ({ action, boundary }) => {
    await expect(action()).rejects.toThrow(/behörighet/)
    expect(boundary()).not.toHaveBeenCalled()
    expect(io.mutations).toEqual([])
  })

  it.each(cisCases)('$name reaches its existing boundary for the same company', async ({ action, boundary }) => {
    io.targetCompanyId = 'A'
    await expect(action()).rejects.toThrow(/reached-domain/)
    expect(boundary()).toHaveBeenCalledOnce()
  })

  it('rejects a missing canonical or row company before the export boundary', async () => {
    io.guardCompanyId = null
    io.targetCompanyId = 'A'
    await expect(cisCases[1].action()).rejects.toThrow(/behörighet/)
    expect(io.cis.updatePartnerExport).not.toHaveBeenCalled()

    io.guardCompanyId = 'A'
    io.targetCompanyId = null
    await expect(cisCases[1].action()).rejects.toThrow(/saknar bolagskoppling/)
    expect(io.cis.updatePartnerExport).not.toHaveBeenCalled()
  })

  it('preserves authoritative platform cross-company access and lifecycle validation', async () => {
    io.platform = true
    await expect(cisCases[1].action()).rejects.toThrow(/reached-domain/)
    expect(io.operate).toHaveBeenCalledWith('actor', 'B', { isPlatformAdmin: true })
    expect(io.cis.updatePartnerExport).toHaveBeenCalledOnce()
  })

  it.each(['paused', 'missing membership'])('keeps %s denial before a domain call', async reason => {
    io.targetCompanyId = 'A'
    io.operationalError = new Error(
      reason === 'paused'
        ? 'Bolaget är pausat eller inte operativt.'
        : 'Du saknar en aktiv bolagskoppling.',
    )
    await expect(cisCases[0].action()).rejects.toThrow()
    expect(io.cis.updateOutbound).not.toHaveBeenCalled()
  })
})

describe('customer-profile actions bind their loaded customer to the original guard', () => {
  it.each(profileCases)('$name denies selected A -> loaded B before any mutation', async ({ action }) => {
    await expect(action()).rejects.toThrow(/behörighet/)
    expect(io.mutations).toEqual([])
  })

  it.each(profileCases)('$name retains its same-company mutation path', async ({ action }) => {
    io.targetCompanyId = 'A'
    await expect(action()).rejects.toThrow(/reached-mutation/)
    expect(io.mutations).toHaveLength(1)
    expect(io.mutations[0].filters.company_id).toBe('A')
  })

  it('denies reverse B -> A and missing canonical or loaded ownership', async () => {
    io.guardCompanyId = 'B'
    io.permissionsByCompany.B = [...io.permissionsByCompany.A]
    io.targetCompanyId = 'A'
    await expect(profileCases[0].action()).rejects.toThrow(/behörighet/)

    io.guardCompanyId = null
    await expect(profileCases[0].action()).rejects.toThrow(/behörighet/)

    io.guardCompanyId = 'A'
    io.targetCompanyId = null
    await expect(profileCases[0].action()).rejects.toThrow(/saknar bolagskoppling/)
    expect(io.mutations).toEqual([])
  })

  it('preserves authoritative platform cross-company access and lifecycle validation', async () => {
    io.platform = true
    await expect(profileCases[0].action()).rejects.toThrow(/reached-mutation/)
    expect(io.operate).toHaveBeenCalledWith('actor', 'B', { isPlatformAdmin: true })
    expect(io.mutations[0].filters.company_id).toBe('B')
  })

  it.each(['paused', 'missing membership'])('keeps %s denial before profile mutation', async reason => {
    io.targetCompanyId = 'A'
    io.operationalError = new Error(
      reason === 'paused'
        ? 'Bolaget är pausat eller inte operativt.'
        : 'Du saknar en aktiv bolagskoppling.',
    )
    await expect(profileCases[0].action()).rejects.toThrow()
    expect(io.mutations).toEqual([])
  })

  it('retains the archived-customer profile lock and confirmation strings', async () => {
    io.targetCompanyId = 'A'
    io.rowStatus = 'archived'
    await expect(profileCases[0].action()).rejects.toThrow(/Arkiverad kund/)
    expect(io.mutations).toEqual([])

    await expect(closeCustomerLifecycleImpl(form({
      customer_id: 'customer-target', confirm_close: 'wrong',
    }))).rejects.toThrow(/AVSLUTA/)
    await expect(archiveCustomerImpl(form({
      customer_id: 'customer-target', confirm_archive: 'wrong',
    }))).rejects.toThrow(/ARKIVERA/)
  })
})

describe('Ediel portal test creation uses the explicit-company allOf guard', () => {
  it.each([
    { selected: 'A', target: 'B' },
    { selected: 'B', target: 'A' },
  ])('denies selected $selected -> submitted $target before the service graph', async ({ selected, target }) => {
    io.guardCompanyId = selected
    io.permissionsByCompany[selected] = [...io.permissionsByCompany.A]
    await expect(createEdielPortalTestCustomerAction(edielForm(target))).rejects.toThrow(/behörighet/)
    expect(io.graph).not.toHaveBeenCalled()
  })

  it('still denies a mismatched submitted company when both companies grant all keys', async () => {
    io.permissionsByCompany.B = [...io.permissionsByCompany.A]
    await expect(createEdielPortalTestCustomerAction(edielForm('B'))).rejects.toThrow(/behörighet/)
    expect(io.scopedAccess).toHaveBeenCalledWith('B', {
      allOf: ['masterdata.write', 'switching.write', 'communication.write'],
    })
    expect(io.graph).not.toHaveBeenCalled()
  })

  it('retains the same-company and authoritative platform graph paths', async () => {
    await expect(createEdielPortalTestCustomerAction(edielForm('A'))).rejects.toThrow(/reached-provider-boundary/)
    expect(io.graph).toHaveBeenCalledOnce()
    expect(io.operate).toHaveBeenCalledWith('actor', 'A', { isPlatformAdmin: false })

    vi.clearAllMocks()
    io.platform = true
    io.graph.mockRejectedValue(new Error('reached-provider-boundary:ediel-graph'))
    await expect(createEdielPortalTestCustomerAction(edielForm('B'))).rejects.toThrow(/reached-provider-boundary/)
    expect(io.graph).toHaveBeenCalledOnce()
    expect(io.operate).toHaveBeenCalledWith('actor', 'B', { isPlatformAdmin: true })
  })

  it.each(['paused', 'missing membership'])('retains %s denial before the graph', async reason => {
    io.guardCompanyId = 'A'
    io.operationalError = new Error(
      reason === 'paused'
        ? 'Bolaget är pausat eller inte operativt.'
        : 'Du saknar en aktiv bolagskoppling.',
    )
    await expect(createEdielPortalTestCustomerAction(edielForm('A'))).rejects.toThrow()
    expect(io.graph).not.toHaveBeenCalled()
  })
})
