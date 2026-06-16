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

const REQUIRED_PUBLIC_LEGAL_TYPES = ['terms', 'privacy_policy', 'withdrawal', 'power_of_attorney', 'price_terms'] as const

function missingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return ['42P01', '42703', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist|relationship/i.test(message)
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function validateLegalBundle(companyId: string, legalBundleId: string | null | undefined, blockers: string[]) {
  if (!legalBundleId) {
    blockers.push('Juridiskt paket saknas')
    return
  }

  const bundle = await supabaseService
    .from('legal_bundles')
    .select('id,company_id,status')
    .eq('id', legalBundleId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (bundle.error) {
    if (missingSchema(bundle.error)) return
    throw bundle.error
  }
  if (!bundle.data) {
    blockers.push('Juridiskt paket hittades inte för bolaget')
    return
  }
  if (!['published', 'active'].includes(clean(bundle.data.status) ?? 'draft')) {
    blockers.push('Juridiskt paket är inte publicerat')
  }

  const items = await supabaseService
    .from('legal_bundle_items')
    .select('legal_text_version_id,type')
    .eq('legal_bundle_id', legalBundleId)

  if (items.error) {
    if (missingSchema(items.error)) return
    throw items.error
  }

  const itemRows = (items.data ?? []) as Array<{ legal_text_version_id?: string | null; type?: string | null }>
  const ids = Array.from(new Set(itemRows.map((row) => clean(row.legal_text_version_id)).filter(Boolean))) as string[]
  if (ids.length === 0) {
    blockers.push('Juridiskt paket saknar texter')
    return
  }

  const versions = await supabaseService
    .from('legal_text_versions')
    .select('id,type,status,company_id')
    .eq('company_id', companyId)
    .eq('status', 'published')
    .in('id', ids)

  if (versions.error) {
    if (missingSchema(versions.error)) return
    throw versions.error
  }

  const present = new Set((versions.data ?? []).map((row) => clean(row.type)).filter(Boolean))
  const missing = REQUIRED_PUBLIC_LEGAL_TYPES.filter((type) => !present.has(type))
  if (missing.length > 0) blockers.push('Juridiskt paket saknar publicerade texter')
}

async function validatePriceBook(companyId: string, priceBookId: string | null | undefined, blockers: string[]) {
  if (!priceBookId) {
    blockers.push('Prislista saknas')
    return
  }

  const { data, error } = await supabaseService
    .from('price_books')
    .select('id,company_id,status')
    .eq('id', priceBookId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    if (missingSchema(error)) return
    throw error
  }
  if (!data) {
    blockers.push('Prislista hittades inte för bolaget')
    return
  }
  if (!['published', 'active'].includes(clean(data.status) ?? 'draft')) {
    blockers.push('Prislistan är inte publicerad/aktiv')
  }
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
 *  - The offer must reference a published legal bundle and active/published price book.
 *  - The tenant must have an active API client with website_contracts.read.
 */
export async function assessPublicOfferReadiness(input: {
  companyId: string
  offer: { legal_bundle_id?: string | null; price_book_id?: string | null }
}): Promise<PublicOfferReadiness> {
  const blockers: string[] = []

  await validateLegalBundle(input.companyId, input.offer.legal_bundle_id, blockers)
  await validatePriceBook(input.companyId, input.offer.price_book_id, blockers)

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
