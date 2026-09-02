import type { SupabaseClient } from '@supabase/supabase-js'
import type { ElectricitySupplierRow } from '@/lib/masterdata/types'

/**
 * F-9: the own-supplier record is per tenant.
 *
 * The previous implementation resolved "our own supplier" globally and fell back
 * to matching the hardcoded name "Gridex", which attributed every tenant's
 * supplier switches to one company. Its setter cleared `is_own_supplier` on every
 * row in the database, so one tenant marking its own supplier silently unmarked
 * every other tenant's.
 *
 * Both operations now require a company and never read or write outside it.
 */

export type OwnElectricitySupplierResolution =
  | 'explicit_flag'
  | 'company_name_match'
  | 'not_found'

export type OwnElectricitySupplierLookupResult = {
  supplier: ElectricitySupplierRow | null
  resolution: OwnElectricitySupplierResolution
}

function requireCompanyId(companyId: string | null | undefined): string {
  const normalized = companyId?.trim()
  if (!normalized) {
    throw new Error(
      'Bolag krävs för att avgöra vilken leverantör som är den egna. Egen leverantör är alltid bolagsspecifik.',
    )
  }
  return normalized
}

export async function resolveOwnElectricitySupplier(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
): Promise<OwnElectricitySupplierLookupResult> {
  const scopedCompanyId = requireCompanyId(companyId)

  const explicit = await supabase
    .from('electricity_suppliers')
    .select('*')
    .eq('company_id', scopedCompanyId)
    .eq('is_active', true)
    .eq('is_own_supplier', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (explicit.error) throw explicit.error

  if (explicit.data) {
    return {
      supplier: explicit.data as ElectricitySupplierRow,
      resolution: 'explicit_flag',
    }
  }

  // Fallback for tenants that have not yet marked a row: match the company's own
  // registered name. Scoped to the company, so it can never resolve to another
  // tenant's supplier the way the old hardcoded name fallback did.
  const company = await supabase
    .from('companies')
    .select('name')
    .eq('id', scopedCompanyId)
    .maybeSingle()

  if (company.error) throw company.error

  const companyName = (company.data as { name?: string | null } | null)?.name?.trim()
  if (!companyName) {
    return { supplier: null, resolution: 'not_found' }
  }

  const byName = await supabase
    .from('electricity_suppliers')
    .select('*')
    .eq('company_id', scopedCompanyId)
    .eq('is_active', true)
    .ilike('name', companyName)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (byName.error) throw byName.error

  if (byName.data) {
    return {
      supplier: byName.data as ElectricitySupplierRow,
      resolution: 'company_name_match',
    }
  }

  return { supplier: null, resolution: 'not_found' }
}

/**
 * Returns an `electricity_suppliers` row that belongs to `companyId`.
 *
 * The supplier register holds both shared counterparty records (`company_id IS
 * NULL`) and tenant-owned ones. An own-supplier record must be tenant-owned — the
 * database enforces this via `electricity_suppliers_own_requires_company` — so a
 * shared row is cloned into the company rather than claimed in place, which would
 * have marked it as every tenant's own supplier.
 */
async function ensureCompanyOwnedSupplier(
  supabase: SupabaseClient,
  companyId: string,
  supplierId: string,
  actorId: string | null,
): Promise<string> {
  const target = await supabase
    .from('electricity_suppliers')
    .select('*')
    .eq('id', supplierId)
    .maybeSingle()

  if (target.error) throw target.error
  if (!target.data) {
    throw new Error('Leverantören kunde inte hittas i leverantörsregistret.')
  }

  const row = target.data as ElectricitySupplierRow & { company_id?: string | null }

  if (row.company_id === companyId) return row.id

  if (row.company_id) {
    throw new Error('Leverantören tillhör ett annat bolag och kan inte markeras som den egna.')
  }

  const shared: Record<string, unknown> = { ...(row as Record<string, unknown>) }
  // the clone is a new row in this company, so it takes fresh identity and stamps
  delete shared.id
  delete shared.created_at
  delete shared.updated_at

  const clone = await supabase
    .from('electricity_suppliers')
    .insert({
      ...shared,
      company_id: companyId,
      is_own_supplier: false,
      created_by: actorId,
      updated_by: actorId,
    })
    .select('id')
    .single()

  if (clone.error) throw clone.error
  return (clone.data as { id: string }).id
}

export async function setOwnElectricitySupplier(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  supplierId: string,
): Promise<string> {
  const scopedCompanyId = requireCompanyId(companyId)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const actorId = user?.id ?? null

  const ownedSupplierId = await ensureCompanyOwnedSupplier(
    supabase,
    scopedCompanyId,
    supplierId,
    actorId,
  )

  // Scoped to this company: marking our own supplier must not touch any other
  // tenant's flag.
  const clearPrevious = await supabase
    .from('electricity_suppliers')
    .update({
      is_own_supplier: false,
      updated_by: actorId,
    })
    .eq('company_id', scopedCompanyId)
    .eq('is_own_supplier', true)

  if (clearPrevious.error) throw clearPrevious.error

  const setCurrent = await supabase
    .from('electricity_suppliers')
    .update({
      is_own_supplier: true,
      updated_by: actorId,
    })
    .eq('company_id', scopedCompanyId)
    .eq('id', ownedSupplierId)

  if (setCurrent.error) throw setCurrent.error

  return ownedSupplierId
}
