import { ApiInputError } from '@/lib/api/strictRequest'

/**
 * A sync may create or advance an identity, but never repoint it to another customer or portal
 * user, clear its customer, downgrade an active link, or revive a disabled one.
 */
export function assertPortalIdentityTransitionAllowed(
  existing: Record<string, unknown> | null,
  next: { customerId: string | null; authUserId: string; dbStatus: string },
): void {
  if (!existing) return
  const text = (key: string) => (typeof existing[key] === 'string' && existing[key] ? String(existing[key]) : null)
  const status = text('status')?.toLowerCase() ?? null
  const boundCustomer = text('customer_id')
  const boundUser = text('customer_portal_user_id') ?? text('auth_user_id')
  const conflict = (reason: string) => {
    throw new ApiInputError('Portalidentiteten kan inte ändras via sync. Kontakta tenantens kundtjänst.', reason, 409, 'external_customer_id')
  }
  if (status && ['disabled', 'revoked', 'blocked', 'suspended'].includes(status)) conflict('portal_identity_blocked')
  if (boundUser && boundUser !== next.authUserId) conflict('portal_identity_user_conflict')
  if (boundCustomer && next.customerId !== boundCustomer) conflict('portal_identity_customer_conflict')
  if (status === 'active' && boundCustomer && next.dbStatus !== 'active') conflict('portal_identity_downgrade_refused')
}
