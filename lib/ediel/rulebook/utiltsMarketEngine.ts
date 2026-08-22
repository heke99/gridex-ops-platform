// Central Swedish UTILTS market semantics for Gridex.
//
// This module is deliberately pure: it owns market-role direction, bilateral
// requirements and Application Reference selection. Transport/routes may prove
// capabilities, but they may not redefine these semantics.

export type UtiltsRequestedMessageCode = 'S02' | 'E66'
export type UtiltsResolutionClass = 'monthly' | 'daily' | 'hourly' | 'quarter_hour'
export type SupplierUtiltsSupport = 'inbound_only' | 'outbound_only' | 'manual_review' | 'not_supplier_flow' | 'ack_only'

export type UtiltsMarketProfile = {
  code: 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'E30' | 'E31' | 'E66' | 'E72' | 'E73' | 'E74' | 'ERR'
  senderRoles: readonly string[]
  receiverRoles: readonly string[]
  bilateralRequired: boolean
  supplierSupport: SupplierUtiltsSupport
  businessMeaning: string
}

const TSO = 'transmission_system_operator'
const GRID = 'grid_owner'
const SUPPLIER = 'supplier'
const BRP = 'balance_responsible'
const COLLECTOR = 'metering_collector'
const ESCO = 'energy_service_company'
const PRODUCER = 'producer'
const CUSTOMER = 'customer'

export const UTILTS_MARKET_PROFILES: readonly UtiltsMarketProfile[] = [
  { code: 'S01', senderRoles: [TSO], receiverRoles: [GRID, BRP], bilateralRequired: false, supplierSupport: 'not_supplier_flow', businessMeaning: 'Aggregerade avräkningsvärden.' },
  { code: 'S02', senderRoles: [GRID], receiverRoles: [SUPPLIER], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Förbrukningsprognos per objekt.' },
  { code: 'S03', senderRoles: [GRID], receiverRoles: [SUPPLIER, BRP, TSO], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Preliminära andelar/aggregerade planvärden.' },
  { code: 'S04', senderRoles: [TSO], receiverRoles: [BRP], bilateralRequired: false, supplierSupport: 'not_supplier_flow', businessMeaning: 'Summerade planvärden.' },
  { code: 'S05', senderRoles: [BRP], receiverRoles: [SUPPLIER], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Aggregerade avräkningsvärden från balansansvarig.' },
  { code: 'S06', senderRoles: [SUPPLIER, GRID, BRP], receiverRoles: [TSO], bilateralRequired: true, supplierSupport: 'manual_review', businessMeaning: 'Bilateral begäran om saknade S01/S04.' },
  { code: 'S07', senderRoles: [SUPPLIER], receiverRoles: [SUPPLIER, PRODUCER, CUSTOMER, BRP], bilateralRequired: true, supplierSupport: 'manual_review', businessMeaning: 'Bilateral objekttidsserie mellan marknadsaktörer.' },
  { code: 'E30', senderRoles: [COLLECTOR], receiverRoles: [GRID], bilateralRequired: false, supplierSupport: 'not_supplier_flow', businessMeaning: 'Insamlade mätvärden per objekt.' },
  { code: 'E31', senderRoles: [GRID], receiverRoles: [TSO, BRP, SUPPLIER], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Aggregerade mätvärden.' },
  { code: 'E66', senderRoles: [GRID], receiverRoles: [SUPPLIER, GRID, PRODUCER, CUSTOMER, TSO, ESCO], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Validerade mätvärden per objekt.' },
  { code: 'E72', senderRoles: [GRID], receiverRoles: [COLLECTOR], bilateralRequired: true, supplierSupport: 'not_supplier_flow', businessMeaning: 'Bilateral begäran om saknad E30.' },
  { code: 'E73', senderRoles: [SUPPLIER, BRP, ESCO, PRODUCER, CUSTOMER], receiverRoles: [GRID], bilateralRequired: true, supplierSupport: 'outbound_only', businessMeaning: 'Bilateral begäran om saknad S02 eller E66.' },
  { code: 'E74', senderRoles: [SUPPLIER, BRP, TSO], receiverRoles: [GRID], bilateralRequired: true, supplierSupport: 'manual_review', businessMeaning: 'Bilateral begäran om saknad S03 eller E31.' },
  { code: 'ERR', senderRoles: [SUPPLIER, GRID, BRP, TSO, ESCO, PRODUCER, CUSTOMER, COLLECTOR], receiverRoles: [SUPPLIER, GRID, BRP, TSO, ESCO, PRODUCER, CUSTOMER, COLLECTOR], bilateralRequired: false, supplierSupport: 'ack_only', businessMeaning: 'UTILTS funktions-/processbarhetsfel.' },
] as const

export function getUtiltsMarketProfile(code: string | null | undefined): UtiltsMarketProfile | null {
  const normalized = String(code ?? '').trim().toUpperCase()
  return UTILTS_MARKET_PROFILES.find((profile) => profile.code === normalized) ?? null
}

export function getSupplierUtiltsSupport(code: string | null | undefined): SupplierUtiltsSupport {
  return getUtiltsMarketProfile(code)?.supplierSupport ?? 'manual_review'
}

export function normalizeUtiltsResolutionClass(value: unknown): UtiltsResolutionClass {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (['15', 'PT15M', 'QUARTER_HOUR', 'QUARTER-HOUR', 'KVART'].includes(normalized)) return 'quarter_hour'
  if (['60', 'PT60M', 'HOURLY', 'HOUR'].includes(normalized)) return 'hourly'
  if (['1440', 'P1D', 'DAILY', 'DAY'].includes(normalized)) return 'daily'
  return 'monthly'
}

function roleToken(actorRole: string | null | undefined): 'DDQ' | 'DGI' {
  const role = String(actorRole ?? '').trim().toLowerCase()
  return role === 'esco' || role === 'energy_service_company' || role === 'entitled_party' ? 'DGI' : 'DDQ'
}

function utiltsApplicationToken(input: {
  code: string
  resolution?: unknown
}): string {
  const code = String(input.code ?? '').trim().toUpperCase()
  const resolution = normalizeUtiltsResolutionClass(input.resolution)
  if (code === 'S02') return 'S02-S'
  if (code === 'E66') return resolution === 'quarter_hour' ? 'E66-T' : 'E66-S'
  if (code === 'S03') return 'S03-S'
  if (code === 'E31') return 'E31-S'
  throw new Error(`utilts_application_reference_unsupported:${code || 'missing'}`)
}

export function resolveCanonicalUtiltsApplicationReference(input: {
  code: string
  actorRole?: string | null
  requestedMessageCode?: string | null
  resolution?: unknown
}): string {
  const code = String(input.code ?? '').trim().toUpperCase()
  const role = roleToken(input.actorRole)

  if (code === 'E73') {
    const requested = String(input.requestedMessageCode ?? '').trim().toUpperCase()
    if (requested !== 'S02' && requested !== 'E66') {
      throw new Error('utilts_e73_requested_message_required')
    }
    return `23-${role}-${utiltsApplicationToken({ code: requested, resolution: input.resolution })}`
  }

  return `23-${role}-${utiltsApplicationToken({ code, resolution: input.resolution })}`
}

export function assertSupplierUtiltsOutboundAllowed(input: {
  code: string
  bilateralCapabilityVerified?: boolean
  requestedMessageCode?: string | null
}): { requestedMessageCode: UtiltsRequestedMessageCode | null } {
  const code = String(input.code ?? '').trim().toUpperCase()
  const profile = getUtiltsMarketProfile(code)
  if (!profile || profile.supplierSupport !== 'outbound_only') {
    throw new Error(`utilts_supplier_outbound_not_allowed:${code || 'missing'}`)
  }
  if (profile.bilateralRequired && input.bilateralCapabilityVerified !== true) {
    throw new Error(`utilts_bilateral_capability_required:${code}`)
  }
  if (code === 'E73') {
    const requested = String(input.requestedMessageCode ?? '').trim().toUpperCase()
    if (requested !== 'S02' && requested !== 'E66') {
      throw new Error('utilts_e73_requested_message_required')
    }
    return { requestedMessageCode: requested }
  }
  return { requestedMessageCode: null }
}
