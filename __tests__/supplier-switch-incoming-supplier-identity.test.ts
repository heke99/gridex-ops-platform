// FINDINGS F42: every automatic supplier switch failed with "Bolaget saknar en registrerad egen elhandlare"
// because no admin page creates the tenant's own electricity_suppliers row. The incoming supplier on a
// switch to us is a name/org.nr label (the Ediel identity on the wire comes from the tenant's actor
// settings), so the tenant itself is the incoming supplier unless a marked own row exists.
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveIncomingSupplierIdentity } from '@/lib/masterdata/selfSupplier'

type Row = Record<string, unknown>
/** Filters rows like PostgREST for eq/ilike, and records which tables and filters were read. */
function database(tables: Record<string, Row[]>, reads: Array<{ table: string; filters: Row }>) {
  return {
    from(table: string) {
      const filters: Row = {}
      const conditions: Array<(row: Row) => boolean> = []
      const chain = {
        select: () => chain, order: () => chain, limit: () => chain,
        eq: (column: string, value: unknown) => { filters[column] = value; conditions.push(row => row[column] === value); return chain },
        ilike: (column: string, value: string) => { filters[`${column}~`] = value; conditions.push(row => String(row[column] ?? '').toLowerCase() === value.toLowerCase()); return chain },
        maybeSingle: async () => { reads.push({ table, filters }); return { data: (tables[table] ?? []).filter(row => conditions.every(c => c(row)))[0] ?? null, error: null } },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const company = { id: 'company-a', name: 'Gridex El AB', org_number: '5590000000' }
const otherTenantOwnRow = { id: 'supplier-b', company_id: 'company-b', name: 'Annat Elbolag AB', org_number: '5560000000', is_active: true, is_own_supplier: true }

describe('resolveIncomingSupplierIdentity', () => {
  it('uses the tenant itself when no own-supplier row exists', async () => {
    const reads: Array<{ table: string; filters: Row }> = []
    const result = await resolveIncomingSupplierIdentity(database({ companies: [company], electricity_suppliers: [otherTenantOwnRow] }, reads), 'company-a')
    expect(result).toEqual({ name: 'Gridex El AB', orgNumber: '5590000000', resolution: 'company_identity' })
    // Every supplier read is scoped to the tenant; another tenant's own row is never used.
    expect(reads.filter(r => r.table === 'electricity_suppliers').every(r => r.filters.company_id === 'company-a')).toBe(true)
    expect(reads.find(r => r.table === 'companies')?.filters).toEqual({ id: 'company-a' })
  })

  it('a marked own-supplier row still wins', async () => {
    const own = { id: 'supplier-a', company_id: 'company-a', name: 'Gridex El Försäljning AB', org_number: '5591111111', is_active: true, is_own_supplier: true }
    const result = await resolveIncomingSupplierIdentity(database({ companies: [company], electricity_suppliers: [own] }, []), 'company-a')
    expect(result).toEqual({ name: 'Gridex El Försäljning AB', orgNumber: '5591111111', resolution: 'explicit_flag' })
  })

  it('a company-scoped row with the company name keeps its own org.nr', async () => {
    const byName = { id: 'supplier-a', company_id: 'company-a', name: 'gridex el ab', org_number: '5592222222', is_active: true, is_own_supplier: false }
    const result = await resolveIncomingSupplierIdentity(database({ companies: [company], electricity_suppliers: [byName] }, []), 'company-a')
    expect(result).toMatchObject({ orgNumber: '5592222222', resolution: 'company_name_match' })
  })

  it('returns nothing when the company has no name, and refuses without a company', async () => {
    expect(await resolveIncomingSupplierIdentity(database({ companies: [{ id: 'company-a', name: ' ', org_number: null }] }, []), 'company-a')).toBeNull()
    await expect(resolveIncomingSupplierIdentity(database({}, []), null)).rejects.toThrow(/Bolag krävs/)
  })
})
