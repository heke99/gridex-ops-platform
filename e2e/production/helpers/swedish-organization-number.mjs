import { createHash } from 'node:crypto'

function normalizeOrganizationNumber(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function luhnCheckDigit(nineDigits) {
  if (!/^\d{9}$/.test(nineDigits)) {
    throw new Error('Luhn base must contain exactly nine digits.')
  }

  let sum = 0
  for (let index = 0; index < nineDigits.length; index += 1) {
    const product = Number(nineDigits[index]) * (index % 2 === 0 ? 2 : 1)
    sum += Math.floor(product / 10) + (product % 10)
  }

  return String((10 - (sum % 10)) % 10)
}

export function isValidSwedishOrganizationNumber(value) {
  const digits = normalizeOrganizationNumber(value)
  if (!/^\d{10}$/.test(digits)) return false

  // Swedish organization numbers use the third digit to distinguish them
  // from dates/person numbers. Values below 2 are not valid organization numbers.
  if (Number(digits[2]) < 2) return false

  return luhnCheckDigit(digits.slice(0, 9)) === digits[9]
}

export function syntheticSwedishOrganizationNumber(seed) {
  const normalizedSeed = String(seed ?? '').trim()
  if (!normalizedSeed) {
    throw new Error('Synthetic organization number seed is required.')
  }

  // 559 is a normal Swedish limited-company organization-number prefix and
  // guarantees that the third digit satisfies the organization-number rule.
  // The remaining six base digits are deterministic for a given E2E run.
  const digest = createHash('sha256').update(normalizedSeed).digest('hex')
  const serial = (BigInt(`0x${digest.slice(0, 16)}`) % 1_000_000n)
    .toString()
    .padStart(6, '0')
  const base = `559${serial}`
  const digits = `${base}${luhnCheckDigit(base)}`
  const formatted = `${digits.slice(0, 6)}-${digits.slice(6)}`

  if (!isValidSwedishOrganizationNumber(formatted)) {
    throw new Error('Generated Swedish organization number failed validation.')
  }

  return formatted
}
