/**
 * Controlled rollout of the customer-portal identity rules (tenantservice P1a).
 *
 * - `enforce`: reads never create or re-verify portal links, an unlinked presented user is
 *   rejected (`customer_portal_link_required`), and end-customer mutations require an actively
 *   linked portal account (`customer_identity_binding_required`).
 * - `report` (default until tenant clients are migrated): the previous behaviour is kept for
 *   existing integrations, and every request that `enforce` would reject is logged as
 *   `portal_identity_would_reject`, so the cut-over can be measured per API client first.
 *
 * Independent of this flag: blocked/revoked links are never reactivated, identities are never
 * repointed, and new endpoints (customer support) always enforce.
 */
export type PortalIdentityEnforcement = 'enforce' | 'report'

export function portalIdentityEnforcement(): PortalIdentityEnforcement {
  return process.env.GRIDEX_PORTAL_IDENTITY_ENFORCEMENT?.trim().toLowerCase() === 'enforce' ? 'enforce' : 'report'
}

export function reportPortalIdentityWouldReject(input: { code: string; companyId: string; apiClientId?: string | null; method?: string }) {
  console.warn('[customer-portal] portal_identity_would_reject', {
    code: input.code,
    company_id: input.companyId,
    api_client_id: input.apiClientId ?? null,
    method: input.method ?? null,
  })
}
