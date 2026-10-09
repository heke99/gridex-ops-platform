export type CustomerValidationIssue = {
  field: string
  message: string
}

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function hasLuhnChecksum(value: string): boolean {
  let sum = 0

  for (let index = 0; index < value.length; index += 1) {
    const digit = Number(value[index])
    if (!Number.isInteger(digit)) return false
    const doubled = index % 2 === 0 ? digit * 2 : digit
    sum += doubled > 9 ? doubled - 9 : doubled
  }

  return sum % 10 === 0
}

function normalizeTenDigitIdentity(value: string | null | undefined): string {
  const digits = digitsOnly(value)
  if (digits.length === 12) return digits.slice(2)
  return digits
}

function isValidSwedishIdentityDate(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false

  const year = Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  const dayRaw = Number(value.slice(4, 6))
  const day = dayRaw > 60 ? dayRaw - 60 : dayRaw
  if (month < 1 || month > 12 || day < 1 || day > 31) return false

  const fullYear = year >= 40 ? 1900 + year : 2000 + year
  const date = new Date(Date.UTC(fullYear, month - 1, day))
  return (
    date.getUTCFullYear() === fullYear &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function isValidSwedishPersonalNumber(value: string | null | undefined): boolean {
  if (!value?.trim()) return true
  const normalized = normalizeTenDigitIdentity(value)
  return /^\d{10}$/.test(normalized) && isValidSwedishIdentityDate(normalized) && hasLuhnChecksum(normalized)
}

export function isValidSwedishOrganizationNumber(value: string | null | undefined): boolean {
  if (!value?.trim()) return true
  const digits = digitsOnly(value)
  const normalized = digits.length === 12 && digits.startsWith('16') ? digits.slice(2) : digits
  if (!/^\d{10}$/.test(normalized)) return false
  return Number(normalized[2]) >= 2 && hasLuhnChecksum(normalized)
}

function realCivilDate(year: number, month: number, dayRaw: number): Date | null {
  // Coordination numbers (samordningsnummer) add 60 to the day.
  const day = dayRaw > 60 ? dayRaw - 60 : dayRaw
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

/**
 * Canonical 12-digit form (YYYYMMDDNNNC) of a Swedish personnummer or
 * samordningsnummer, so 10- and 12-digit inputs for the same person collapse
 * to one value. For 10-digit input the century is the latest one that does not
 * put the birth date in the future; a '+' separator (Skatteverket notation for
 * age 100+) moves it back another 100 years. Returns null for invalid input.
 */
export function canonicalSwedishPersonalNumber(
  value: string | null | undefined,
  today: Date = new Date(),
): string | null {
  const raw = value?.trim() ?? ''
  if (!raw || !isValidSwedishPersonalNumber(raw)) return null
  const digits = digitsOnly(raw)
  const month = Number(digits.slice(-8, -6))
  const day = Number(digits.slice(-6, -4))
  if (digits.length === 12) {
    return realCivilDate(Number(digits.slice(0, 4)), month, day) ? digits : null
  }
  const yy = Number(digits.slice(0, 2))
  const currentYear = today.getUTCFullYear()
  let year = currentYear - (currentYear % 100) + yy
  const todayUtc = Date.UTC(currentYear, today.getUTCMonth(), today.getUTCDate())
  const birth = realCivilDate(year, month, day)
  if (!birth || birth.getTime() > todayUtc) year -= 100
  if (raw.includes('+')) year -= 100
  if (!realCivilDate(year, month, day)) return null
  return `${year}${digits.slice(2)}`
}

/**
 * Canonical organisation identity: a valid organisationsnummer as 10 digits
 * (an optional '16' century prefix is dropped). A sole trader (enskild firma)
 * uses the owner's personnummer as organisation number; that form is returned
 * as the canonical 12-digit personnummer. Returns null for invalid input.
 */
export function canonicalSwedishOrganizationNumber(
  value: string | null | undefined,
  today: Date = new Date(),
): string | null {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  const digits = digitsOnly(raw)
  if (isValidSwedishOrganizationNumber(raw)) {
    return digits.length === 12 ? digits.slice(2) : digits
  }
  return canonicalSwedishPersonalNumber(raw, today)
}

export function isValidSwedishPostalCode(value: string | null | undefined): boolean {
  if (!value) return true
  return /^\d{3}\s?\d{2}$/.test(value.trim())
}

export function normalizeSwedishPostalCode(value: string | null | undefined): string | null {
  const digits = digitsOnly(value)
  if (digits.length !== 5) return value?.trim() || null
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

export function isValidSwedishPhoneNumber(value: string | null | undefined): boolean {
  if (!value) return true
  const compact = value.replace(/[\s().-]/g, '')
  return /^(\+46|0046|0)\d{7,12}$/.test(compact)
}

export function isValidEmailAddress(value: string | null | undefined): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function isValidFacilityId(value: string | null | undefined): boolean {
  if (!value) return true
  return /^[A-Za-z0-9-]{6,35}$/.test(value.trim())
}

export function isValidMeterPointId(value: string | null | undefined): boolean {
  if (!value) return true
  return /^[A-Za-z0-9-]{6,35}$/.test(value.trim())
}

export function validateCustomerCoreFields(input: {
  personalNumber?: string | null
  orgNumber?: string | null
  postalCode?: string | null
  billingPostalCode?: string | null
  email?: string | null
  invoiceEmail?: string | null
  phone?: string | null
  facilityId?: string | null
  meterPointId?: string | null
}): CustomerValidationIssue[] {
  const issues: CustomerValidationIssue[] = []

  if (!isValidSwedishPersonalNumber(input.personalNumber)) {
    issues.push({ field: 'personalNumber', message: 'Personnummer ska vara ett giltigt svenskt personnummer med kontrollsiffra.' })
  }

  if (!isValidSwedishOrganizationNumber(input.orgNumber)) {
    issues.push({ field: 'orgNumber', message: 'Organisationsnummer ska vara ett giltigt svenskt organisationsnummer med kontrollsiffra.' })
  }

  if (!isValidSwedishPostalCode(input.postalCode)) {
    issues.push({ field: 'postalCode', message: 'Postnummer ska anges som 12345 eller 123 45.' })
  }

  if (!isValidSwedishPostalCode(input.billingPostalCode)) {
    issues.push({ field: 'billingPostalCode', message: 'Fakturapostnummer ska anges som 12345 eller 123 45.' })
  }

  if (!isValidEmailAddress(input.email)) {
    issues.push({ field: 'email', message: 'E-postadressen har ogiltigt format.' })
  }

  if (!isValidEmailAddress(input.invoiceEmail)) {
    issues.push({ field: 'invoiceEmail', message: 'Faktura-e-post har ogiltigt format.' })
  }

  if (!isValidSwedishPhoneNumber(input.phone)) {
    issues.push({ field: 'phone', message: 'Telefonnummer ska vara ett svenskt nummer, till exempel 0701234567 eller +46701234567.' })
  }

  if (!isValidFacilityId(input.facilityId)) {
    issues.push({ field: 'facilityId', message: 'Anläggnings-id får bara innehålla bokstäver, siffror och bindestreck.' })
  }

  if (!isValidMeterPointId(input.meterPointId)) {
    issues.push({ field: 'meterPointId', message: 'Mätpunkts-id får bara innehålla bokstäver, siffror och bindestreck.' })
  }

  return issues
}
