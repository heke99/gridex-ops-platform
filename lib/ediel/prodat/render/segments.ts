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

export function normalizeProdatEndUserIdQualifier(
  value: string | null | undefined,
  customerId: string | null
): 'SE1' | 'SE2' | '1' {
  const normalized = sanitizeProdatText(value).toUpperCase()
  if (normalized === 'SE1' || normalized === 'SE2' || normalized === '1') return normalized
  if (customerId && /^\d{10}$/.test(customerId)) return 'SE1'
  if (customerId && /^\d{12}$/.test(customerId)) return 'SE2'
  return 'SE2'
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
  const qualifier = normalizeProdatEndUserIdQualifier(params.customerIdCodeListQualifier, customerId || null)
  const id = customerId ? `${customerId}:${qualifier}:260` : ''
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
  return `NAD+IT+${sanitizeProdatText(params.meterPointId)}::9+++${address}+${city}++${postalCode}+${country}`
}
