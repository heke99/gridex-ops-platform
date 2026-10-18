import { supabaseService } from '@/lib/supabase/service'
import { strictIsoDate } from '@/lib/time/stockholm'
import { canonicalProdatSubtypeForMessage } from '@/lib/ediel/rulebook/canonicalEdielFacade'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

export type ManualSupplierReadinessInput = {
  companyId: string
  customerId: string
  siteId: string
  site: CustomerSiteRow
  requestType?: string | null
  requestStatus?: string | null
  transactionSubtype?: string | null
  requestedStartDate?: string | null
  /** Creation calculates an absent date; an existing dispatch must already have one. */
  requireRequestedStartDate?: boolean
}

export type ManualSupplierReadinessResult = {
  ready: boolean
  blockers: Array<{ code: string; message: string }>
  snapshot: {
    applies: boolean
    responseStatus: string | null
    terminationFee: number | null
    manualTermsPresent: boolean
    sourceVerified: boolean | null
    earliestSupplierStartDate: string | null
    requestedStartDate: string | null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

const STATUS_BLOCKERS: Record<string, string> = {
  waiting_response: 'Invänta svar om kundens nuvarande leverantörsavtal.',
  manual_review: 'Leverantörens avtalsuppgifter behöver granskas innan bytet skickas.',
  binding_period: 'Kundens bindningstid blockerar leverantörsbytet.',
  termination_fee: 'Brytavgiften behöver hanteras innan leverantörsbytet skickas.',
  blocked: 'Nuvarande leverantörsavtal blockerar leverantörsbytet.',
}

/** Hard commercial dispatch guards, independent of optional site-quality warnings. */
export async function evaluateManualSupplierReadiness(input: ManualSupplierReadinessInput): Promise<ManualSupplierReadinessResult> {
  const requestType = String(input.requestType ?? 'switch').trim().toLowerCase()
  const requestStatus = String(input.requestStatus ?? '').trim().toLowerCase()
  const subtype = canonicalProdatSubtypeForMessage('Z03', input.transactionSubtype)
  const applies = requestType === 'switch' && subtype !== 'LK' && subtype !== 'C' && requestStatus !== 'cancellation_requested'
  const metadata = record((input.site as CustomerSiteRow & { metadata?: unknown }).metadata)
  const manualTermsPresent = metadata !== null && Object.hasOwn(metadata, 'manual_supplier_terms')
  const responseStatus = input.site.current_supplier_response_status?.trim().toLowerCase() || null
  const rawFee = input.site.current_supplier_termination_fee
  const terminationFee = rawFee == null ? null : Number(rawFee)
  const result: ManualSupplierReadinessResult = {
    ready: true,
    blockers: [],
    snapshot: {
      applies, responseStatus, terminationFee: terminationFee !== null && Number.isFinite(terminationFee) ? terminationFee : null,
      manualTermsPresent, sourceVerified: null, earliestSupplierStartDate: null,
      requestedStartDate: typeof input.requestedStartDate === 'string' ? input.requestedStartDate.trim() || null : null,
    },
  }
  if (!applies) return result

  const block = (code: string, message: string) => {
    if (!result.blockers.some((entry) => entry.code === code)) result.blockers.push({ code, message })
    result.ready = false
  }
  const unverified = () => {
    result.snapshot.sourceVerified = false
    block('supplier_commercial_source_unverified', 'Leverantörens avtalsuppgifter kunde inte verifieras mot rätt inkommande svar. Bytet är blockerat.')
  }

  if (input.site.id !== input.siteId || input.site.company_id !== input.companyId || input.site.customer_id !== input.customerId) {
    unverified()
    return result
  }
  if (responseStatus && Object.hasOwn(STATUS_BLOCKERS, responseStatus)) block(`current_supplier_${responseStatus}`, STATUS_BLOCKERS[responseStatus])
  if (terminationFee !== null && terminationFee > 0) block('current_supplier_termination_fee', STATUS_BLOCKERS.termination_fee)
  if (!result.ready || !manualTermsPresent) return result

  const snapshot = record(metadata?.manual_supplier_terms)
  if (!snapshot || snapshot.version !== 1 || !record(snapshot.terms)
    || snapshot.companyId !== input.companyId || snapshot.customerId !== input.customerId || snapshot.siteId !== input.siteId) {
    unverified()
    return result
  }

  // Neither a site field nor a previously saved readiness snapshot proves the
  // counterpart's date. Verify the current exact source on every dispatch.
  try {
    const scope = { p_company_id: input.companyId, p_customer_id: input.customerId, p_site_id: input.siteId }
    const floor = await supabaseService.rpc('gridex_manual_supplier_start_floor_v1', scope)
    if (floor.error) { unverified(); return result }
    const earliest = strictIsoDate(floor.data, 'supplier_start_floor')
    const source = await supabaseService.rpc('gridex_manual_supplier_terms_verified_v1', { ...scope, p_snapshot: snapshot })
    if (source.error || source.data !== true) { unverified(); return result }
    result.snapshot.sourceVerified = true
    result.snapshot.earliestSupplierStartDate = earliest

    if (!result.snapshot.requestedStartDate && input.requireRequestedStartDate === false) return result
    let requested: string
    try {
      requested = strictIsoDate(result.snapshot.requestedStartDate, 'requested_start_date')
    } catch {
      block('current_supplier_start_date_missing', 'Ett giltigt startdatum behöver beräknas och sparas innan leverantörsbytet skickas.')
      return result
    }
    if (requested < earliest) block('supplier_commercial_start_too_early', `Startdatumet ${requested} är tidigare än leverantörens verifierade tidigaste start ${earliest}.`)
  } catch {
    unverified()
  }
  return result
}
