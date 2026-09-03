import { supabaseService } from '@/lib/supabase/service'
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

export type ResolvedEdielPartyRoute = {
  party: EdielPartyRow
  address: EdielPartyAddressRow
  match: 'exact_business_code' | 'family'
  generatedUnbReceiver: string
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

function isActiveAddress(row: EdielPartyAddressRow, now = new Date()): boolean {
  if (row.status !== 'active') return false
  if (row.valid_from && Date.parse(row.valid_from) > now.getTime()) return false
  if (row.valid_to && Date.parse(row.valid_to) <= now.getTime()) return false
  return true
}

function bestAddressMatch(params: {
  rows: EdielPartyAddressRow[]
  businessCode?: string | null
}): { address: EdielPartyAddressRow; match: ResolvedEdielPartyRoute['match'] } | null {
  const businessCode = upper(params.businessCode)
  const activeRows = params.rows.filter((row) => isActiveAddress(row))
  if (businessCode) {
    const exact = activeRows.find((row) => upper(row.business_code) === businessCode)
    if (exact) return { address: exact, match: 'exact_business_code' }
  }
  const family = activeRows.find((row) => {
    const code = upper(row.business_code)
    return !code || code === '*'
  })
  return family ? { address: family, match: 'family' } : null
}

export async function resolveEdielPartyRoute(input: {
  partyId?: string | null
  edielId?: string | null
  environment: 'test' | 'production' | 'agt' | string
  messageFamily: string
  businessCode?: string | null
}): Promise<ResolvedEdielPartyRoute> {
  const partyId = clean(input.partyId)
  const edielId = clean(input.edielId)
  const messageFamily = upper(input.messageFamily)
  const environment = clean(input.environment)?.toLowerCase()

  if (!partyId && !edielId) throw new Error('Party route resolution requires party_id or ediel_id.')
  if (!messageFamily) throw new Error('Party route resolution requires message_family.')
  if (!environment) throw new Error('Party route resolution requires environment.')

  let partyQuery = supabaseService
    .from('ediel_parties')
    .select('*')
    .limit(1)

  partyQuery = partyId ? partyQuery.eq('id', partyId) : partyQuery.eq('ediel_id', edielId)

  const { data: partyData, error: partyError } = await partyQuery.maybeSingle()
  if (partyError) throw partyError
  if (!partyData) throw new Error(`Sändning stoppad: verifierad Ediel-part saknas för ${edielId ?? partyId}.`)

  const party = partyData as EdielPartyRow
  if (party.status !== 'verified') {
    throw new Error(`Sändning stoppad: Ediel-part ${party.name} (${party.ediel_id}) är ${party.status}, inte verified.`)
  }

  const addressEnvironment = environment === 'agt' ? ['agt', 'test'] : [environment]
  const { data: addressData, error: addressError } = await supabaseService
    .from('ediel_party_addresses')
    .select('*')
    .eq('party_id', party.id)
    .in('environment', addressEnvironment)
    .eq('message_family', messageFamily)
    .order('business_code', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })

  if (addressError) throw addressError
  const match = bestAddressMatch({
    rows: (addressData ?? []) as EdielPartyAddressRow[],
    businessCode: input.businessCode,
  })

  if (!match) {
    throw new Error(
      `Sändning stoppad: säker route saknas för ${party.name} (${party.ediel_id}) ${environment}/${messageFamily}${
        input.businessCode ? ` ${input.businessCode}` : ''
      }.`,
    )
  }

  if (match.address.requires_subaddress && !clean(match.address.subaddress)) {
    throw new Error(`Sändning stoppad: routen för ${party.ediel_id}/${messageFamily} kräver subadress men saknar värde.`)
  }

  return {
    party,
    address: match.address,
    match: match.match,
    generatedUnbReceiver: buildEdielAddress(match.address.ediel_id, match.address.qualifier, match.address.subaddress),
  }
}
