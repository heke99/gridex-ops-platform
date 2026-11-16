import { resolvePublicContractOffer } from '@/lib/website/publicContracts'

type Input = Parameters<typeof resolvePublicContractOffer>[0]
type Offer = Awaited<ReturnType<typeof resolvePublicContractOffer>>

const pending = new Map<string, Promise<Offer>>()
const MAX_PENDING_KEYS = 64

/**
 * Public quote requests may share an already running canonical offer read.
 * There is no completed cache or stale fallback. Every canonical graph, legal
 * and pricing guard remains in the original resolver. Authentication, customer
 * resolution, quote calculation and persistence run separately for each caller.
 * Final applications and other callers keep the original unshared resolver.
 */
export async function resolveQuotePublicContractOffer(input: Input): Promise<Offer> {
  if ((input.channel && input.channel !== 'website') || !input.offerReference?.trim() ||
    !input.client.id?.trim() || !input.client.company_id?.trim() ||
    !['private', 'business'].includes(input.customerType ?? '') || input.allowLegacyLookup ||
    input.pricePlanVersionId || input.pricePlanId || input.contractOfferId || input.productCode) {
    return resolvePublicContractOffer(input)
  }
  const key = JSON.stringify([input.client.company_id, input.client.id, input.offerReference, input.customerType])
  const existing = pending.get(key)
  if (existing) return structuredClone(await existing)
  if (pending.size >= MAX_PENDING_KEYS) return resolvePublicContractOffer(input)

  const request = resolvePublicContractOffer(input)
  pending.set(key, request)
  try {
    return structuredClone(await request)
  } finally {
    if (pending.get(key) === request) pending.delete(key)
  }
}
