import {prodatEndUserAddressWireLines} from '@/lib/ediel/prodat/prodatEndUserAddress'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
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

function partyText(value: string | null | undefined, max: number): string {
  const text = String(value ?? '').trim()
  if (text.length > max || /[\x00-\x1f\x7f]/.test(text)) throw new Error('prodat_party_field_invalid')
  return text
}

function partyLines(value: string | null | undefined, lines: readonly string[] | undefined, max: number): string {
  const parts = lines ?? [value ?? '']
  if (parts.length > max) throw new Error('prodat_party_components_invalid')
  return parts.map(part => escapeEdifactValue(partyText(part, 35))).join(':')
}

export function prodatPartySegment(role: 'FR' | 'DO', edielId: string, country = 'SE'): string {
  const id = partyText(edielId, 35)
  if (!id || !/^[A-Z]{2}$/.test(country)) throw new Error('prodat_legal_party_invalid')
  return `NAD+${role}+${escapeEdifactValue(id)}:160:SVK+++++++${country}`
}

export type ProdatEndUserIdQualifier = 'SE1' | 'SE2' | '1'

export function normalizeProdatEndUserIdQualifier(value: string | null | undefined): ProdatEndUserIdQualifier | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (normalized === 'SE1' || normalized === 'SE2' || normalized === '1') return normalized
  return null
}

type CustomerPartyInput = {
  customerId?: string | null
  customerIdCodeListQualifier?: string | null
  idAgency?: '89' | '260'
  customerName: string
  nameLines?: readonly string[]
  address?: string | null
  addressLines?: readonly string[]
  city?: string | null
  postalCode?: string | null
  country?: string | null
}

function customerParty(role: 'UD' | 'IV', params: CustomerPartyInput): string {
  const customerId = partyText(params.customerId, 35)
  const qualifier = normalizeProdatEndUserIdQualifier(params.customerIdCodeListQualifier)
  if (params.customerIdCodeListQualifier?.trim() && !qualifier) throw new Error('prodat_party_code_list_invalid')
  if (params.idAgency === '89' && qualifier) throw new Error('prodat_party_code_list_invalid')
  // P26.A r3 pp79/82: 1/SE1/SE2 use ebIX 260; distributor-assigned IDs use
  // agency89 with no list qualifier. Never infer a legal-id type from length.
  const id = customerId && qualifier ? `${escapeEdifactValue(customerId)}:${qualifier}:260`
    : customerId && params.idAgency === '89' ? `${escapeEdifactValue(customerId)}::89` : ''
  const name = partyLines(params.customerName, params.nameLines, 2)
  const address = partyLines(params.address, params.addressLines, 3)
  const city = escapeEdifactValue(partyText(params.city, 35))
  const postalCode = escapeEdifactValue(partyText(params.postalCode, 9))
  const country = partyText(params.country ?? 'SE', 3)
  if (country && !/^[A-Z]{2,3}$/.test(country)) throw new Error('prodat_party_country_invalid')
  return `NAD+${role}+${id}++${name}+${address}+${city}++${postalCode}+${country}`
}

export function prodatCustomerNadSegment(params: CustomerPartyInput): string {
  return customerParty('UD', {...params,addressLines:params.addressLines ? prodatEndUserAddressWireLines(params.addressLines) : undefined})
}

export function prodatInvoiceeNadSegment(params: CustomerPartyInput): string {
  return customerParty('IV', params)
}

export function prodatInstallationNadSegment(params: {
  meterPointId: string
  address?: string | null
  addressLines?: readonly string[]
  city?: string | null
  postalCode?: string | null
  country?: string | null
  idAgency?: '9' | '89'
}): string {
  const id = partyText(params.meterPointId, 25)
  const address = partyLines(params.address, params.addressLines, 3)
  const city = escapeEdifactValue(partyText(params.city, 35))
  const postalCode = escapeEdifactValue(partyText(params.postalCode, 9))
  const country = partyText(params.country ?? 'SE', 3)
  if (country && !/^[A-Z]{2,3}$/.test(country)) throw new Error('prodat_party_country_invalid')
  // Missing source identity stays absent; never manufacture an installation.
  const partyId = id ? `${escapeEdifactValue(id)}::${params.idAgency ?? '9'}` : ''
  return `NAD+IT+${partyId}+++${address}+${city}++${postalCode}+${country}`
}

export function prodatBalanceResponsibleSegment(id: string): string {
  const value = partyText(id, 35)
  if (!value) throw new Error('prodat_balance_responsible_invalid')
  return `NAD+Z02+${escapeEdifactValue(value)}:160:SVK`
}
