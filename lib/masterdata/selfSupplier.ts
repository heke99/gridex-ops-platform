import type { SupabaseClient } from '@supabase/supabase-js'
import type { ElectricitySupplierRow } from '@/lib/masterdata/types'

export type OwnElectricitySupplierResolution =
  | 'explicit_flag'
  | 'legacy_exact_gridex_name'
  | 'legacy_partial_gridex_name'
  | 'not_found'

export type OwnElectricitySupplierLookupResult = {
  supplier: ElectricitySupplierRow | null
  resolution: OwnElectricitySupplierResolution
}

const OWN_SUPPLIER_NAME_CANDIDATES = ['Gridex'] as const

export async function resolveOwnElectricitySupplier(
  supabase: SupabaseClient
): Promise<OwnElectricitySupplierLookupResult> {
  const explicit = await supabase
    .from('electricity_suppliers')
    .select('*')
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

  for (const candidate of OWN_SUPPLIER_NAME_CANDIDATES) {
    const exact = await supabase
      .from('electricity_suppliers')
      .select('*')
      .eq('is_active', true)
      .ilike('name', candidate)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (exact.error) throw exact.error

    if (exact.data) {
      return {
        supplier: exact.data as ElectricitySupplierRow,
        resolution: 'legacy_exact_gridex_name',
      }
    }
  }

  for (const candidate of OWN_SUPPLIER_NAME_CANDIDATES) {
    const partial = await supabase
      .from('electricity_suppliers')
      .select('*')
      .eq('is_active', true)
      .ilike('name', `%${candidate}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (partial.error) throw partial.error

    if (partial.data) {
      return {
        supplier: partial.data as ElectricitySupplierRow,
        resolution: 'legacy_partial_gridex_name',
      }
    }
  }

  return {
    supplier: null,
    resolution: 'not_found',
  }
}

export async function setOwnElectricitySupplier(
  supabase: SupabaseClient,
  supplierId: string
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const actorId = user?.id ?? null

  const clearPrevious = await supabase
    .from('electricity_suppliers')
    .update({
      is_own_supplier: false,
      updated_by: actorId,
    })
    .eq('is_own_supplier', true)

  if (clearPrevious.error) throw clearPrevious.error

  const setCurrent = await supabase
    .from('electricity_suppliers')
    .update({
      is_own_supplier: true,
      updated_by: actorId,
    })
    .eq('id', supplierId)

  if (setCurrent.error) throw setCurrent.error
}