import { describe, expect, it } from 'vitest'
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
})
