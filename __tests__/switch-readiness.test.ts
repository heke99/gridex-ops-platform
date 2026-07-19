import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'

// ---------------------------------------------------------------------------
// Mocked collaborators for the unified checkSupplierSwitchReadiness gate.
// ---------------------------------------------------------------------------

const dbMocks = vi.hoisted(() => ({
  findCustomerSiteById: vi.fn(),
  listMeteringPointsForSite: vi.fn(),
  listPowersOfAttorneyByCustomerId: vi.fn(),
  findOpenSupplierSwitchRequestForSite: vi.fn(),
}))

const collaboratorMocks = vi.hoisted(() => ({
  evaluateSupplierSwitchSchedule: vi.fn(),
  findActiveSwitchLifecycleBlock: vi.fn(),
  evaluateCustomerProcessRouteReadiness: vi.fn(),
  getGridOwnerVerification: vi.fn(),
  verifyAuthorizationScopeCoverage: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const response =
        table === 'customer_contracts'
          ? { data: { id: 'contract-1' }, error: null, count: 1 }
          : table === 'customer_contract_lifecycle_readiness_v'
            ? {
                data: {
                  customer_contract_id: 'contract-1',
                  company_id: 'company-1',
                  customer_id: 'customer-1',
                  customer_site_id: 'site-1',
                  accepted_document_count: 5,
                  blockers: [],
                  switch_ready: true,
                },
                error: null,
                count: 1,
              }
            : { data: null, error: null, count: 1 }
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(response).then(resolve),
      }
      return builder
    },
  },
}))
vi.mock('@/lib/operations/db', () => dbMocks)
vi.mock('@/lib/operations/supplierSwitchScheduler', () => ({
  evaluateSupplierSwitchSchedule: collaboratorMocks.evaluateSupplierSwitchSchedule,
}))
vi.mock('@/lib/operations/switchLifecycleBlocks', () => ({
  findActiveSwitchLifecycleBlock: collaboratorMocks.findActiveSwitchLifecycleBlock,
}))
vi.mock('@/lib/customer-operations/customerProcessRouteReadiness', () => ({
  evaluateCustomerProcessRouteReadiness: collaboratorMocks.evaluateCustomerProcessRouteReadiness,
}))
vi.mock('@/lib/grid-owners/verification', () => ({
  getGridOwnerVerification: collaboratorMocks.getGridOwnerVerification,
}))
vi.mock('@/lib/legal/authorizationChain', () => ({
  verifyAuthorizationScopeCoverage: collaboratorMocks.verifyAuthorizationScopeCoverage,
}))

import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-05-15T12:00:00Z')

function site(overrides: Partial<CustomerSiteRow> = {}): CustomerSiteRow {
  return {
    id: 'site-1',
    customer_id: 'customer-1',
    site_name: 'Villa Ekbacken',
    facility_id: '735999000000000001',
    grid_owner_id: 'grid-owner-1',
    price_area_code: 'SE3',
    grid_area_code: 'STH',
    move_in_date: '2026-04-01',
    current_supplier_name: 'Gamla Elbolaget AB',
    ...overrides,
  } as CustomerSiteRow
}

function meteringPoint(overrides: Partial<MeteringPointRow> = {}): MeteringPointRow {
  return {
    id: 'mp-1',
    site_id: 'site-1',
    meter_point_id: '735999000000000001',
    ediel_reference: null,
    status: 'active',
    grid_owner_id: 'grid-owner-1',
    price_area_code: 'SE3',
    grid_area_code: 'STH',
    ...overrides,
  } as MeteringPointRow
}

function signedPoa(overrides: Partial<PowerOfAttorneyRow> = {}): PowerOfAttorneyRow {
  return {
    id: 'poa-1',
    customer_id: 'customer-1',
    site_id: null,
    scope: 'supplier_switch',
    status: 'signed',
    signed_at: '2026-04-20T10:00:00Z',
    valid_from: '2026-04-20',
    valid_to: null,
    document_path: 'poa/poa-1.pdf',
    reference: 'POA-1',
    notes: null,
    created_at: '2026-04-20T10:00:00Z',
    updated_at: '2026-04-20T10:00:00Z',
    created_by: null,
    updated_by: null,
    ...overrides,
  } as PowerOfAttorneyRow
}

// ---------------------------------------------------------------------------
// Pure site readiness: every blocker class
// ---------------------------------------------------------------------------

describe('evaluateSiteSwitchReadiness (pure)', () => {
  it('is ready when POA is signed and the metering point is complete', () => {
    const result = evaluateSiteSwitchReadiness({
      site: site(),
      meteringPoints: [meteringPoint()],
      powersOfAttorney: [signedPoa()],
      now: NOW,
    })

    expect(result.isReady).toBe(true)
    expect(result.issues).toHaveLength(0)
    expect(result.candidateMeteringPointId).toBe('mp-1')
    expect(result.latestPowerOfAttorneyId).toBe('poa-1')
  })

  it.each([
    ['power_of_attorney_missing', { powersOfAttorney: [] as PowerOfAttorneyRow[] }],
    ['power_of_attorney_not_signed', { powersOfAttorney: [signedPoa({ status: 'draft' as PowerOfAttorneyRow['status'] })] }],
  ])('flags %s', (code, overrides) => {
    const result = evaluateSiteSwitchReadiness({
      site: site(),
      meteringPoints: [meteringPoint()],
      powersOfAttorney: overrides.powersOfAttorney,
      now: NOW,
    })
    expect(result.isReady).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain(code)
  })

  it('flags an expired POA as not valid', () => {
    const result = evaluateSiteSwitchReadiness({
      site: site(),
      meteringPoints: [meteringPoint()],
      powersOfAttorney: [signedPoa({ valid_to: '2026-01-01' })],
      now: NOW,
    })
    expect(result.issues.map((issue) => issue.code)).toContain('power_of_attorney_not_signed')
  })

  it('flags metering_point_missing when the site has no metering points', () => {
    const result = evaluateSiteSwitchReadiness({
      site: site(),
      meteringPoints: [],
      powersOfAttorney: [signedPoa()],
      now: NOW,
    })
    expect(result.issues.map((issue) => issue.code)).toContain('metering_point_missing')
  })

  it('flags meter_point_id_missing when the point lacks id and verified Ediel reference', () => {
    const result = evaluateSiteSwitchReadiness({
      site: site(),
      meteringPoints: [meteringPoint({ meter_point_id: null, ediel_reference: null })],
      powersOfAttorney: [signedPoa()],
      now: NOW,
    })
    expect(result.issues.map((issue) => issue.code)).toContain('meter_point_id_missing')
  })

  it('flags grid owner / grid area / price area gaps', () => {
    const result = evaluateSiteSwitchReadiness({
      site: site({ grid_owner_id: null, grid_area_code: null, price_area_code: null }),
      meteringPoints: [meteringPoint({ grid_owner_id: null, grid_area_code: null, price_area_code: null })],
      powersOfAttorney: [signedPoa()],
      now: NOW,
    })
    const codes = result.issues.map((issue) => issue.code)
    expect(codes).toContain('grid_owner_missing')
    expect(codes).toContain('grid_area_missing')
    expect(codes).toContain('price_area_missing')
  })

  it('flags missing current supplier and move-in date as normal-priority issues', () => {
    const result = evaluateSiteSwitchReadiness({
      site: site({ current_supplier_name: null, move_in_date: null }),
      meteringPoints: [meteringPoint()],
      powersOfAttorney: [signedPoa()],
      now: NOW,
    })
    const normalIssues = result.issues.filter((issue) => issue.priority === 'normal')
    expect(normalIssues.map((issue) => issue.code).sort()).toEqual([
      'current_supplier_missing',
      'move_in_date_missing',
    ])
  })
})

// ---------------------------------------------------------------------------
// Unified gate: tenancy, duplicate switch, snapshot shape
// ---------------------------------------------------------------------------

function primeHappyPath() {
  dbMocks.findCustomerSiteById.mockResolvedValue({ ...site(), company_id: 'company-1' })
  dbMocks.listMeteringPointsForSite.mockResolvedValue([meteringPoint()])
  dbMocks.listPowersOfAttorneyByCustomerId.mockResolvedValue([signedPoa()])
  dbMocks.findOpenSupplierSwitchRequestForSite.mockResolvedValue(null)
  collaboratorMocks.findActiveSwitchLifecycleBlock.mockResolvedValue(null)
  collaboratorMocks.getGridOwnerVerification.mockResolvedValue({
    gridOwnerId: 'grid-owner-1',
    verificationStatus: 'verified',
    canStartSupplierSwitch: true,
    canUseForProdat: true,
    verifiedForCustomerFlow: true,
    nextAction: null,
  })
  collaboratorMocks.evaluateCustomerProcessRouteReadiness.mockResolvedValue({
    ready: true,
    routeProfileId: 'route-profile-1',
    communicationRouteId: 'route-1',
    family: 'PRODAT',
    code: 'Z03',
    blockers: [],
    warnings: [],
  })
  collaboratorMocks.evaluateSupplierSwitchSchedule.mockResolvedValue({ ok: true, window: null, blockers: [] })
  collaboratorMocks.verifyAuthorizationScopeCoverage.mockResolvedValue({
    covered: true,
    missing: [],
    healed: false,
    schemaAvailable: true,
  })
}

const BASE_INPUT = {
  companyId: 'company-1',
  customerId: 'customer-1',
  siteId: 'site-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  primeHappyPath()
})

describe('checkSupplierSwitchReadiness (unified gate)', () => {
  it('is ready and produces a versioned readiness snapshot when all systems pass', async () => {
    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(true)
    expect(result.blockers).toHaveLength(0)
    expect(result.nextRequiredAction).toBe('Redo för leverantörsbyte.')

    expect(result.readinessSnapshot).toMatchObject({
      version: 'supplier_switch_readiness_v1',
      company_id: 'company-1',
      customer_id: 'customer-1',
      site_id: 'site-1',
      ready: true,
    })
    expect(result.readinessSnapshot.evaluated_at).toBeTruthy()
    expect(result.readinessSnapshot.site_readiness).toMatchObject({ is_ready: true })
    expect(Array.isArray(result.readinessSnapshot.blockers)).toBe(true)
    expect(Array.isArray(result.readinessSnapshot.warnings)).toBe(true)
  })

  it('blocks when the site belongs to another tenant', async () => {
    dbMocks.findCustomerSiteById.mockResolvedValue({ ...site(), company_id: 'company-2' })

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(['site_not_found'])
    expect(result.site).toBeNull()
  })

  it('blocks a duplicate switch when an open supplier switch already exists', async () => {
    dbMocks.findOpenSupplierSwitchRequestForSite.mockResolvedValue({ id: 'switch-1', status: 'sent' })

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('duplicate_open_supplier_switch')
    expect(result.openSwitchRequestId).toBe('switch-1')
  })

  it('allows re-validation of an existing switch without flagging itself as duplicate', async () => {
    dbMocks.findOpenSupplierSwitchRequestForSite.mockResolvedValue({ id: 'switch-1', status: 'sent' })

    const result = await checkSupplierSwitchReadiness({ ...BASE_INPUT, switchRequestId: 'switch-1' })

    expect(result.blockers.map((blocker) => blocker.code)).not.toContain('duplicate_open_supplier_switch')
    expect(result.openSwitchRequestId).toBe('switch-1')
  })

  it('blocks when the grid owner is not verified for supplier switches', async () => {
    collaboratorMocks.getGridOwnerVerification.mockResolvedValue({
      gridOwnerId: 'grid-owner-1',
      verificationStatus: 'unverified',
      canStartSupplierSwitch: false,
      canUseForProdat: false,
      verifiedForCustomerFlow: false,
      nextAction: 'Verifiera nätägaren.',
    })

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('grid_owner_not_verified')
  })

  it('propagates EDIEL route blockers', async () => {
    collaboratorMocks.evaluateCustomerProcessRouteReadiness.mockResolvedValue({
      ready: false,
      routeProfileId: null,
      communicationRouteId: null,
      family: 'PRODAT',
      code: 'Z03',
      blockers: [{ code: 'route_profile_missing', message: 'Ruttprofil saknas.' }],
      warnings: [],
    })

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.some((blocker) => blocker.source === 'route_readiness')).toBe(true)
  })

  it('blocks with authorization_scope_missing when the canonical scope chain does not cover the switch', async () => {
    collaboratorMocks.verifyAuthorizationScopeCoverage.mockResolvedValue({
      covered: false,
      missing: ['current_supplier_contract'],
      healed: false,
      schemaAvailable: true,
    })

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('authorization_scope_missing')
    expect(result.readinessSnapshot.authorization_scope).toMatchObject({
      covered: false,
      missing: ['current_supplier_contract'],
    })
    // Healing must have been attempted from the signed POA before blocking.
    expect(collaboratorMocks.verifyAuthorizationScopeCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        customerId: 'customer-1',
        required: ['current_supplier_contract'],
        powerOfAttorneyId: 'poa-1',
        healFromPowerOfAttorney: true,
      }),
    )
  })

  it('skips the scope check (POA blocker already present) when no POA exists', async () => {
    dbMocks.listPowersOfAttorneyByCustomerId.mockResolvedValue([])

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('power_of_attorney_missing')
    expect(collaboratorMocks.verifyAuthorizationScopeCoverage).not.toHaveBeenCalled()
  })

  it('fails closed when the authorization scope schema is missing', async () => {
    collaboratorMocks.verifyAuthorizationScopeCoverage.mockResolvedValue({
      covered: false,
      missing: ['current_supplier_contract'],
      healed: false,
      schemaAvailable: false,
    })

    const result = await checkSupplierSwitchReadiness(BASE_INPUT)

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('authorization_scope_missing')
  })

  it('merges scheduler blockers when re-validating a scheduled switch', async () => {
    collaboratorMocks.evaluateSupplierSwitchSchedule.mockResolvedValue({
      ok: false,
      window: { opensAt: '2026-06-01' },
      blockers: [{ code: 'supplier_switch_send_window_not_open', message: 'Sändfönstret är inte öppet.' }],
    })
    dbMocks.findOpenSupplierSwitchRequestForSite.mockResolvedValue({ id: 'switch-1', status: 'scheduled' })

    const result = await checkSupplierSwitchReadiness({ ...BASE_INPUT, switchRequestId: 'switch-1' })

    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toContain('supplier_switch_send_window_not_open')
    expect(result.readinessSnapshot.schedule).toMatchObject({ ok: false })
  })
})
