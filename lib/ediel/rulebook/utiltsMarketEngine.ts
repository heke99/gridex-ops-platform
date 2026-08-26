// Central Swedish UTILTS market semantics for Gridex.
//
// This module is deliberately pure: it owns supplier capability and delegates
// normative Application Reference validation to the exact 25-A-3 registry.

import { resolveVerifiedUtiltsApplicationReference } from '@/lib/ediel/rulebook/utiltsApplicationReference'

export type UtiltsRequestedMessageCode = 'S02' | 'E66'
export type UtiltsResolutionClass = 'monthly' | 'daily' | 'hourly' | 'quarter_hour'
export type SupplierUtiltsSupport = 'inbound_only' | 'outbound_only' | 'manual_review' | 'not_supplier_flow' | 'ack_only'

export type UtiltsMarketProfile = {
  code: 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'E30' | 'E31' | 'E66' | 'E72' | 'E73' | 'E74' | 'ERR'
  /** Gridex capability labels, not a substitute for the guide's field/actor matrix. */
  senderRoles: readonly string[]
  /** Gridex capability labels, not a substitute for the guide's field/actor matrix. */
  receiverRoles: readonly string[]
  bilateralRequired: boolean
  supplierSupport: SupplierUtiltsSupport
  businessMeaning: string
}

const IMBALANCE_SETTLEMENT_RESPONSIBLE = 'imbalance_settlement_responsible'
const GRID = 'grid_owner'
const SUPPLIER = 'supplier'
const BRP = 'balance_responsible'
const COLLECTOR = 'metering_collector'
const ESCO = 'energy_service_company'
const PRODUCER = 'producer'
const CUSTOMER = 'customer'
const SYSTEM_OPERATOR = 'system_operator'

export const UTILTS_MARKET_PROFILES: readonly UtiltsMarketProfile[] = [
  { code: 'S01', senderRoles: [IMBALANCE_SETTLEMENT_RESPONSIBLE], receiverRoles: [GRID, BRP], bilateralRequired: false, supplierSupport: 'not_supplier_flow', businessMeaning: 'Aggregerade avräkningsvärden från Svenska kraftnät/eSett i rollen Imbalance Settlement Responsible.' },
  { code: 'S02', senderRoles: [GRID], receiverRoles: [SUPPLIER], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Förbrukningsprognos per objekt från nätägare/Metered Data Responsible.' },
  { code: 'S03', senderRoles: [GRID], receiverRoles: [SUPPLIER, BRP, IMBALANCE_SETTLEMENT_RESPONSIBLE], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Aggregerade planvärden från nätägare/Metered Data Aggregator.' },
  { code: 'S04', senderRoles: [IMBALANCE_SETTLEMENT_RESPONSIBLE], receiverRoles: [BRP], bilateralRequired: false, supplierSupport: 'not_supplier_flow', businessMeaning: 'Aggregerade planvärden från eSett/Imbalance Settlement Responsible.' },
  { code: 'S05', senderRoles: [BRP], receiverRoles: [SUPPLIER], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Aggregerade avräkningsvärden från balansansvarig.' },
  { code: 'S06', senderRoles: [SUPPLIER, GRID, BRP], receiverRoles: [IMBALANCE_SETTLEMENT_RESPONSIBLE], bilateralRequired: true, supplierSupport: 'manual_review', businessMeaning: 'Bilateral begäran om saknade S01/S04 till Imbalance Settlement Responsible.' },
  { code: 'S07', senderRoles: [SUPPLIER], receiverRoles: [SUPPLIER, PRODUCER, CUSTOMER, BRP], bilateralRequired: true, supplierSupport: 'manual_review', businessMeaning: 'Tidsserie per objekt, avsändare Balance Supplier, Settlement.' },
  { code: 'E30', senderRoles: [COLLECTOR], receiverRoles: [GRID], bilateralRequired: false, supplierSupport: 'not_supplier_flow', businessMeaning: 'Insamlade mätvärden per objekt från Metered Data Collector.' },
  { code: 'E31', senderRoles: [GRID], receiverRoles: [IMBALANCE_SETTLEMENT_RESPONSIBLE, BRP, SUPPLIER], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Aggregerade mätdata från nätägare/Metered Data Aggregator.' },
  { code: 'E66', senderRoles: [GRID], receiverRoles: [SUPPLIER, GRID, PRODUCER, CUSTOMER, IMBALANCE_SETTLEMENT_RESPONSIBLE, ESCO, SYSTEM_OPERATOR], bilateralRequired: false, supplierSupport: 'inbound_only', businessMeaning: 'Validerade mätvärden per objekt från nätägare/Metered Data Responsible.' },
  { code: 'E72', senderRoles: [GRID], receiverRoles: [COLLECTOR], bilateralRequired: true, supplierSupport: 'not_supplier_flow', businessMeaning: 'Bilateral begäran om saknad E30.' },
  { code: 'E73', senderRoles: [SUPPLIER, BRP, ESCO, PRODUCER, CUSTOMER], receiverRoles: [GRID], bilateralRequired: true, supplierSupport: 'outbound_only', businessMeaning: 'Bilateral begäran om saknad S02 eller E66.' },
  { code: 'E74', senderRoles: [SUPPLIER, BRP, IMBALANCE_SETTLEMENT_RESPONSIBLE], receiverRoles: [GRID], bilateralRequired: true, supplierSupport: 'manual_review', businessMeaning: 'Bilateral begäran om saknad S03 eller E31.' },
  { code: 'ERR', senderRoles: [SUPPLIER, GRID, BRP, IMBALANCE_SETTLEMENT_RESPONSIBLE, ESCO, PRODUCER, CUSTOMER, COLLECTOR, SYSTEM_OPERATOR], receiverRoles: [SUPPLIER, GRID, BRP, IMBALANCE_SETTLEMENT_RESPONSIBLE, ESCO, PRODUCER, CUSTOMER, COLLECTOR, SYSTEM_OPERATOR], bilateralRequired: false, supplierSupport: 'ack_only', businessMeaning: 'UTILTS funktions-/processbarhetsfel.' },
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

/**
 * Backwards-compatible entry point with corrected semantics.
 *
 * The old implementation generated a string from actorRole + code + interval.
 * That is unsafe: field 311 is an explicit allowlist and S/T is not licensed to
 * be inferred merely from a local reading-frequency value. Callers must either
 * provide an exact candidate or target a single-valued profile such as S02.
 */
export function resolveCanonicalUtiltsApplicationReference(input: {
  code: string
  actorRole?: string | null
  requestedMessageCode?: string | null
  resolution?: unknown
  applicationReference?: string | null
}): string {
  return resolveVerifiedUtiltsApplicationReference({
    messageCode: input.code,
    requestedMessageCode: input.requestedMessageCode,
    applicationReference: input.applicationReference,
  })
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
