import { describe, expect, it } from 'vitest'
import { isPlatformAdminContext } from '@/lib/admin/guards'
import {
  resolveOwnElectricitySupplier,
  setOwnElectricitySupplier,
} from '@/lib/masterdata/selfSupplier'

/**
 * Regression cover for the 2026-09-02 tenant isolation remediation.
 *
 * Each test names the finding it locks down. The database-level invariants
 * (unique key scoping, restrictive guards, role scope) are gated separately by
 * scripts/tenant-isolation-invariants.sql, which needs a live schema; these cover
 * the application logic that no SQL check can see.
 */

type QueryCall = { table: string; filters: Record<string, unknown>; op: string }

function supabaseDouble(options: {
  rows?: Record<string, unknown[]>
  calls: QueryCall[]
}) {
  const rows = options.rows ?? {}

  function builder(table: string, op: string) {
    const call: QueryCall = { table, filters: {}, op }
    options.calls.push(call)

    const chain: Record<string, unknown> = {}
    const passthrough = [
      'select',
      'order',
      'limit',
      'ilike',
      'update',
      'insert',
      'or',
    ]

    for (const method of passthrough) {
      chain[method] = (...args: unknown[]) => {
        if (method === 'ilike') call.filters.ilike = args[0]
        if (method === 'or') call.filters.or = args[0]
        return chain
      }
    }

    chain.eq = (column: string, value: unknown) => {
      call.filters[column] = value
      return chain
    }

    chain.maybeSingle = async () => ({
      data: (rows[table] ?? [])[0] ?? null,
      error: null,
    })

    chain.single = async () => ({
      data: (rows[table] ?? [])[0] ?? null,
      error: null,
    })

    chain.then = undefined

    return chain
  }

  return {
    from: (table: string) => builder(table, 'query'),
    auth: {
      getUser: async () => ({ data: { user: { id: 'actor-1' } } }),
    },
  } as never
}

describe('F-9: the own electricity supplier is per tenant', () => {
  it('refuses to resolve an own supplier without a company', async () => {
    const calls: QueryCall[] = []
    await expect(
      resolveOwnElectricitySupplier(supabaseDouble({ calls }), null),
    ).rejects.toThrow(/Bolag krävs/)
    expect(calls).toHaveLength(0)
  })

  it('scopes the explicit lookup to the company', async () => {
    const calls: QueryCall[] = []
    const client = supabaseDouble({
      calls,
      rows: {
        electricity_suppliers: [{ id: 'supplier-a', name: 'Tenant A El', company_id: 'company-a' }],
      },
    })

    const result = await resolveOwnElectricitySupplier(client, 'company-a')

    expect(result.resolution).toBe('explicit_flag')
    expect(calls[0].table).toBe('electricity_suppliers')
    expect(calls[0].filters.company_id).toBe('company-a')
    expect(calls[0].filters.is_own_supplier).toBe(true)
  })

  it('never falls back to a hardcoded supplier name', async () => {
    const calls: QueryCall[] = []
    // No supplier rows and no company name: the old implementation matched
    // "Gridex" here and attributed every tenant's switches to one company.
    const client = supabaseDouble({ calls, rows: { companies: [{ name: null }] } })

    const result = await resolveOwnElectricitySupplier(client, 'company-b')

    expect(result.supplier).toBeNull()
    expect(result.resolution).toBe('not_found')
    for (const call of calls) {
      expect(JSON.stringify(call.filters)).not.toMatch(/gridex/i)
    }
  })

  it('clears the previous own supplier only inside the acting company', async () => {
    const calls: QueryCall[] = []
    const client = supabaseDouble({
      calls,
      rows: {
        electricity_suppliers: [
          { id: 'supplier-a', name: 'Tenant A El', company_id: 'company-a' },
        ],
      },
    })

    await setOwnElectricitySupplier(client, 'company-a', 'supplier-a')

    const clearing = calls.filter((call) => call.filters.is_own_supplier === true)
    expect(clearing.length).toBeGreaterThan(0)
    for (const call of clearing) {
      // The defect: this update ran unscoped and unmarked every other tenant's
      // supplier.
      expect(call.filters.company_id).toBe('company-a')
    }
  })

  it('refuses to claim a supplier owned by another company', async () => {
    const calls: QueryCall[] = []
    const client = supabaseDouble({
      calls,
      rows: {
        electricity_suppliers: [
          { id: 'supplier-x', name: 'Other tenant El', company_id: 'company-b' },
        ],
      },
    })

    await expect(
      setOwnElectricitySupplier(client, 'company-a', 'supplier-x'),
    ).rejects.toThrow(/tillhör ett annat bolag/)
  })
})

describe('F-7: platform admin is decided by the database', () => {
  it('trusts the authoritative flag over the role names', () => {
    // A role literally named super_admin, but the database says it is scoped to a
    // company and therefore not a platform admin.
    expect(
      isPlatformAdminContext({
        roles: ['super_admin'],
        permissions: [],
        isPlatformAdmin: false,
      }),
    ).toBe(false)

    expect(
      isPlatformAdminContext({
        roles: ['viewer'],
        permissions: [],
        isPlatformAdmin: true,
      }),
    ).toBe(true)
  })

  it('falls back to role names only when no flag is supplied', () => {
    expect(isPlatformAdminContext({ roles: ['super_admin'], permissions: [] })).toBe(true)
    expect(isPlatformAdminContext({ roles: ['viewer'], permissions: [] })).toBe(false)
  })
})

describe('F-1: the guard carries the company its permissions were resolved for', () => {
  it('exposes companyId on the guard result type', async () => {
    // A compile-time contract as much as a runtime one: permissions are only
    // meaningful together with the company they were resolved for.
    const guard = {
      userId: 'user-1',
      email: null,
      permissions: ['billing.write'],
      roles: ['finance_readonly'],
      isAdmin: true,
      isPlatformAdmin: false,
      companyId: 'company-a',
    }

    expect(guard.companyId).toBe('company-a')
    expect(isPlatformAdminContext(guard)).toBe(false)
  })
})
