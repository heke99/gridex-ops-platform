import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { resolveEffectiveBillingProfile, readLockedEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'
import { evaluateContractBillingAccountReadiness } from '@/lib/billing/billingReadiness'
import CustomerBillingProfileCard, { buildBillingOverrideChanges } from '@/components/admin/customers/CustomerBillingProfileCard'

vi.mock('@/app/admin/customers/[id]/billing-profile-actions', () => ({
  saveCustomerBillingProfileAction: vi.fn(), saveCustomerContractBillingOverrideAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const customer = { id: 'customer-a', company_id: 'tenant-a', billing_profile_revision: 3, billing_profile: { recipient: 'Synthetic Customer', distributionMethod: 'email', email: 'standard@example.invalid' } }
const inherited = { id: 'contract-a', company_id: 'tenant-a', customer_id: 'customer-a', vat_rate: 0.25, billing_profile_override: {}, billing_profile_override_revision: 0 }
const override = { ...inherited, id: 'contract-b', billing_profile_override: { email: 'accountant@example.invalid' }, billing_profile_override_revision: 2 }

describe('billing UI resolves the same resource, inheritance and historical revision as readiness', () => {
  it('changes only inherited e-mail for two otherwise identical contracts', () => {
    const changed = { ...customer, billing_profile_revision: 4, billing_profile: { ...customer.billing_profile, email: 'new-standard@example.invalid' } }
    const first = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer: changed, contract: inherited })
    const second = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer: changed, contract: override })
    expect(first).toMatchObject({ email: 'new-standard@example.invalid', profileRevision: 4, sources: { email: 'customer_default' } })
    expect(second).toMatchObject({ email: 'accountant@example.invalid', profileRevision: 4, contractOverrideRevision: 2, sources: { email: 'contract_override' } })
  })
  it('does not resolve a contract or customer belonging to another tenant', () => {
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-b', customerId: 'customer-a', customer, contract: inherited })
    expect(result).toMatchObject({ recipient: null, email: null })
    expect(result.blockers.map((blocker) => blocker.code)).toContain('billing_profile_resource_mismatch')
  })
  it('uses the historical snapshot without consulting a new customer default', () => {
    const effective = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer, contract: inherited })
    const locked = { schema: 'billing_configuration_v2', company_id: 'tenant-a', customer_id: 'customer-a', contract_id: 'contract-a', effective_billing_profile: effective }
    expect(readLockedEffectiveBillingProfile(locked, { companyId: 'tenant-a', customerId: 'customer-a', contractId: 'contract-a' })).toMatchObject({ email: 'standard@example.invalid', profileRevision: 3 })
    expect(readLockedEffectiveBillingProfile(locked, { companyId: 'tenant-b', customerId: 'customer-a', contractId: 'contract-a' })).toBeNull()
  })
  it('does not call the account ready when the canonical e-mail shown in UI is invalid', () => {
    const invalid = { ...customer, billing_profile: { ...customer.billing_profile, email: 'invalid email' } }
    const result = evaluateContractBillingAccountReadiness({ customer: invalid, contract: inherited, paymentTerms: { dueDays: 30 } })
    expect(result.blockers.map((blocker) => blocker.code)).toContain('invoice_email_invalid')
  })
  it('removes an inherited key instead of copying its displayed value, while preserving explicit clearing', () => {
    const data = new FormData()
    for (const key of ['recipient', 'distributionMethod', 'email', 'reference', 'street', 'postalCode', 'city', 'country']) {
      data.set(`${key}__mode`, 'inherit')
      data.set(key, 'stale displayed value')
    }
    data.set('reference__mode', 'clear')
    const update = buildBillingOverrideChanges(data)
    expect(update.changes).toEqual({ reference: null })
    expect(update.inheritFields).toContain('email')
    expect(update.inheritFields).not.toContain('reference')
    const nextOverride = { ...override.billing_profile_override, ...update.changes } as Record<string, unknown>
    for (const field of update.inheritFields) delete nextOverride[field]
    const result = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer, contract: { ...override, billing_profile_override: nextOverride } })
    expect(result).toMatchObject({ email: 'standard@example.invalid', reference: null, sources: { email: 'customer_default', reference: 'contract_override' } })
  })
  it('writes an explicit email and distribution override without converting unrelated fields to copies', () => {
    const data = new FormData()
    for (const key of ['recipient', 'distributionMethod', 'email', 'reference', 'street', 'postalCode', 'city', 'country']) data.set(`${key}__mode`, 'inherit')
    data.set('email__mode', 'override'); data.set('email', ' accountant@example.invalid ')
    data.set('distributionMethod__mode', 'override'); data.set('distributionMethod', 'email')
    expect(buildBillingOverrideChanges(data)).toEqual({
      changes: { distributionMethod: 'email', email: 'accountant@example.invalid' },
      inheritFields: ['recipient', 'reference', 'street', 'postalCode', 'city', 'country'],
    })
    data.set('email__mode', 'unexpected')
    expect(() => buildBillingOverrideChanges(data)).toThrow('invalid_billing_profile_command')
  })
  it('renders a separate standard and revision-bound override editor, and emits none to readers', () => {
    const profile = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer })
    const contracts = [{ id: override.id, name: 'Synthetic contract', profile: resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer, contract: override }) }]
    const edit = renderToStaticMarkup(createElement(CustomerBillingProfileCard, { profile, contracts, canEdit: true, idempotencyKey: 'synthetic-billing-key' }))
    expect(edit).toContain('Spara faktureringsstandard')
    expect(edit).toContain('Spara avtalsundantag')
    expect(edit).toContain('name="expected_override_revision" value="2"')
    expect(edit).toContain('name="expected_revision" value="3"')
    for (const field of ['recipient', 'distributionMethod', 'email', 'reference', 'street', 'postalCode', 'city', 'country']) expect(edit).toContain(`name="${field}__mode"`)
    const read = renderToStaticMarkup(createElement(CustomerBillingProfileCard, { profile, contracts, canEdit: false, idempotencyKey: 'unused' }))
    expect(read).not.toContain('<form')
    expect(read).not.toContain('Ändra avtalsundantag')
    expect(read).toContain('undantagsrevision 2')
  })
  it('emits no edit form for a mismatched resource or an explicitly unavailable override revision', () => {
    const profile = resolveEffectiveBillingProfile({ companyId: 'tenant-b', customerId: 'customer-a', customer })
    const markup = renderToStaticMarkup(createElement(CustomerBillingProfileCard, { profile, contracts: [], canEdit: true, idempotencyKey: 'synthetic-billing-key' }))
    expect(markup).not.toContain('<form')
    expect(markup).toContain('Faktureringsprofilen tillhör inte')
    const current = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer })
    const contracts = [{ id: override.id, name: 'Synthetic contract', canEdit: false, profile: resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer, contract: override }) }]
    expect(renderToStaticMarkup(createElement(CustomerBillingProfileCard, { profile: current, contracts, canEdit: true, idempotencyKey: 'synthetic-billing-key' }))).not.toContain('Spara avtalsundantag')
  })
  it('counts a missing inherited email as affected by a new default and preserves an explicit null override', () => {
    const missingEmail = { ...customer, billing_profile: { recipient: 'Synthetic Customer', distributionMethod: 'email' } }
    const first = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer: missingEmail, contract: inherited })
    const second = resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer: missingEmail, contract: { ...override, billing_profile_override: { email: null } } })
    const markup = renderToStaticMarkup(createElement(CustomerBillingProfileCard, { profile: resolveEffectiveBillingProfile({ companyId: 'tenant-a', customerId: 'customer-a', customer: missingEmail }), contracts: [{ id: first.contractId!, name: 'Inherited', profile: first }, { id: second.contractId!, name: 'Cleared', profile: second }], canEdit: false, idempotencyKey: 'unused' }))
    expect(markup).toContain('påverkar 1 av 2 avtal')
    expect(second.sources.email).toBe('contract_override')
    expect(second.email).toBeNull()
  })
})
