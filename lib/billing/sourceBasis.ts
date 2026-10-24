import { supabaseService } from '@/lib/supabase/service'
import { isCanonicalUtiltsDecimal } from '@/lib/ediel/utilts/exactDecimal'

export type BillingSourceBasis = {
  version: 1
  qualified: boolean
  reason: string | null
  normalizedValueId: string
  sourceMessageId: string | null
  quantityKwh: string
  quantityType: '136' | null
  quality: string | null
  qualityEstablished: boolean
  productCode: string | null
  contractHash: string | null
  sourcePayloadHash: string | null
  observationOrdinal: number | null
}

/** Ids per read call. G-6: each value costs ~7-10 ms plus ~100 ms once per source file and call, so 1000 ids spread
 * over a month's files (~10 s) exceeded the 8 s statement timeout; 250 ids of ~3 files take ~2-3 s. */
export const BILLING_SOURCE_READ_CHUNK = 250

/** The database qualifies the immutable contract, original and exact numeric
 * row together. A cached billing gate or mutable parsed metadata grants nothing.
 * `sourceOf` (value id -> source message id) only orders the calls so that values of one source file share a call;
 * the result and every check are the same for any order. */
export async function loadQualifiedBillingValues(companyId: string, valueIds: readonly string[], sourceOf?: ReadonlyMap<string, string>): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>()
  const ids = [...new Set(valueIds)]
  const requested = new Set(ids)
  const ordered = sourceOf ? [...ids].sort((a, b) => (sourceOf.get(a) ?? '').localeCompare(sourceOf.get(b) ?? '') || a.localeCompare(b)) : ids
  for (let offset = 0; offset < ordered.length; offset += BILLING_SOURCE_READ_CHUNK) {
    const { data, error } = await supabaseService.rpc('gridex_read_billing_source_values_v1', { p_company_id: companyId, p_value_ids: ordered.slice(offset, offset + BILLING_SOURCE_READ_CHUNK) })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('billing_source_basis_result_invalid')
    for (const row of data as Array<Record<string, unknown>>) {
      const id = row.id
      const basis = row.billing_source_basis as BillingSourceBasis | undefined
      if (typeof id !== 'string' || result.has(id) || !requested.has(id) || !basis || basis.version !== 1 || basis.normalizedValueId !== id || !isCanonicalUtiltsDecimal(basis.quantityKwh) || row.quantity_kwh !== basis.quantityKwh) throw new Error('billing_source_basis_result_invalid')
      result.set(id, row)
    }
  }
  if (result.size !== ids.length) throw new Error('billing_source_basis_value_missing')
  return result
}
