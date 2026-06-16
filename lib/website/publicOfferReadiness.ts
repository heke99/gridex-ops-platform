import { supabaseService } from '@/lib/supabase/service'

/**
 * A readiness assessment result for public contract offers. This shape is used
 * consistently across admin UI, the public contracts API and the live
 * customer intake. When `isReady` is false the offer must not be visible on
 * public endpoints and cannot be published. The `blockers` array contains
 * human-readable strings in Swedish which can be displayed in admin tools to
 * explain why the offer is not ready. Customer-facing endpoints should
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
 * consumed by the website signup flow. Keep this check scoped to website/API
 * publication only.
 *
 * Important separation:
 *  - Internal contract creation/activation must not require website/API.
 *  - Website/API publication must not require Ediel/PRODAT production go-live.
 *  - Ediel production go-live is checked only when sending live Ediel flows.
 *
 * Current publication checks:
 *  - The offer must reference a legal bundle and a price book.
 *  - The tenant must have an active API client with website_contracts.read.
 */
export async function assessPublicOfferReadiness(input: {
  companyId: string
  offer: { legal_bundle_id?: string | null; price_book_id?: string | null }
}): Promise<PublicOfferReadiness> {
  const blockers: string[] = []

  if (!input.offer.legal_bundle_id) {
    blockers.push('Juridiskt paket saknas')
  }
  if (!input.offer.price_book_id) {
    blockers.push('Prislista saknas')
  }

  try {
    const { data: client, error } = await supabaseService
      .from('integration_api_clients')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('status', 'active')
      .contains('scopes', ['website_contracts.read'])
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!client) blockers.push('Aktiv API-klient med behörigheten website_contracts.read saknas')
  } catch (err) {
    blockers.push('Kunde inte kontrollera API-klient för hemsideavtal')
  }

  return { isReady: blockers.length === 0, blockers }
}
