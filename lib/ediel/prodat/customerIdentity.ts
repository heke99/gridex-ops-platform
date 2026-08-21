export type SwedishProdatEndUserQualifier = 'SE1' | 'SE2'

export type SwedishProdatCustomerIdentity = {
  id: string | null
  qualifier: SwedishProdatEndUserQualifier | null
  name: string
}

type CustomerIdentitySource = Record<string, unknown> | null | undefined

function sanitize(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n'+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function field(customer: CustomerIdentitySource, key: string): string | null {
  const value = sanitize(customer?.[key])
  return value || null
}

/**
 * Resolve the Swedish legal end-user identity used by PRODAT.
 *
 * Ediel PRODAT defines SE1 as Swedish organisation number and SE2 as Swedish
 * personal identity number. The semantic source field therefore decides the
 * qualifier; identifier length must never be used to guess it. Internal
 * customer numbers are intentionally excluded from the legal identity.
 */
export function resolveSwedishProdatCustomerIdentity(
  customer: CustomerIdentitySource,
): SwedishProdatCustomerIdentity {
  const organisationNumber = field(customer, 'org_number')
  const personalNumber = field(customer, 'personal_number')

  const id = organisationNumber ?? personalNumber
  const qualifier: SwedishProdatEndUserQualifier | null = organisationNumber
    ? 'SE1'
    : personalNumber
      ? 'SE2'
      : null

  const firstName = field(customer, 'first_name')
  const lastName = field(customer, 'last_name')
  const composedName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const name =
    field(customer, 'company_name') ??
    field(customer, 'full_name') ??
    (composedName || null) ??
    field(customer, 'customer_number') ??
    'Kund'

  return { id, qualifier, name }
}
