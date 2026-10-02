import { describe, expect, it } from 'vitest'
import { publicPortalCustomer } from '@/lib/customer-portal/publicDto'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'

const COMPANY_A = '00000000-0000-4000-8000-00000000000a'
const COMPANY_B = '00000000-0000-4000-8000-00000000000b'
const CUSTOMER = '10000000-0000-4000-8000-000000000001'
const EXTERNAL_ID = '20000000-0000-4000-8000-000000000001'

describe('customer public reference uses the verified organization and customer', () => {
  it('allows a UUID external customer ID through the mounted response safety boundary', async () => {
    const customer = publicPortalCustomer({ id: CUSTOMER, company_id: COMPANY_A }, { external_customer_id: EXTERNAL_ID }, COMPANY_A)
    const response = customerPortalJson({ data: customer })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.data.customer_reference).toMatch(/^customer_[A-Za-z0-9_-]{32}$/)
    expect(payload.data.external_customer_id).toBe(EXTERNAL_ID)
    expect(payload.data).not.toHaveProperty('id')
    expect(payload.data).not.toHaveProperty('company_id')
  })

  it('keeps the customer reference stable when local identifiers differ and partitions it by organization', () => {
    const first = publicPortalCustomer({ id: CUSTOMER }, { external_customer_id: EXTERNAL_ID }, COMPANY_A)
    const same = publicPortalCustomer({ id: CUSTOMER }, { external_customer_id: 'another-local-id' }, COMPANY_A)
    const other = publicPortalCustomer({ id: CUSTOMER }, { external_customer_id: EXTERNAL_ID }, COMPANY_B)
    expect(first.customer_reference).toBe(same.customer_reference)
    expect(first.customer_reference).not.toBe(other.customer_reference)
  })
})
