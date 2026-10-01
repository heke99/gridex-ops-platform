import { describe, expect, it } from 'vitest'
import { assertPublicResponsePayload, PublicPayloadSafetyError } from '@/lib/api/publicPayloadSafety'
import { publicPortalCustomer, publicPortalSite } from '@/lib/customer-portal/publicDto'

describe('delegated customer contact read', () => {
  it('returns the saved revision and canonical contact email independently of login identity', () => {
    expect(publicPortalCustomer({
      customer_number: 'SYN-1', email: 'contact@example.invalid',
      phone: '+46123456789', contact_revision: 4,
    }, { email: 'login@example.invalid', customer_number: 'SYN-1' })).toMatchObject({
      email: 'contact@example.invalid', phone: '+46123456789', contact_revision: 4,
    })
  })

  it('does not substitute login identity email for an absent canonical contact email', () => {
    expect(publicPortalCustomer({ email: null }, { email: 'login@example.invalid' })).toMatchObject({ email: null })
  })

  it('does not fabricate a revision on a schema without the column', () => {
    expect(publicPortalCustomer({ phone: '+46123456789' }, {})).toMatchObject({
      contact_revision: null,
    })
  })

  it('returns the billing revision independently of contact revision without billing internals', () => {
    const profile = publicPortalCustomer({ contact_revision: 4, billing_profile_revision: 7,
      billing_profile_email: 'billing@example.invalid', billing_profile_scope: 'legacy_internal' }, {})
    expect(profile).toMatchObject({ contact_revision: 4, billing_revision: 7 })
    expect(profile).not.toHaveProperty('billing_profile_email')
    expect(profile).not.toHaveProperty('billing_profile_scope')
    expect(publicPortalCustomer({}, {})).toMatchObject({ billing_revision: null })
    expect(publicPortalCustomer({ billing_profile_revision: -1 }, {})).toMatchObject({ billing_revision: null })
    expect(publicPortalCustomer({ billing_profile_revision: 1.5 }, {})).toMatchObject({ billing_revision: null })
  })

  it('returns separate preferences and site revisions without raw metadata', () => {
    const customer = publicPortalCustomer({ profile_revision: 2, preferred_language: 'sv', portal_timezone: 'Europe/Stockholm',
      metadata: { unrelated_private_text: 'Never publish' } }, {})
    expect(customer).toMatchObject({ profile_revision: 2, language_code: 'sv', timezone: 'Europe/Stockholm' })
    expect(customer).not.toHaveProperty('metadata')
    expect(publicPortalCustomer({}, {})).toMatchObject({ profile_revision: null })
    expect(publicPortalSite('tenant-a', { id: '11111111-1111-4111-8111-111111111111', address_revision: 3 }))
      .toMatchObject({ address_revision: 3 })
    expect(publicPortalSite('tenant-a', {})).toMatchObject({ address_revision: null })
  })

  it('keeps synthetic business numbers distinct from internal UUIDs at the public response gate', () => {
    const internalId = '5a87fbce-f40a-44e2-9e1f-bb252e7de060'
    const profile = publicPortalCustomer({ customer_number: 'P2-A-5A87FBCE', contact_revision: 2 },
      { customer_number: 'P2-A-5A87FBCE' })
    expect(() => assertPublicResponsePayload({ data: profile })).not.toThrow()
    const unsafe = publicPortalCustomer({ customer_number: internalId, contact_revision: 2 },
      { customer_number: internalId })
    expect(() => assertPublicResponsePayload({ data: unsafe })).toThrow(PublicPayloadSafetyError)
  })
})
