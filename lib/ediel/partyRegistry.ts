import { fullEdielAddress, normalizeEdielSubaddress } from '@/lib/ediel/security/outboundRecipientCertificate'

export type EdielPartyRole =
  | 'grid_owner'
  | 'electricity_supplier'
  | 'energy_service_company'
  | 'brp'
  | 'ediel_portal'
  | 'test_counterparty'
  | 'grid_owner_in_agt_context'
  | 'system_supplier'
  | 'other'

export type EdielPartyStatus = 'draft' | 'verified' | 'inactive' | 'blocked' | 'needs_verification'

export type EdielTransportSecurityMode =
  | 'required_encrypted'
  | 'encrypted'
  | 'unencrypted'
  | 'needs_verification'

export type EdielPartyRow = {
  id: string
  name: string
  organization_number: string | null
  ediel_id: string
  roles: EdielPartyRole[] | string[] | null
  status: EdielPartyStatus | string
  visible_to_customer_flow: boolean
  source: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type EdielPartyAddressRow = {
  id: string
  party_id: string
  ediel_id: string
  qualifier: string
  subaddress: string | null
  message_family: string
  message_type: string | null
  business_code: string | null
  environment: 'test' | 'production' | 'agt' | string
  smtp_address: string
  transport_security_mode: EdielTransportSecurityMode | string
  requires_subaddress: boolean
  certificate_required: boolean
  receiver_certificate_id: string | null
  status: 'active' | 'inactive' | 'expired' | 'needs_verification' | string
  source: string | null
  last_verified_at: string | null
  valid_from: string | null
  valid_to: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

function clean(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function upper(value?: string | null): string | null {
  return clean(value)?.toUpperCase() ?? null
}

export function normalizeTransportSecurityMode(value?: string | null): EdielTransportSecurityMode {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'required_encrypted' || normalized === 'required-encrypted') return 'required_encrypted'
  if (normalized === 'encrypted' || normalized === 'smime' || normalized === 's/mime') return 'encrypted'
  if (normalized === 'unencrypted' || normalized === 'none' || normalized === 'plain') return 'unencrypted'
  return 'needs_verification'
}

export function resolveRouteTransportSecurityMode(params: {
  transportSecurityMode?: unknown
  encryptionMode?: unknown
}): EdielTransportSecurityMode {
  const explicit = String(params.transportSecurityMode ?? '').trim()
  if (explicit) return normalizeTransportSecurityMode(explicit)

  // transport_mode is a protocol (for example smtp_imap), never a security policy.
  // Legacy/materialized routes persist the effective security decision in encryption_mode.
  const encryption = String(params.encryptionMode ?? '').trim().toLowerCase()
  if (encryption === 'encrypted' || encryption === 'smime' || encryption === 's/mime') return 'encrypted'
  if (encryption === 'unencrypted' || encryption === 'none' || encryption === 'plain') return 'unencrypted'
  return 'needs_verification'
}

export function transportSecurityModeToEncryptionMode(mode?: string | null): 'smime' | 'none' | null {
  const normalized = normalizeTransportSecurityMode(mode)
  if (normalized === 'required_encrypted' || normalized === 'encrypted') return 'smime'
  if (normalized === 'unencrypted') return 'none'
  return null
}

export function isAgtPortalProdatAddress(input: {
  receiverEdielId?: string | null
  receiverSubaddress?: string | null
  messageFamily?: string | null
  environment?: string | null
}): boolean {
  return (
    upper(input.receiverEdielId) === '91100' &&
    upper(input.receiverSubaddress) === 'PRODAT' &&
    upper(input.messageFamily) === 'PRODAT' &&
    (upper(input.environment) === 'TEST' || upper(input.environment) === 'AGT')
  )
}

export function buildEdielAddress(edielId?: string | null, qualifier?: string | null, subaddress?: string | null): string {
  const address = fullEdielAddress(clean(edielId), clean(qualifier) ?? 'ZZ', normalizeEdielSubaddress(subaddress))
  if (!address) throw new Error('Ediel address requires ediel_id.')
  return address
}

// IMP-02/SC-058: the former market-less party-route resolver (first active
// ediel_party_addresses match, no EL/GAS) was removed. Outbound routing must
// use the source-qualified EL registry route (registryMarketSource.ts).
