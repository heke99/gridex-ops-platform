import { publicReference } from '@/lib/integrations/publicReferences'

type PublicIdentitySource = {
  id: string | null
  status?: string | null
  match_strength?: string | null
  match_method?: string | null
  linked_at?: string | null
  last_seen_at?: string | null
}

export type PublicPortalIdentityV1 = {
  portal_identity_reference: string
  status: string | null
  match_strength: string | null
  match_method: string | null
  linked_at: string | null
  last_seen_at: string | null
}

/**
 * Explicit public projection of an internal customer_portal_identities row.
 * Internal UUIDs, tenant keys, provider subject IDs and auth user IDs are
 * intentionally excluded from the public API contract.
 */
export function publicPortalIdentity(
  companyId: string,
  identity: PublicIdentitySource,
): PublicPortalIdentityV1 {
  if (!identity.id) {
    throw new Error('portal_identity_reference_unavailable')
  }

  return {
    portal_identity_reference: publicReference(
      'portal_identity',
      companyId,
      identity.id,
    ),
    status: identity.status ?? null,
    match_strength: identity.match_strength ?? null,
    match_method: identity.match_method ?? null,
    linked_at: identity.linked_at ?? null,
    last_seen_at: identity.last_seen_at ?? null,
  }
}
