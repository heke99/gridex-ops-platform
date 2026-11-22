import { afterEach, describe, expect, it } from 'vitest'
import { evaluateContractBillingAccountReadiness } from '@/lib/billing/billingReadiness'
import { resolveInvoiceDeliveryFor } from '@/lib/billing/effectiveInvoiceDelivery'

const customer = { full_name: 'Anna', email: 'kontakt@example.test', invoice_email: null, billing_street: 'Kundgatan 1', billing_postal_code: '11122', billing_city: 'Stockholm' }

describe('invoice delivery rollout flag (default legacy)', () => {
  afterEach(() => { delete process.env.GRIDEX_INVOICE_DELIVERY_RESOLVER })

  it('legacy reproduces the previous per-consumer behaviour', () => {
    expect(resolveInvoiceDeliveryFor('readiness', { contract: {}, customer }, 'legacy').email).toBe('kontakt@example.test')
    expect(resolveInvoiceDeliveryFor('document', { contract: {}, customer }, 'legacy')).toMatchObject({ email: null, recipient: null, postalAddress: null })
    expect(resolveInvoiceDeliveryFor('document', { contract: { invoice_email: 'e@x.se', invoice_recipient: 'R' }, customer }, 'legacy'))
      .toMatchObject({ email: 'e@x.se', recipient: 'R' })
  })

  it('shared uses the single resolver without contact-email fallback for every consumer', () => {
    for (const consumer of ['readiness', 'document'] as const) {
      expect(resolveInvoiceDeliveryFor(consumer, { contract: {}, customer }, 'shared')).toMatchObject({ email: null, recipient: 'Anna', postalAddressSource: 'customer_billing_profile' })
    }
  })

  it('readiness keeps the old contact-email fallback by default and drops it with the flag', () => {
    const input = { contract: { vat_rate: 25 }, customer: { full_name: 'Anna', email: 'kontakt@example.test' }, paymentTerms: { dueDays: 30 } }
    expect(evaluateContractBillingAccountReadiness(input).evidence.invoice_email).toBe('kontakt@example.test')
    process.env.GRIDEX_INVOICE_DELIVERY_RESOLVER = 'shared'
    expect(evaluateContractBillingAccountReadiness(input).evidence.invoice_email).toBeNull()
  })

  it('same-as-site with a complete site address stays deliverable in both modes', () => {
    const input = { contract: { vat_rate: 25, billing_address_same_as_site: true }, customer: { full_name: 'Anna' }, paymentTerms: { dueDays: 30 },
      billingProfile: { siteAddress: { street: 'Väg 1', postalCode: '11122', city: 'Sthlm' } } }
    expect(evaluateContractBillingAccountReadiness(input as never).evidence.has_postal_invoice_address).toBe(true)
    process.env.GRIDEX_INVOICE_DELIVERY_RESOLVER = 'shared'
    expect(evaluateContractBillingAccountReadiness(input as never).evidence.has_postal_invoice_address).toBe(true)
  })

  it('blocks legacy seller readiness when neither source has a complete postal address', () => {
    const readiness = evaluateContractBillingAccountReadiness({
      contract: { billing_street: 'Avtalsgatan 2', vat_rate: 25 },
      customer: { full_name: 'Syntetisk kund', billing_postal_code: '00100', billing_city: 'Helsingfors' },
      paymentTerms: { dueDays: 30 },
    })

    expect(readiness.evidence.has_postal_invoice_address).toBe(false)
    expect(readiness.blockers).toContainEqual(expect.objectContaining({ code: 'invoice_distribution_missing' }))
  })

  it('takes the full Finnish profile alongside an incomplete legacy contract address', () => {
    const customer = { full_name: 'Syntetisk kund', billing_street: 'Kundgatan 3', billing_postal_code: '00100', billing_city: 'Helsingfors', billing_country: 'FI' }
    const contract = { billing_street: 'Avtalsgatan 2', billing_country: 'SE', vat_rate: 25 }

    const readiness = evaluateContractBillingAccountReadiness({ contract, customer, paymentTerms: { dueDays: 30 } })
    expect(readiness.evidence.has_postal_invoice_address).toBe(true)
    expect(resolveInvoiceDeliveryFor('readiness', { contract, customer }, 'legacy')).toMatchObject({
      postalAddress: { street: 'Kundgatan 3', postalCode: '00100', city: 'Helsingfors', country: 'FI' },
      postalAddressSource: 'customer_billing_profile',
    })
    expect(resolveInvoiceDeliveryFor('document', { contract, customer }, 'legacy')).toMatchObject({
      postalAddress: null,
      postalAddressSource: null,
    })
  })

  it('keeps a complete legacy contract address and its country ahead of the customer profile', () => {
    const contract = { billing_street: 'Avtalsgatan 2', billing_postal_code: '2100', billing_city: 'Köpenhamn', billing_country: 'DK' }
    for (const consumer of ['readiness', 'document'] as const) {
      expect(resolveInvoiceDeliveryFor(consumer, { contract, customer }, 'legacy')).toMatchObject({
        postalAddress: { street: 'Avtalsgatan 2', postalCode: '2100', city: 'Köpenhamn', country: 'DK' },
        postalAddressSource: 'contract_override',
      })
    }
  })
})
