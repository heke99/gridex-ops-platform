export type LegalJsonObject = Record<string, unknown>

/** Database JSON representation. Keep all SQL/TypeScript conversion here. */
export type StructuredAddress = {
  formatted?: string
  address_line_1?: string
  address_line_2?: string
  postal_code?: string
  city?: string
  country_code?: string
}

/** Application representation used outside the database adapter boundary. */
export type CanonicalAddress = {
  addressLine1: string
  addressLine2: string | null
  postalCode: string
  city: string
  countryCode: string
  formatted: string
}

export type LegalContactSource =
  | 'tenant_explicit'
  | 'company_fallback'
  | 'platform_default'

export type StructuredContact = {
  text?: string
  name?: string
  email?: string
  phone?: string
  address?: StructuredAddress
  description?: string
  source?: LegalContactSource
}

export type LegalContact = {
  name: string | null
  email: string | null
  phone: string | null
  address: CanonicalAddress | null
  description: string | null
  source: LegalContactSource
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const URL_RE = /^https?:\/\//i
const COUNTRY_CODE_RE = /^[A-Z]{2}$/

export function legalRecord(value: unknown): LegalJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LegalJsonObject
    : {}
}

export function legalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function legalObjectText(value: unknown, ...keys: string[]): string {
  const object = legalRecord(value)
  for (const key of keys) {
    const normalized = legalText(object[key])
    if (normalized) return normalized
  }
  return ''
}

export function formText(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function compactRecord(input: Record<string, unknown>): LegalJsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === null || value === undefined) return false
      if (typeof value === 'string') return value.trim().length > 0
      if (typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value as object).length > 0
      }
      return true
    }),
  )
}

export function normalizeEmail(value: string, label: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized && !EMAIL_RE.test(normalized)) {
    throw new Error(`${label} måste vara en giltig e-postadress.`)
  }
  return normalized
}

export function normalizeUrl(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) return ''
  const withProtocol = URL_RE.test(normalized) ? normalized : `https://${normalized}`
  try {
    const parsed = new URL(withProtocol)
    if (!parsed.hostname.includes('.')) throw new Error('invalid_host')
    return parsed.toString()
  } catch {
    throw new Error(`${label} måste vara en giltig webbadress.`)
  }
}

export function normalizeCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase() || 'SE'
  if (!COUNTRY_CODE_RE.test(normalized)) {
    throw new Error('Landkod måste bestå av två bokstäver, exempelvis SE.')
  }
  return normalized
}

export function normalizePostalCode(
  value: string,
  countryCode = 'SE',
  label = 'Postnummer',
): string {
  const normalized = value.trim()
  if (!normalized) return ''

  if (normalizeCountryCode(countryCode) === 'SE') {
    const digits = normalized.replace(/\D/g, '')
    if (digits.length !== 5 || !/^\d{3}\s?\d{2}$/.test(normalized)) {
      throw new Error(`${label} måste anges som 123 45.`)
    }
    return `${digits.slice(0, 3)} ${digits.slice(3)}`
  }

  if (normalized.length < 2 || normalized.length > 16) {
    throw new Error(`${label} har ogiltigt format.`)
  }
  return normalized
}

function luhnValid(value: string): boolean {
  let sum = 0
  for (let index = 0; index < value.length; index += 1) {
    let digit = Number(value[index])
    if (index % 2 === 0) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

export function normalizeSwedishOrganizationNumber(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length !== 10 || !luhnValid(digits)) {
    throw new Error('Organisationsnummer måste vara ett giltigt svenskt organisationsnummer.')
  }
  return `${digits.slice(0, 6)}-${digits.slice(6)}`
}

export function databaseAddressToCanonical(value: unknown): CanonicalAddress | null {
  const address = legalRecord(value)
  const addressLine1 = legalObjectText(address, 'address_line_1')
  const addressLine2 = legalObjectText(address, 'address_line_2') || null
  const postalCode = legalObjectText(address, 'postal_code')
  const city = legalObjectText(address, 'city')
  const countryCode = legalObjectText(address, 'country_code')
  const formatted = legalObjectText(address, 'formatted')
  if (!addressLine1 && !postalCode && !city && !formatted) return null
  return {
    addressLine1,
    addressLine2,
    postalCode,
    city,
    countryCode,
    formatted: formatted || [addressLine1, addressLine2, [postalCode, city].filter(Boolean).join(' '), countryCode]
      .filter(Boolean)
      .join(', '),
  }
}

export function canonicalAddressToDatabase(value: CanonicalAddress | null): StructuredAddress {
  if (!value) return {}
  return {
    address_line_1: value.addressLine1,
    address_line_2: value.addressLine2 ?? undefined,
    postal_code: value.postalCode,
    city: value.city,
    country_code: value.countryCode,
    formatted: value.formatted,
  }
}

export function databaseContactToLegalContact(value: unknown): LegalContact {
  const contact = legalRecord(value)
  const source = legalObjectText(contact, 'source')
  const normalizedSource: LegalContactSource = source === 'tenant_explicit' || source === 'platform_default'
    ? source
    : 'company_fallback'
  return {
    name: legalObjectText(contact, 'name') || null,
    email: legalObjectText(contact, 'email') || null,
    phone: legalObjectText(contact, 'phone') || null,
    address: databaseAddressToCanonical(contact.address),
    description: legalObjectText(contact, 'description') || null,
    source: normalizedSource,
  }
}

export function buildStructuredAddress(
  formData: FormData,
  prefix: string,
): StructuredAddress {
  const addressLine1 = formText(formData, `${prefix}_line_1`)
  const addressLine2 = formText(formData, `${prefix}_line_2`)
  const city = formText(formData, `${prefix}_city`)
  const countryCode = normalizeCountryCode(formText(formData, `${prefix}_country_code`))
  const postalCode = normalizePostalCode(
    formText(formData, `${prefix}_postal_code`),
    countryCode,
    `${prefix}: postnummer`,
  )

  if (!addressLine1 && !addressLine2 && !postalCode && !city) return {}

  const locality = [postalCode, city].filter(Boolean).join(' ')
  const formatted = [addressLine1, addressLine2, locality, countryCode]
    .filter(Boolean)
    .join(', ')

  return compactRecord({
    formatted,
    address_line_1: addressLine1,
    address_line_2: addressLine2,
    postal_code: postalCode,
    city,
    country_code: countryCode,
  }) as StructuredAddress
}

export function buildStructuredContact(
  formData: FormData,
  prefix: string,
  label: string,
): LegalJsonObject {
  const name = formText(formData, `${prefix}_name`)
  const email = normalizeEmail(formText(formData, `${prefix}_email`), `${label}: e-post`)
  const phone = formText(formData, `${prefix}_phone`)
  const address = buildStructuredAddress(formData, `${prefix}_address`)
  const description = formText(formData, `${prefix}_description`)
  const text = description || email || address.formatted || phone || name

  return compactRecord({ text, name, email, phone, address, description })
}

export function buildBillingInformation(formData: FormData): LegalJsonObject {
  const email = normalizeEmail(formText(formData, 'billing_email'), 'Fakturering: e-post')
  const phone = formText(formData, 'billing_phone')
  const address = buildStructuredAddress(formData, 'billing_address')
  const bankgiro = formText(formData, 'billing_bankgiro')
  const description = formText(formData, 'billing_description')
  const text = description || email || address.formatted || bankgiro || phone

  return compactRecord({ text, email, phone, address, bankgiro, description })
}

export function buildDisputeResolutionInformation(formData: FormData): LegalJsonObject {
  const authority = formText(formData, 'dispute_authority')
  const url = normalizeUrl(formText(formData, 'dispute_url'), 'Tvistlösning: webbadress')
  const email = normalizeEmail(formText(formData, 'dispute_email'), 'Tvistlösning: e-post')
  const address = buildStructuredAddress(formData, 'dispute_address')
  const description = formText(formData, 'dispute_description')
  const text = description || authority || url || email || address.formatted

  return compactRecord({ text, authority, url, email, address, description })
}

export function addressField(value: unknown, key: keyof StructuredAddress): string {
  return legalObjectText(value, key)
}

export function contactField(value: unknown, key: keyof StructuredContact): string {
  const object = legalRecord(value)
  return key === 'address'
    ? legalObjectText(object.address, 'formatted')
    : legalText(object[key])
}
