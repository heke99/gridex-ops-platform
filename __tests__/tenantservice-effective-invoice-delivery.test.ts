import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveEffectiveInvoiceDelivery } from '@/lib/billing/effectiveInvoiceDelivery'

describe('effective invoice delivery (P3)', () => {
  const customer = {
    full_name: 'Anna Andersson',
    invoice_email: 'faktura@example.test',
    billing_street: 'Kundgatan 1',
    billing_postal_code: '11122',
    billing_city: 'Stockholm',
  }

  it('inherits the customer billing profile when the contract has no exception', () => {
    const delivery = resolveEffectiveInvoiceDelivery({ contract: {}, customer })
    expect(delivery).toMatchObject({
      recipient: 'Anna Andersson',
      email: 'faktura@example.test',
      emailSource: 'customer_billing_profile',
      postalAddressSource: 'customer_billing_profile',
      inheritsCustomerProfile: true,
    })
  })

  it('a contract exception wins and is reported as such (one of two contracts has its own recipient)', () => {
    const own = resolveEffectiveInvoiceDelivery({ contract: { invoice_email: 'ekonomi@bolag.test' }, customer })
    const inherited = resolveEffectiveInvoiceDelivery({ contract: {}, customer: { ...customer, invoice_email: 'ny@example.test' } })
    expect(own.email).toBe('ekonomi@bolag.test')
    expect(own.emailSource).toBe('contract_override')
    expect(own.inheritsCustomerProfile).toBe(false)
    expect(inherited.email).toBe('ny@example.test')
  })

  it('never falls back to the general contact email', () => {
    const delivery = resolveEffectiveInvoiceDelivery({
      contract: {},
      customer: { full_name: 'Anna', email: 'kontakt@example.test' } as never,
    })
    expect(delivery.email).toBeNull()
    expect(delivery.emailSource).toBeNull()
  })

  it('never mixes address parts from different sources', () => {
    const delivery = resolveEffectiveInvoiceDelivery({
      contract: { billing_street: 'Avtalsvägen 2' },
      customer,
    })
    expect(delivery.postalAddress).toEqual({ street: 'Kundgatan 1', postalCode: '11122', city: 'Stockholm', country: 'SE' })
    expect(delivery.postalAddressSource).toBe('customer_billing_profile')
  })

  it('readiness, invoice review and export all use the shared resolver', () => {
    for (const path of ['lib/billing/billingReadiness.ts', 'lib/billing/invoiceReviewPrepare.ts', 'lib/billing/exportCenter.ts']) {
      expect(readFileSync(path, 'utf8')).toContain('resolveEffectiveInvoiceDelivery(')
    }
  })
})
