import { describe, expect, it } from 'vitest'
import { assertPortalIdentityTransitionAllowed } from '@/lib/customer-portal/identityTransition'

const USER = 'user-1'
const CUSTOMER = 'customer-1'

function codeOf(fn: () => void): string | null {
  try {
    fn()
    return null
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
}

describe('portal identity sync transition guard (F5)', () => {
  it('allows creating a new identity and re-linking the same user to the same customer', () => {
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(null, { customerId: CUSTOMER, authUserId: USER, dbStatus: 'active' }))).toBeNull()
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(
      { status: 'active', customer_id: CUSTOMER, auth_user_id: USER, customer_portal_user_id: USER },
      { customerId: CUSTOMER, authUserId: USER, dbStatus: 'active' },
    ))).toBeNull()
  })

  it('allows a pending identity without customer to advance to a link', () => {
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(
      { status: 'pending_review', customer_id: null, auth_user_id: USER },
      { customerId: CUSTOMER, authUserId: USER, dbStatus: 'active' },
    ))).toBeNull()
  })

  it('refuses to repoint an identity to another customer or clear its customer', () => {
    const existing = { status: 'active', customer_id: CUSTOMER, auth_user_id: USER }
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(existing, { customerId: 'customer-2', authUserId: USER, dbStatus: 'active' }))).toBe('portal_identity_customer_conflict')
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(existing, { customerId: null, authUserId: USER, dbStatus: 'pending_review' }))).toBe('portal_identity_customer_conflict')
  })

  it('refuses to take over an identity bound to another portal user', () => {
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(
      { status: 'active', customer_id: CUSTOMER, customer_portal_user_id: 'user-2' },
      { customerId: CUSTOMER, authUserId: USER, dbStatus: 'active' },
    ))).toBe('portal_identity_user_conflict')
  })

  it('refuses to downgrade an active link or revive a disabled identity', () => {
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(
      { status: 'active', customer_id: CUSTOMER, auth_user_id: USER },
      { customerId: CUSTOMER, authUserId: USER, dbStatus: 'rejected' },
    ))).toBe('portal_identity_downgrade_refused')
    expect(codeOf(() => assertPortalIdentityTransitionAllowed(
      { status: 'disabled', customer_id: CUSTOMER, auth_user_id: USER },
      { customerId: CUSTOMER, authUserId: USER, dbStatus: 'active' },
    ))).toBe('portal_identity_blocked')
  })
})
