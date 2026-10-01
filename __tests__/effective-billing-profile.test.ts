import { describe, expect, it } from 'vitest'
import { resolveEffectiveBillingProfile, readLockedEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { evaluateContractBillingAccountReadiness } from '@/lib/billing/billingReadiness'
import { buildCapwayInvoicePayload } from '@/lib/integrations/billing/capway/payloadBuilder'
import { billingConfigurationSnapshotSha256 } from '@/lib/billing/billingConfigurationSnapshot'

const customer = { id: 'customer-a', company_id: 'tenant-a', billing_profile_revision: 4,
  billing_profile: { recipient: 'Kund A', distributionMethod: 'email', email: 'standard@example.test', country: 'SE' } }
const contract = { id: 'contract-inherit', company_id: 'tenant-a', customer_id: 'customer-a',
  billing_profile_override: {}, billing_profile_override_revision: 0 }
const resolve = (c = customer, agreement: Record<string, unknown> = contract) => resolveEffectiveBillingProfile({
  companyId: 'tenant-a', customerId: 'customer-a', customer: c, contract: agreement,
})
function providerPayload(underlay: Record<string, unknown>) {
  return buildCapwayInvoicePayload({
    config: { companyId: 'tenant-a', provider: 'capway_aptic', environment: 'test', baseUrl: 'https://example.invalid',
      authMode: 'apikey', defaultService: 'synthetic', defaultFinancingMode: 'invoice_service' },
    company: { name: 'Synthetic Issuer' }, customer,
    underlay, pricingRun: { id: 'pricing-a', total_inc_vat: 125 },
    pricingLines: [{ id: 'line-a', description: 'Synthetic electricity', quantity: 1, amount_ex_vat: 100, amount_inc_vat: 125,
      vat_amount: 25, vat_rate: 0.25 }],
  })
}

describe('shared effective billing profile', () => {
  it('T14 only inherited email changes; equal copied values remain explicit overrides', () => {
    const explicit = { ...contract, id: 'contract-explicit', billing_profile_override: { email: customer.billing_profile.email } }
    const after = { ...customer, billing_profile_revision: 5, billing_profile: { ...customer.billing_profile, email: 'new@example.test' } }
    expect(resolve(after).email).toBe('new@example.test')
    expect(resolve(after, explicit).email).toBe('standard@example.test')
    expect(resolve(after, explicit).sources.email).toBe('contract_override')
    expect(resolve(after).profileRevision).toBe(5)
  })
  it('explicit null clears a value without falling through to contact identity', () => {
    const result = resolve(customer, { ...contract, billing_profile_override: { email: null } })
    expect(result.email).toBeNull()
    expect(result.blockers.map(b => b.code)).toContain('invoice_distribution_missing')
  })
  it('keeps an explicitly cleared contract method authoritative with a legacy customer default', () => {
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a',
      customer: { id: 'customer-a', company_id: 'tenant-a', full_name: 'A', invoice_email: 'default@example.test' },
      contract: { ...contract, billing_profile_override: { distributionMethod: null } },
      defaultDistributionMethod: 'email',
    })
    expect(result.distributionMethod).toBeNull()
    expect(result.sources.distributionMethod).toBe('contract_override')
    expect(result.blockers.map(b => b.code)).toContain('invoice_distribution_missing')
  })
  it('preserves configured tenant distribution for migrated profiles that never selected a customer method', () => {
    const migrated = { ...customer, billing_profile: { recipient: 'Kund A', country: 'SE' } }
    const explicit = { ...contract, billing_profile_override: { email: 'accountant@example.test' } }
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a',
      customer: migrated, contract: explicit, defaultDistributionMethod: 'email' })
    expect(result.distributionMethod).toBe('email')
    expect(result.sources.distributionMethod).toBe('tenant_default')
    expect(result.email).toBe('accountant@example.test')
    expect(result.blockers).toEqual([])
    const cleared = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a',
      customer: { ...migrated, billing_profile: { ...migrated.billing_profile, distributionMethod: null } },
      contract: explicit, defaultDistributionMethod: 'email' })
    expect(cleared.distributionMethod).toBeNull()
    expect(cleared.blockers.map(b => b.code)).toContain('invoice_distribution_missing')
  })
  it('does not infer a billing destination from contact/login email', () => {
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a',
      customer: { id: 'customer-a', company_id: 'tenant-a', full_name: 'A', email: 'contact@example.test' }, contract })
    expect(result.email).toBeNull()
    expect(result.blockers.map(b => b.code)).toContain('invoice_distribution_missing')
    const readiness = evaluateContractBillingAccountReadiness({
      customer: { full_name: 'A', email: 'contact@example.test' },
      contract: { invoice_recipient: 'A', vat_rate: 0.25 }, paymentTerms: { dueDays: 20 },
    })
    expect(readiness.evidence.invoice_email).toBeNull()
    expect(readiness.blockers.map(b => b.code)).toContain('invoice_distribution_missing')
  })
  it('blocks an unavailable site-address rule instead of falling back to the customer postal default', () => {
    const postal = { ...customer, billing_profile: { recipient: 'Postal Customer', distributionMethod: 'paper',
      street: 'Customer Street', postalCode: '11111', city: 'Customer City', country: 'SE' } }
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a',
      customer: postal, contract: { ...contract, billing_address_same_as_site: true }, siteAddress: null })
    expect(result.address.street).toBeNull()
    expect(result.blockers.map(b => b.code)).toContain('billing_site_address_unavailable')
  })
  it('rejects foreign tenant and customer profiles with no destination exposure', () => {
    const result = resolve(customer, { ...contract, company_id: 'tenant-b', billing_profile_override: { email: 'secret@example.test' } })
    expect(result.email).toBeNull()
    expect(result.blockers.map(b => b.code)).toEqual(['billing_profile_resource_mismatch'])
  })
  it('T15 readiness uses the same recipient, email, source and revision as the resolver', () => {
    const inputContract = { ...contract, invoice_email: 'stale@example.test', invoice_recipient: 'Stale', vat_rate: 0.25 }
    const readiness = evaluateContractBillingAccountReadiness({ customer, contract: inputContract, paymentTerms: { dueDays: 20 } })
    expect(readiness.evidence).toMatchObject({ invoice_recipient: resolve().recipient, invoice_email: resolve().email,
      billing_profile_revision: 4, billing_profile_sources: resolve().sources })
  })
  it('T16 a locked snapshot retains its recipient and revision after a profile change', () => {
    const snapshot = { schema: 'billing_configuration_v2', company_id: 'tenant-a', customer_id: 'customer-a',
      contract_id: contract.id, effective_billing_profile: resolve() }
    const locked = readLockedEffectiveBillingProfile(snapshot, { companyId: 'tenant-a', customerId: 'customer-a', contractId: contract.id })
    expect(locked).toEqual(resolve())
    expect(readLockedEffectiveBillingProfile(snapshot, { companyId: 'tenant-b', customerId: 'customer-a', contractId: contract.id })).toBeNull()
  })
  it('T15 provider export retains every locked destination field after a live profile change', () => {
    const old = { ...customer, billing_profile: { ...customer.billing_profile, recipient: 'Saved Receiver',
      street: 'Saved Street', postalCode: '11111', city: 'Saved City', country: 'SE', reference: 'SAVED-REFERENCE' } }
    const locked = resolve(old)
    const snapshot = { schema: 'billing_configuration_v2', company_id: 'tenant-a', customer_id: 'customer-a',
      contract_id: contract.id, effective_billing_profile: locked }
    const payload = buildCapwayInvoicePayload({
      config: { companyId: 'tenant-a', provider: 'capway_aptic', environment: 'test', baseUrl: 'https://example.invalid',
        authMode: 'apikey', defaultService: 'synthetic', defaultFinancingMode: 'invoice_service', defaultPreferredChannel: 'WrongLiveChannel' },
      company: { name: 'Synthetic Issuer' }, customer: { ...old, first_name: 'Legal', last_name: 'Customer',
        email: 'contact-changed@example.test', invoice_email: 'default-changed@example.test', city: 'Live City', street: 'Live Street',
        billing_profile_revision: 6, billing_profile: { ...old.billing_profile, email: 'live@example.test', recipient: 'Live Recipient' } },
      underlay: { company_id: 'tenant-a', customer_id: 'customer-a', contract_id: contract.id, price_area: 'SE3',
        billing_configuration_snapshot_sha256: billingConfigurationSnapshotSha256(snapshot), billing_configuration_snapshot: snapshot },
      pricingRun: { id: 'pricing-a', total_inc_vat: 125 },
      pricingLines: [{ id: 'line-a', description: 'Synthetic electricity', quantity: 1, amount_ex_vat: 100, amount_inc_vat: 125, vat_amount: 25, vat_rate: 0.25 }],
      invoiceDate: '2026-09-01T00:00:00Z', dueDate: '2026-09-21T00:00:00Z',
    })
    expect(payload.receiverReference).toBe('SAVED-REFERENCE')
    expect(payload.preferredChannel).toBe('Email')
    expect(payload.customer).toMatchObject({ email: 'standard@example.test', street: 'Saved Street', city: 'Saved City', zipCode: '11111', countryCode: 'SE' })
    expect(payload.debts[0]).toMatchObject({ receiverFullName: 'Saved Receiver', receiverStreet: 'Saved Street', receiverCity: 'Saved City', receiverZipCode: '11111', receiverCountryCode: 'SE' })
    expect(payload.extraFields).toContainEqual({ name: 'gridex_billing_profile_revision', value: ['4'] })
  })
  it('requires a qualified invoice lock before constructing a provider delivery', () => {
    expect(() => providerPayload({ price_area: 'SE3', contract_id: contract.id })).toThrow(/faktureringsprofil/)
  })
  it('rejects a foreign underlay even when its embedded snapshot claims the expected tenant', () => {
    const snapshot = { schema: 'billing_configuration_v2', company_id: 'tenant-a', customer_id: 'customer-a',
      contract_id: contract.id, effective_billing_profile: resolve() }
    expect(() => providerPayload({ price_area: 'SE3', company_id: 'tenant-b', customer_id: 'customer-a', contract_id: contract.id,
      billing_configuration_snapshot: snapshot, billing_configuration_snapshot_sha256: billingConfigurationSnapshotSha256(snapshot),
    })).toThrow(/faktureringsprofil/)
  })
  it('legacy copies of identical strings remain explicit and never follow a new customer default', () => {
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a',
      customer: { id: 'customer-a', company_id: 'tenant-a', invoice_email: 'new-default@example.test', full_name: 'A' },
      contract: { id: contract.id, company_id: 'tenant-a', customer_id: 'customer-a', invoice_email: 'copied-old@example.test' } })
    expect(result.email).toBe('copied-old@example.test')
    expect(result.sources.email).toBe('legacy_contract_override')
  })
})
