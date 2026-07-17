export type LegalJsonObject = Record<string, unknown>

export type StructuredAddress = {
  formatted?: string
  address_line_1?: string
  address_line_2?: string
  postal_code?: string
  city?: string
  country_code?: string
}

export type StructuredContact = {
  text?: string
  name?: string
  email?: string
  phone?: string
  address?: string
  description?: string
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const URL_RE = /^https?:\/\//i

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

function compactObject(input: Record<string, string>): LegalJsonObject {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value.trim().length > 0),
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
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new Error('Landkod måste bestå av två bokstäver, exempelvis SE.')
  }
  return normalized
}

export function buildStructuredAddress(
  formData: FormData,
  prefix: string,
): LegalJsonObject {
  const addressLine1 = formText(formData, `${prefix}_line_1`)
  const addressLine2 = formText(formData, `${prefix}_line_2`)
  const postalCode = formText(formData, `${prefix}_postal_code`)
  const city = formText(formData, `${prefix}_city`)
  const countryCode = normalizeCountryCode(formText(formData, `${prefix}_country_code`))

  if (!addressLine1 && !addressLine2 && !postalCode && !city) return {}

  const locality = [postalCode, city].filter(Boolean).join(' ')
  const formatted = [addressLine1, addressLine2, locality, countryCode]
    .filter(Boolean)
    .join(', ')

  return compactObject({
    formatted,
    address_line_1: addressLine1,
    address_line_2: addressLine2,
    postal_code: postalCode,
    city,
    country_code: countryCode,
  })
}

export function buildStructuredContact(
  formData: FormData,
  prefix: string,
  label: string,
): LegalJsonObject {
  const name = formText(formData, `${prefix}_name`)
  const email = normalizeEmail(formText(formData, `${prefix}_email`), `${label}: e-post`)
  const phone = formText(formData, `${prefix}_phone`)
  const address = formText(formData, `${prefix}_address`)
  const description = formText(formData, `${prefix}_description`)
  const text = description || email || address || phone || name

  return compactObject({ text, name, email, phone, address, description })
}

export function buildBillingInformation(formData: FormData): LegalJsonObject {
  const email = normalizeEmail(formText(formData, 'billing_email'), 'Fakturering: e-post')
  const phone = formText(formData, 'billing_phone')
  const address = formText(formData, 'billing_address')
  const bankgiro = formText(formData, 'billing_bankgiro')
  const description = formText(formData, 'billing_description')
  const text = description || email || address || bankgiro || phone

  return compactObject({ text, email, phone, address, bankgiro, description })
}

export function buildDisputeResolutionInformation(formData: FormData): LegalJsonObject {
  const authority = formText(formData, 'dispute_authority')
  const url = normalizeUrl(formText(formData, 'dispute_url'), 'Tvistlösning: webbadress')
  const email = normalizeEmail(formText(formData, 'dispute_email'), 'Tvistlösning: e-post')
  const address = formText(formData, 'dispute_address')
  const description = formText(formData, 'dispute_description')
  const text = description || authority || url || email || address

  return compactObject({ text, authority, url, email, address, description })
}

export function addressField(value: unknown, key: keyof StructuredAddress): string {
  return legalObjectText(value, key)
}

export function contactField(value: unknown, key: keyof StructuredContact): string {
  return legalObjectText(value, key)
}
