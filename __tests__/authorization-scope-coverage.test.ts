import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stateful in-memory tables so the heal path can actually flip coverage.
const state = vi.hoisted(() => ({
  scopes: [] as Array<Record<string, unknown>>,
  authorizationDocuments: [] as Array<Record<string, unknown>>,
  scopeQueryError: null as { code?: string; message: string } | null,
}))

const workflowMocks = vi.hoisted(() => ({
  ensureAuthorizationScopeFromPowerOfAttorney: vi.fn(async () => {
    state.scopes.push({
      id: `scope-${state.scopes.length + 1}`,
      status: 'active',
      revoked_at: null,
      valid_to: null,
      covers_grid_owner_data: false,
      covers_current_supplier_contract: true,
      covers_metering_data: false,
    })
    return `scope-${state.scopes.length}`
  }),
  getSignedPowerOfAttorneyCoverage: vi.fn(async () => ({
    coverage: {
      coversGridOwnerData: false,
      coversCurrentSupplierContract: true,
      coversMeteringData: false,
    },
    signedScopes: ['current_supplier_contract'],
  })),
}))

vi.mock('@/lib/operations/powerOfAttorneyWorkflow', () => workflowMocks)

vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const builder: Record<string, unknown> = {}
      const chain = () => builder
      for (const method of ['select', 'eq', 'is', 'order', 'limit', 'insert', 'update']) {
        builder[method] = chain
      }
      builder.maybeSingle = () => {
        if (table === 'customer_authorization_documents') {
          const doc = state.authorizationDocuments[0] ?? null
          return Promise.resolve({ data: doc, error: null })
        }
        if (table === 'powers_of_attorney') {
          return Promise.resolve({
            data: { id: 'poa-1', document_id: state.authorizationDocuments[0]?.id ?? null },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }
      builder.then = (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        if (table === 'authorization_scopes') {
          if (state.scopeQueryError) {
            return Promise.resolve({ data: null, error: state.scopeQueryError }).then(resolve, reject)
          }
          return Promise.resolve({ data: state.scopes, error: null }).then(resolve, reject)
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      }
      return builder
    },
  },
}))

import { verifyAuthorizationScopeCoverage } from '@/lib/legal/authorizationChain'

beforeEach(() => {
  state.scopes = []
  state.authorizationDocuments = [{ id: 'authdoc-1' }]
  state.scopeQueryError = null
  workflowMocks.ensureAuthorizationScopeFromPowerOfAttorney.mockClear()
})

const BASE_INPUT = {
  companyId: 'company-1',
  customerId: 'customer-1',
  required: ['current_supplier_contract' as const],
}

describe('verifyAuthorizationScopeCoverage', () => {
  it('is covered when an active scope row covers the operation', async () => {
    state.scopes.push({
      id: 'scope-1',
      status: 'active',
      revoked_at: null,
      valid_to: null,
      covers_grid_owner_data: false,
      covers_current_supplier_contract: true,
      covers_metering_data: false,
    })

    const result = await verifyAuthorizationScopeCoverage(BASE_INPUT)

    expect(result).toEqual({ covered: true, missing: [], healed: false, schemaAvailable: true })
    expect(workflowMocks.ensureAuthorizationScopeFromPowerOfAttorney).not.toHaveBeenCalled()
  })

  it('does not count scopes whose valid_to has passed', async () => {
    state.scopes.push({
      id: 'scope-1',
      status: 'active',
      revoked_at: null,
      valid_to: '2000-01-01',
      covers_current_supplier_contract: true,
    })

    const result = await verifyAuthorizationScopeCoverage(BASE_INPUT)

    expect(result.covered).toBe(false)
    expect(result.missing).toEqual(['current_supplier_contract'])
  })

  it('heals the chain idempotently from a signed POA and re-checks', async () => {
    const result = await verifyAuthorizationScopeCoverage({
      ...BASE_INPUT,
      powerOfAttorneyId: 'poa-1',
      healFromPowerOfAttorney: true,
    })

    expect(workflowMocks.ensureAuthorizationScopeFromPowerOfAttorney).toHaveBeenCalledTimes(1)
    expect(result.covered).toBe(true)
    expect(result.healed).toBe(true)
  })

  it('reports uncovered without healing when no POA id is provided', async () => {
    const result = await verifyAuthorizationScopeCoverage({
      ...BASE_INPUT,
      healFromPowerOfAttorney: true,
    })

    expect(workflowMocks.ensureAuthorizationScopeFromPowerOfAttorney).not.toHaveBeenCalled()
    expect(result.covered).toBe(false)
    expect(result.healed).toBe(false)
  })

  it('fails closed with schemaAvailable=false when the scopes table is missing', async () => {
    state.scopeQueryError = { code: '42P01', message: 'relation "authorization_scopes" does not exist' }

    const result = await verifyAuthorizationScopeCoverage({
      ...BASE_INPUT,
      powerOfAttorneyId: 'poa-1',
      healFromPowerOfAttorney: true,
    })

    expect(result.covered).toBe(false)
    expect(result.schemaAvailable).toBe(false)
    // No healing attempt against a database without the scope schema.
    expect(workflowMocks.ensureAuthorizationScopeFromPowerOfAttorney).not.toHaveBeenCalled()
  })

  it('propagates real database errors instead of swallowing them', async () => {
    state.scopeQueryError = { code: '57014', message: 'canceling statement due to statement timeout' }

    await expect(verifyAuthorizationScopeCoverage(BASE_INPUT)).rejects.toMatchObject({
      code: '57014',
    })
  })
})
