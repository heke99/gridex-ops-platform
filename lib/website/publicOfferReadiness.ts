import { supabaseService } from '@/lib/supabase/service'

/**
 * A readiness assessment result for public contract offers. This shape is used
 * consistently across admin UI, the public contracts API and the live
 * customer intake. When `isReady` is false the offer must not be visible on
 * public endpoints and cannot be published. The `blockers` array contains
 * human‑readable strings in Swedish which can be displayed in admin tools to
 * explain why the offer is not ready. Customer‑facing endpoints should
 * provide a generic message instead of exposing internal details.
 */
export type PublicOfferReadiness = {
  /** Whether the offer is considered ready for publication */
  isReady: boolean
  /** A list of reasons why the offer is blocked. Empty if isReady is true */
  blockers: string[]
}

/**
 * Assess whether a given public contract offer is ready to be published or
 * consumed by the website signup flow. This function centralises all
 * readiness checks so that both admin and live systems are consistent. It
 * should be updated as new readiness signals are introduced (e.g. mail
 * readiness or billing readiness).
 *
 * The current implementation performs a minimal set of checks:
 *  - Tenant launch state must be `ready` or `live`.
 *  - The offer must reference a non‑null legal_bundle_id and price_book_id.
 *
 * Additional checks such as API client readiness, allowed origins,
 * canonical price book immutability and Ediel/facility readiness can be
 * introduced here by querying Supabase. Keep this function idempotent and
 * side‑effect free.
 */
export async function assessPublicOfferReadiness(input: {
  companyId: string
  offer: { legal_bundle_id?: string | null; price_book_id?: string | null }
}): Promise<PublicOfferReadiness> {
  const blockers: string[] = []
  // Check tenant launch state
  try {
    const { data: state, error } = await supabaseService
      .from('tenant_launch_states')
      .select('status')
      .eq('company_id', input.companyId)
      .maybeSingle()
    if (error) throw error
    const status = state?.status
    if (!status || !['ready', 'live'].includes(status)) {
      blockers.push('Tenant är inte redo för go‑live')
    }
  } catch (err) {
    // If the table does not exist yet we assume readiness cannot be
    // determined. Do not throw here to avoid crashing public endpoints.
    blockers.push('Kunde inte kontrollera tenantens status')
  }

  // Require legal bundle and price book references
  if (!input.offer.legal_bundle_id) {
    blockers.push('Juridiskt paket saknas')
  }
  if (!input.offer.price_book_id) {
    blockers.push('Prislista saknas')
  }

  // Additional readiness signals could be added here, e.g. checking that
  // required API clients exist and are configured with allowed origins, or
  // verifying that a customer number sequence is set up. Keep checks
  // additive so that missing database columns simply add blockers rather
  // than throwing exceptions.

  return { isReady: blockers.length === 0, blockers }
}