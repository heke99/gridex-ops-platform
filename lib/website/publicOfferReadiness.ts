import { supabaseService } from '@/lib/supabase/service'

export type PublicOfferReadiness = {
  isReady: boolean
  blockers: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(clean).filter((item): item is string => Boolean(item))
    : []
}

/**
 * Canonical publication readiness. The public website and customer intake are
 * only allowed to consume the exact immutable publication version approved by
 * the database publication command. Legacy bundle/price checks are deliberately
 * not repeated here because a second readiness implementation can disagree with
 * the transaction that published the offer.
 */
export async function assessPublicOfferReadiness(input: {
  companyId: string
  offer: {
    contract_publication_version_id?: string | null
    metadata?: Record<string, unknown> | null
  }
}): Promise<PublicOfferReadiness> {
  const publicationVersionId = clean(input.offer.contract_publication_version_id)
    ?? clean(input.offer.metadata?.contract_publication_version_id)

  if (!publicationVersionId) {
    return { isReady: false, blockers: ['Kanonisk publiceringsversion saknas'] }
  }

  const { data, error } = await supabaseService
    .from('contract_publication_readiness_v')
    .select('contract_publication_version_id,company_id,status,locked_at,blockers')
    .eq('contract_publication_version_id', publicationVersionId)
    .eq('company_id', input.companyId)
    .maybeSingle()

  if (error) throw error
  if (!data) return { isReady: false, blockers: ['Publiceringsversionen hittades inte för bolaget'] }

  const blockers = stringArray(data.blockers)
  if (clean(data.status) !== 'published') blockers.push('Publiceringsversionen är inte publicerad')
  if (!clean(data.locked_at)) blockers.push('Publiceringsversionen är inte låst')

  return { isReady: blockers.length === 0, blockers: Array.from(new Set(blockers)) }
}
