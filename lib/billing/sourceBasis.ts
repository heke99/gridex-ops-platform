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

/** The database qualifies the immutable contract, original and exact numeric
 * row together. A cached billing gate or mutable parsed metadata grants nothing. */
export async function loadQualifiedBillingValues(companyId: string, valueIds: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>()
  const ids = [...new Set(valueIds)]
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const { data, error } = await supabaseService.rpc('gridex_read_billing_source_values_v1', { p_company_id: companyId, p_value_ids: ids.slice(offset, offset + 1000) })
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('billing_source_basis_result_invalid')
    for (const row of data as Array<Record<string, unknown>>) {
      const id = row.id
      const basis = row.billing_source_basis as BillingSourceBasis | undefined
      if (typeof id !== 'string' || result.has(id) || !ids.includes(id) || !basis || basis.version !== 1 || basis.normalizedValueId !== id || !isCanonicalUtiltsDecimal(basis.quantityKwh) || row.quantity_kwh !== basis.quantityKwh) throw new Error('billing_source_basis_result_invalid')
      result.set(id, row)
    }
  }
  if (result.size !== ids.length) throw new Error('billing_source_basis_value_missing')
  return result
}
