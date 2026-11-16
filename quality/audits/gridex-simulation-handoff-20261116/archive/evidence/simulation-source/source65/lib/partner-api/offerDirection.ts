import { ApiInputError, IdempotentWriteNotStartedError } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'

/**
 * Use the same published-offer authority as the contract mutation RPC.
 * Run first inside the claimed execute callback: cached completed writes stay
 * replayable, and validation failure releases the unused claim before uploads.
 */
export async function requirePartnerOfferDirection(input: {
  companyId: string
  offerReference: string
  customerType: string | null
  siteType: 'consumption' | 'production'
  field: string
}): Promise<void> {
  try {
    const result = await supabaseService.rpc('gridex_resolve_partner_api_offer_v1', {
      p_company_id: input.companyId,
      p_offer_reference: input.offerReference,
      p_customer_type: input.customerType,
    })
    if (result.error) throw result.error
    const offer = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as Record<string, unknown>
      : null
    const direction = offer?.energy_direction
    if (direction !== 'consumption' && direction !== 'production') {
      throw new ApiInputError('The selected offer energy direction could not be verified.', 'offer_direction_unavailable', 503)
    }
    if (direction !== input.siteType) {
      throw new ApiInputError(
        'The site electricity type does not match the selected published offer.',
        'site_offer_direction_mismatch',
        422,
        input.field,
      )
    }
  } catch (error) {
    // Neither business rows nor their POA bytes can exist at this boundary.
    throw new IdempotentWriteNotStartedError(error)
  }
}
