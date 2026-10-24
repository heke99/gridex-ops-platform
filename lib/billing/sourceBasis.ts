import { registerServerManualReceivedEnds } from './manualReceivedEndAuthority'
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
      registerServerManualReceivedEnds(row, companyId, basis.qualified ? row.billing_manual_received_end_authorities ?? [] : [])
      result.set(id, row)
    }
  }
  if (result.size !== ids.length) throw new Error('billing_source_basis_value_missing')
  return result
}

/** The existing service-only underlay projection rechecks the immutable source
 * binding before any in-process manual-end capability is registered. */
export async function loadQualifiedBillingUnderlaySources(companyId: string, rows: readonly Record<string, unknown>[]): Promise<Map<string, Record<string, unknown>>> {
  const ids = rows.map(row => String(row.id))
  if (ids.length > 1000 || new Set(ids).size !== ids.length) throw new Error('invoice_underlay_source_basis_invalid')
  const { data, error } = await supabaseService.rpc('gridex_read_billing_underlay_source_basis_v1', { p_company_id: companyId, p_underlay_ids: ids })
  if (error) throw error
  if (!Array.isArray(data) || data.length !== rows.length) throw new Error('invoice_underlay_source_basis_missing')
  const bases = new Map<string, Record<string, unknown>>()
  for (const raw of data as Array<Record<string, unknown>>) {
    const id = String(raw.id)
    if (!ids.includes(id) || bases.has(id) || (raw.totalKwh !== null && !isCanonicalUtiltsDecimal(raw.totalKwh))) throw new Error('invoice_underlay_source_basis_invalid')
    bases.set(id, raw)
  }
  for (const row of rows) {
    const basis = bases.get(String(row.id))!
    registerServerManualReceivedEnds(row, companyId, basis.qualified === true && basis.correctionRequired !== true ? basis.manualReceivedEndAuthorities ?? [] : [])
  }
  return bases
}
