export type BillingDistributionMethod = 'email' | 'paper' | 'e_invoice' | 'direct_debit'
export type BillingProfileFields = {
  recipient?: string | null
  distributionMethod?: BillingDistributionMethod | null
  email?: string | null
  reference?: string | null
  street?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
}
export type BillingProfileSource = 'customer_default' | 'contract_override' | 'legacy_customer_default' | 'legacy_contract_override' | 'tenant_default' | 'site_address' | 'missing'
export type EffectiveBillingProfile = {
  companyId: string
  customerId: string
  contractId: string | null
  recipient: string | null
  distributionMethod: BillingDistributionMethod | null
  email: string | null
  reference: string | null
  address: { street: string | null; postalCode: string | null; city: string | null; country: string | null }
  profileRevision: number
  contractOverrideRevision: number
  sources: Record<keyof Required<BillingProfileFields>, BillingProfileSource>
  blockers: Array<{ code: string; message: string }>
}
type Row = Record<string, unknown>
const keys = ['recipient', 'distributionMethod', 'email', 'reference', 'street', 'postalCode', 'city', 'country'] as const
function row(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {} }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function revision(value: unknown): number { const n = Number(value ?? 0); return Number.isSafeInteger(n) && n >= 0 ? n : 0 }
function method(value: unknown): BillingDistributionMethod | null {
  const normalized = text(value)?.toLowerCase()
  if (normalized === 'e-mail') return 'email'
  if (['postal', 'post', 'letter'].includes(normalized ?? '')) return 'paper'
  if (['einvoice', 'e-faktura'].includes(normalized ?? '')) return 'e_invoice'
  return ['email', 'paper', 'e_invoice', 'direct_debit'].includes(normalized ?? '') ? normalized as BillingDistributionMethod : null
}

/** Pure shared read model. Presence of a canonical field, including null, is
 * authoritative. Legacy contract values are explicit copies; equal strings
 * never establish inheritance. Contact/login email is deliberately absent. */
export function resolveEffectiveBillingProfile(input: {
  companyId: string
  customerId: string
  customer?: Row | null
  contract?: Row | null
  siteAddress?: { street?: string | null; postalCode?: string | null; city?: string | null } | null
  defaultDistributionMethod?: string | null
}): EffectiveBillingProfile {
  const customer = input.customer ?? {}
  const contract = input.contract ?? {}
  const mismatch = (text(customer.company_id) && customer.company_id !== input.companyId)
    || (text(customer.id) && customer.id !== input.customerId)
    || (text(contract.company_id) && contract.company_id !== input.companyId)
    || (text(contract.customer_id) && contract.customer_id !== input.customerId)
  const canonicalDefault = Object.hasOwn(customer, 'billing_profile')
  const canonicalOverride = Object.hasOwn(contract, 'billing_profile_override')
  const defaults = canonicalDefault ? row(customer.billing_profile) : {
    recipient: text(customer.company_name) ?? text(customer.full_name), email: text(customer.invoice_email),
    street: text(customer.billing_street), postalCode: text(customer.billing_postal_code), city: text(customer.billing_city),
    country: text(customer.billing_country) ?? 'SE', reference: null,
    distributionMethod: method(input.defaultDistributionMethod) ?? (text(customer.invoice_email) ? 'email' : null),
  }
  const legacyOverrides: Row = {
    recipient: text(contract.invoice_recipient), email: text(contract.invoice_email), reference: text(contract.invoice_reference),
    street: text(contract.billing_street), postalCode: text(contract.billing_postal_code), city: text(contract.billing_city),
    country: text(contract.billing_country),
  }
  const overrides = canonicalOverride ? row(contract.billing_profile_override)
    : Object.fromEntries(Object.entries(legacyOverrides).filter(([, value]) => value !== null))
  const values: Row = {}
  const sources = {} as EffectiveBillingProfile['sources']
  for (const key of keys) {
    const explicit = Object.hasOwn(overrides, key)
    const present = explicit || Object.hasOwn(defaults, key)
    values[key] = mismatch ? null : text(explicit ? overrides[key] : defaults[key])
    sources[key] = mismatch || !present ? 'missing' : explicit
      ? canonicalOverride ? 'contract_override' : 'legacy_contract_override'
      : canonicalDefault ? 'customer_default' : 'legacy_customer_default'
  }
  if (!mismatch && !Object.hasOwn(overrides, 'distributionMethod') && !Object.hasOwn(defaults, 'distributionMethod')) {
    const tenantMethod = method(input.defaultDistributionMethod)
    if (tenantMethod) {
      values.distributionMethod = tenantMethod
      sources.distributionMethod = 'tenant_default'
    }
  }
  let siteAddressUnavailable = false
  if (!mismatch && contract.billing_address_same_as_site === true) {
    for (const key of ['street', 'postalCode', 'city'] as const) {
      if (!Object.hasOwn(overrides, key)) {
        values[key] = text(input.siteAddress?.[key]); sources[key] = 'site_address'
        if (!values[key]) siteAddressUnavailable = true
      }
    }
  }
  const result: EffectiveBillingProfile = {
    companyId: input.companyId, customerId: input.customerId, contractId: text(contract.id),
    recipient: text(values.recipient), distributionMethod: method(values.distributionMethod),
    email: text(values.email)?.toLowerCase() ?? null, reference: text(values.reference),
    address: { street: text(values.street), postalCode: text(values.postalCode), city: text(values.city), country: text(values.country) },
    profileRevision: revision(customer.billing_profile_revision), contractOverrideRevision: revision(contract.billing_profile_override_revision),
    sources, blockers: [],
  }
  if (mismatch) {
    result.blockers.push({ code: 'billing_profile_resource_mismatch', message: 'Faktureringsprofilen tillhör inte den valda kunden och tenanten.' })
    return result
  }
  const postal = Boolean(result.address.street && result.address.postalCode && result.address.city)
  if (siteAddressUnavailable) result.blockers.push({ code: 'billing_site_address_unavailable', message: 'Avtalets fakturering kräver en komplett och kundbunden anläggningsadress.' })
  if (!result.distributionMethod && !canonicalDefault && !Object.hasOwn(overrides, 'distributionMethod')) {
    result.distributionMethod = result.email ? 'email' : postal ? 'paper' : null
  }
  if (!result.recipient) result.blockers.push({ code: 'invoice_recipient_missing', message: 'Fakturamottagare saknas.' })
  if (!result.distributionMethod || (result.distributionMethod === 'email' && !result.email)
      || (result.distributionMethod === 'paper' && !postal)) {
    result.blockers.push({ code: 'invoice_distribution_missing', message: 'Faktureringsprofilen saknar en komplett distributionsväg.' })
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) result.blockers.push({ code: 'invoice_email_invalid', message: 'Faktura-e-post är ogiltig.' })
  if (['e_invoice', 'direct_debit'].includes(result.distributionMethod ?? '') && !result.reference) result.blockers.push({ code: 'invoice_reference_missing', message: 'Vald distributionsmetod kräver en uttrycklig fakturareferens.' })
  return result
}

/** Never replace a locked destination with a later live customer profile. */
export function readLockedEffectiveBillingProfile(snapshot: unknown, expected: {
  companyId: string; customerId: string; contractId: string
}): EffectiveBillingProfile | null {
  const source = row(snapshot)
  const value = row(source.effective_billing_profile)
  const address = row(value.address)
  const sources = row(value.sources)
  const nullableText = (item: unknown) => item === null || (typeof item === 'string' && item.length <= 320)
  if (source.schema !== 'billing_configuration_v2' || source.company_id !== expected.companyId
      || source.customer_id !== expected.customerId || source.contract_id !== expected.contractId
      || value.companyId !== expected.companyId || value.customerId !== expected.customerId || value.contractId !== expected.contractId
      || !Number.isSafeInteger(value.profileRevision) || Number(value.profileRevision) < 0
      || !Number.isSafeInteger(value.contractOverrideRevision) || Number(value.contractOverrideRevision) < 0
      || !Array.isArray(value.blockers) || value.blockers.length !== 0 || !text(value.recipient) || !nullableText(value.recipient)
      || typeof value.distributionMethod !== 'string' || !['email', 'paper', 'e_invoice', 'direct_debit'].includes(value.distributionMethod)
      || Object.keys(value).length !== 12 || Object.keys(sources).length !== keys.length
      || keys.some(key => typeof sources[key] !== 'string' || !['customer_default', 'contract_override', 'legacy_customer_default', 'legacy_contract_override', 'tenant_default', 'site_address', 'missing'].includes(sources[key]))
      || !Object.hasOwn(value, 'email') || !nullableText(value.email) || !Object.hasOwn(value, 'reference') || !nullableText(value.reference)
      || Object.keys(address).length !== 4 || ['street', 'postalCode', 'city', 'country'].some(key => !Object.hasOwn(address, key) || !nullableText(address[key]))
      || (value.email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value.email)))
      || (value.distributionMethod === 'email' && !text(value.email))
      || (value.distributionMethod === 'paper' && !(text(address.street) && text(address.postalCode) && text(address.city)))
      || (['e_invoice', 'direct_debit'].includes(String(value.distributionMethod)) && !text(value.reference))) return null
  return value as EffectiveBillingProfile
}
