// lib/ediel/prodat/render/segments.ts

export function sanitizeProdatText(value?: string | null): string {
  return (value ?? '').replace(/[\r\n'+]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function sanitizeProdatToken(value?: string | null, maxLength = 35): string | null {
  const cleaned = sanitizeProdatText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_.\/-]/g, '')
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function compactProdatReference(value: string, maxLength: number): string {
  return sanitizeProdatText(value).replace(/[^A-Za-z0-9_.\/-]/g, '').slice(0, maxLength)
}

export function prodatPartySegment(role: 'FR' | 'DO', edielId: string): string {
  return `NAD+${role}+${sanitizeProdatText(edielId)}:160:SVK+++++++SE`
}

export type ProdatEndUserIdQualifier = 'SE1' | 'SE2' | '1'

export function normalizeProdatEndUserIdQualifier(
  value: string | null | undefined,
): ProdatEndUserIdQualifier | null {
  const normalized = sanitizeProdatText(value).toUpperCase()
  if (normalized === 'SE1' || normalized === 'SE2' || normalized === '1') return normalized
  return null
}

export function prodatCustomerNadSegment(params: {
  customerId?: string | null
  customerIdCodeListQualifier?: string | null
  customerName: string
  address?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
}): string {
  const customerId = sanitizeProdatText(params.customerId)
  const qualifier = normalizeProdatEndUserIdQualifier(params.customerIdCodeListQualifier)
  // PRODAT's Swedish end-user code lists SE1 (organisation number), SE2
  // (personal identity number) and 1 (date of birth) are maintained by Ediel
  // Nordic Forum. Code-list responsible must therefore be ZZZ, not ebIX/260.
  // Never infer the qualifier from identifier length: without an explicit
  // semantic qualifier the legal party id is omitted and preflight can block.
  const id = customerId && qualifier ? `${customerId}:${qualifier}:ZZZ` : ''
  const name = sanitizeProdatText(params.customerName) || 'KUND'
  const address = sanitizeProdatText(params.address)
  const city = sanitizeProdatText(params.city)
  const postalCode = sanitizeProdatText(params.postalCode)
  const country = sanitizeProdatText(params.country) || 'SE'
  return `NAD+UD+${id}++${name}+${address}+${city}++${postalCode}+${country}`
}

export function prodatInstallationNadSegment(params: {
  meterPointId: string
  address?: string | null
  city?: string | null
  postalCode?: string | null
  country?: string | null
}): string {
  const address = sanitizeProdatText(params.address)
  const city = sanitizeProdatText(params.city)
  const postalCode = sanitizeProdatText(params.postalCode)
  const country = sanitizeProdatText(params.country) || 'SE'
  const meterPointId = sanitizeProdatText(params.meterPointId)
  // No-placeholder: when there is no real object id, render an address-only
  // installation party without a fabricated id/agency component.
  const partyId = meterPointId ? `${meterPointId}::9` : ''
  return `NAD+IT+${partyId}+++${address}+${city}++${postalCode}+${country}`
}
