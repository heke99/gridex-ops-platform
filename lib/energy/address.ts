export type SwedishAddressParts = {
  originalStreet: string | null
  streetName: string | null
  streetNumber: string | null
  numberSuffix: string | null
  apartmentNumber: string | null
  careOf: string | null
  normalizedStreet: string | null
  normalizedKey: string | null
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

function lower(value: string | null): string | null {
  return value ? value.toLocaleLowerCase('sv-SE') : null
}

/**
 * Normalises Swedish street input without guessing apartment identifiers as a
 * delivery-point number. The provider receives both parsed and original forms.
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
      careOf: null,
      normalizedStreet: null,
      normalizedKey: null,
    }
  }

  const value = compact(originalStreet)
  const careOfMatch = value.match(/^\s*(?:c\/o|co|care of)\s+([^,]+),\s*(.+)$/i)
  const careOf = careOfMatch?.[1] ? compact(careOfMatch[1]) : null
  const afterCareOf = careOfMatch?.[2] ? compact(careOfMatch[2]) : value
  const apartmentMatch = afterCareOf.match(/(?:,|\s)(?:lgh\.?|lägenhet|apt\.?)\s*([A-Za-z0-9-]+)$/i)
  const withoutApartment = apartmentMatch
    ? afterCareOf.slice(0, apartmentMatch.index).replace(/[\s,]+$/, '').trim()
    : afterCareOf
  const parsed = withoutApartment.match(/^(.*?)(?:\s+)(\d+(?:\s*[-–]\s*\d+)?)(?:\s*([A-Za-zÅÄÖåäö]))?$/)
  const streetName = parsed?.[1] ? compact(parsed[1]) : withoutApartment
  const parsedNumber = parsed?.[2] ? parsed[2].replace(/\s+/g, '') : null
  const parsedSuffix = parsed?.[3] ? parsed[3].toUpperCase() : null
  const number = explicitNumber ?? (parsedNumber ? `${parsedNumber}${parsedSuffix ?? ''}` : null)
  const normalizedStreet = lower(streetName || null)

  return {
    originalStreet: value,
    streetName: streetName || null,
    streetNumber: number,
    numberSuffix: parsedSuffix,
    apartmentNumber: apartmentMatch?.[1] ?? null,
    careOf,
    normalizedStreet,
    normalizedKey: [normalizedStreet, lower(number), lower(apartmentMatch?.[1] ?? null)]
      .filter((part): part is string => Boolean(part))
      .join('|') || null,
  }
}
