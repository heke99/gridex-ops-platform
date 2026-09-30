import { describe, expect, it } from 'vitest'
import { assertPublicResponsePayload, PublicPayloadSafetyError } from '@/lib/api/publicPayloadSafety'
import { publicPortalCustomer } from '@/lib/customer-portal/publicDto'

describe('delegated customer contact read', () => {
  it('returns the saved revision and canonical contact email independently of login identity', () => {
    expect(publicPortalCustomer({
      customer_number: 'SYN-1', email: 'contact@example.invalid',
      phone: '+46123456789', contact_revision: 4,
    }, { email: 'login@example.invalid', customer_number: 'SYN-1' })).toMatchObject({
      email: 'contact@example.invalid', phone: '+46123456789', contact_revision: 4,
    })
  })

  it('does not fabricate a revision on a schema without the column', () => {
    expect(publicPortalCustomer({ phone: '+46123456789' }, {})).toMatchObject({
      contact_revision: null,
    })
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
