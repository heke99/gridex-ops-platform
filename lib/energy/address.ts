export type SwedishAddressParts = {
  originalStreet: string | null
  streetName: string | null
  streetNumber: string | null
  numberSuffix: string | null
  apartmentNumber: string | null
  normalizedStreet: string | null
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function compact(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Splits ordinary Swedish street input without guessing apartment numbers.
 * The original field is preserved and callers should always try the parsed
 * form before falling back to the exact original provider query.
 */
export function normaliseSwedishAddress(street: unknown, streetNumber?: unknown): SwedishAddressParts {
  const originalStreet = clean(street)
  const explicitNumber = clean(streetNumber)
  if (!originalStreet) {
    return {
      originalStreet: null,
      streetName: null,
      streetNumber: explicitNumber,
      numberSuffix: null,
      apartmentNumber: null,
      normalizedStreet: null,
    }
  }

  const value = compact(originalStreet)
  const apartmentMatch = value.match(/(?:,|\s)(?:lgh\.?|lägenhet|apt\.?)\s*([A-Za-z0-9-]+)$/i)
  const withoutApartment = apartmentMatch ? value.slice(0, apartmentMatch.index).trim() : value
  const parsed = withoutApartment.match(/^(.*?)(?:\s+)(\d+(?:\s*[-–]\s*\d+)?)(?:\s*([A-Za-zÅÄÖåäö]))?$/)
  const streetName = parsed?.[1] ? compact(parsed[1]) : withoutApartment
  const parsedNumber = parsed?.[2] ? parsed[2].replace(/\s+/g, '') : null
  const parsedSuffix = parsed?.[3] ? parsed[3].toUpperCase() : null
  const number = explicitNumber ?? (parsedNumber ? `${parsedNumber}${parsedSuffix ?? ''}` : null)

  return {
    originalStreet: value,
    streetName: streetName || null,
    streetNumber: number,
    numberSuffix: parsedSuffix,
    apartmentNumber: apartmentMatch?.[1] ?? null,
    normalizedStreet: streetName ? streetName.toLocaleLowerCase('sv-SE') : null,
  }
}
