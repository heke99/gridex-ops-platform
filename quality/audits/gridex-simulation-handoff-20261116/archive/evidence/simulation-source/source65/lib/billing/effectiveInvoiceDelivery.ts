/**
 * Effective invoice recipient/delivery for one contract, shared by billing readiness, invoice
 * review preparation and export so they can never disagree.
 *
 * Rules:
 * - A contract value is an explicit exception (`contract_override`) and wins field by field.
 * - Otherwise the customer's billing profile is inherited (`customer_billing_profile`).
 * - The customer's general contact email is never used as invoice email: a contact address is not
 *   a confirmed invoice address, and changing it must not silently redirect invoices.
 * - The postal address is taken as one unit from the source that has a complete address, so street
 *   and city can never come from different addresses.
 */

export type InvoiceDeliverySource = 'contract_override' | 'customer_billing_profile' | 'site_address' | null

export type InvoiceDeliveryContract = {
  invoice_recipient?: string | null
  invoice_email?: string | null
  invoice_reference?: string | null
  billing_street?: string | null
  billing_postal_code?: string | null
  billing_city?: string | null
  billing_country?: string | null
  billing_address_same_as_site?: boolean | null
}

export type InvoiceDeliveryCustomer = {
  full_name?: string | null
  company_name?: string | null
  invoice_email?: string | null
  billing_street?: string | null
  billing_postal_code?: string | null
  billing_city?: string | null
  billing_country?: string | null
}

export type InvoiceDeliverySiteAddress = {
  street?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
}

export type EffectiveInvoiceDelivery = {
  recipient: string | null
  recipientSource: InvoiceDeliverySource
  email: string | null
  emailSource: InvoiceDeliverySource
  reference: string | null
  postalAddress: { street: string; postalCode: string; city: string; country: string } | null
  postalAddressSource: InvoiceDeliverySource
  /** True when no field is a contract exception, i.e. a customer billing-profile change applies. */
  inheritsCustomerProfile: boolean
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function completeAddress(street: unknown, postalCode: unknown, city: unknown, country: unknown) {
  const s = clean(street)
  const p = clean(postalCode)
  const c = clean(city)
  return s && p && c ? { street: s, postalCode: p, city: c, country: clean(country) ?? 'SE' } : null
}

export function resolveEffectiveInvoiceDelivery(input: {
  contract: InvoiceDeliveryContract | null
  customer: InvoiceDeliveryCustomer | null
  siteAddress?: InvoiceDeliverySiteAddress | null
}): EffectiveInvoiceDelivery {
  const contract = input.contract ?? {}
  const customer = input.customer ?? {}

  const contractRecipient = clean(contract.invoice_recipient)
  const customerRecipient = clean(customer.full_name) ?? clean(customer.company_name)
  const contractEmail = clean(contract.invoice_email)
  const customerEmail = clean(customer.invoice_email)

  const contractAddress = completeAddress(contract.billing_street, contract.billing_postal_code, contract.billing_city, contract.billing_country)
  const siteAddress = contract.billing_address_same_as_site === true && input.siteAddress
    ? completeAddress(input.siteAddress.street, input.siteAddress.postalCode, input.siteAddress.city, input.siteAddress.country)
    : null
  const customerAddress = completeAddress(customer.billing_street, customer.billing_postal_code, customer.billing_city, customer.billing_country)

  const postalAddress = contractAddress ?? siteAddress ?? customerAddress
  const postalAddressSource: InvoiceDeliverySource = contractAddress
    ? 'contract_override'
    : siteAddress
      ? 'site_address'
      : customerAddress
        ? 'customer_billing_profile'
        : null

  return {
    recipient: contractRecipient ?? customerRecipient,
    recipientSource: contractRecipient ? 'contract_override' : customerRecipient ? 'customer_billing_profile' : null,
    email: contractEmail ?? customerEmail,
    emailSource: contractEmail ? 'contract_override' : customerEmail ? 'customer_billing_profile' : null,
    reference: clean(contract.invoice_reference),
    postalAddress,
    postalAddressSource,
    inheritsCustomerProfile: !contractRecipient && !contractEmail && !contractAddress && contract.billing_address_same_as_site !== true,
  }
}

/**
 * Controlled rollout (tenantservice P3). `legacy` (default) reproduces the previous behaviour
 * exactly, per consumer: readiness inherited the customer and fell back to the contact email,
 * while invoice review and export read the contract only. `shared` uses the single resolver
 * above for all of them. Switch with GRIDEX_INVOICE_DELIVERY_RESOLVER=shared after the
 * invoice_email backfill is reviewed.
 */
export type InvoiceDeliveryMode = 'shared' | 'legacy'

export function invoiceDeliveryMode(): InvoiceDeliveryMode {
  return process.env.GRIDEX_INVOICE_DELIVERY_RESOLVER?.trim().toLowerCase() === 'shared' ? 'shared' : 'legacy'
}

export function resolveInvoiceDeliveryFor(
  consumer: 'readiness' | 'document',
  input: Parameters<typeof resolveEffectiveInvoiceDelivery>[0] & { customer: (InvoiceDeliveryCustomer & { email?: string | null }) | null },
  mode: InvoiceDeliveryMode = invoiceDeliveryMode(),
): EffectiveInvoiceDelivery {
  if (mode === 'shared') return resolveEffectiveInvoiceDelivery(input)
  const contract = input.contract ?? {}
  const customer = consumer === 'readiness' ? input.customer ?? {} : {}
  const pick = (a: unknown, b: unknown) => clean(a) ?? clean(b)
  const street = pick(contract.billing_street, customer.billing_street)
  const postalCode = pick(contract.billing_postal_code, customer.billing_postal_code)
  const city = pick(contract.billing_city, customer.billing_city)
  const recipient = consumer === 'readiness'
    ? clean(contract.invoice_recipient) ?? clean(input.customer?.full_name) ?? clean(input.customer?.company_name)
    : clean(contract.invoice_recipient)
  const email = consumer === 'readiness'
    ? clean(contract.invoice_email) ?? clean(input.customer?.invoice_email) ?? clean(input.customer?.email)
    : clean(contract.invoice_email)
  return {
    recipient,
    recipientSource: recipient ? (clean(contract.invoice_recipient) ? 'contract_override' : 'customer_billing_profile') : null,
    email,
    emailSource: email ? (clean(contract.invoice_email) ? 'contract_override' : 'customer_billing_profile') : null,
    reference: clean(contract.invoice_reference),
    postalAddress: street && postalCode && city ? { street, postalCode, city, country: clean(contract.billing_country) ?? 'SE' } : null,
    postalAddressSource: street && postalCode && city ? 'contract_override' : null,
    inheritsCustomerProfile: false,
  }
}
