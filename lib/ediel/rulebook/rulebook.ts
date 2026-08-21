import type { EdielMessageFamily } from '@/lib/ediel/types'

export type EdielRulebookProcessGroup =
  | 'customer_masterdata'
  | 'supplier_switch'
  | 'delivery_contract'
  | 'masterdata'
  | 'metering'
  | 'metering_access'
  | 'meter_values'
  | 'ediel_ack'
  | 'ai_list'
  | 'unknown'

export type EdielRulebookRequirement = 'required' | 'dependent' | 'optional' | 'not_used' | 'forbidden'

export type EdielRulebookIssue = {
  severity: 'error' | 'warning'
  code: string
  title: string
  description: string
  fieldPath?: string | null
  blocking?: boolean
}

export type EdielRulebookMessageRule = {
  family: EdielMessageFamily | 'BI_LIST'
  code: string
  version: string
  previousVersion?: string | null
  applicationReference: string | null
  processGroup: EdielRulebookProcessGroup
  requiresContrl: boolean
  requiresAperak: boolean
  negativeAperakOnError: boolean
  requiresUtiltsErr: boolean
  validFrom: string
  validTo?: string | null
  status: 'active' | 'draft' | 'review' | 'superseded' | 'archived'
  allowedSubtypes?: string[]
  description: string
}

export const PRODAT_CUSTOMER_MASTERDATA_CODES = ['Z01', 'Z02'] as const
export const PRODAT_SUPPLIER_SWITCH_CODES = ['Z03', 'Z04', 'Z05'] as const
export const PRODAT_DELIVERY_CONTRACT_CODES = ['Z08'] as const
export const PRODAT_MASTERDATA_CODES = ['Z06', 'Z09'] as const
export const PRODAT_METERING_CODES = ['Z10'] as const
export const PRODAT_METERING_ACCESS_CODES = ['Z13', 'Z14', 'Z15', 'Z18'] as const
export const ACK_FAMILIES = ['CONTRL', 'APERAK', 'UTILTS_ERR'] as const

export function normalizeRulebookToken(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function includesCode(codes: readonly string[], code: string | null | undefined): boolean {
  return codes.includes(normalizeRulebookToken(code))
}

export function isProdatMeteringAccessCode(code: string | null | undefined): boolean {
  return includesCode(PRODAT_METERING_ACCESS_CODES, code)
}

export function isProdatSupplierSwitchCode(code: string | null | undefined): boolean {
  return includesCode(PRODAT_SUPPLIER_SWITCH_CODES, code)
}

export function isProdatCustomerMasterdataCode(code: string | null | undefined): boolean {
  return includesCode(PRODAT_CUSTOMER_MASTERDATA_CODES, code)
}

export function isProdatDeliveryContractCode(code: string | null | undefined): boolean {
  return includesCode(PRODAT_DELIVERY_CONTRACT_CODES, code)
}

export function isProdatMasterdataCode(code: string | null | undefined): boolean {
  return includesCode(PRODAT_MASTERDATA_CODES, code)
}

export function isProdatMeteringCode(code: string | null | undefined): boolean {
  return includesCode(PRODAT_METERING_CODES, code)
}

export function isAckFamily(family: string | null | undefined): boolean {
  return includesCode(ACK_FAMILIES, family)
}

export function processGroupForMessage(family: string | null | undefined, code: string | null | undefined): EdielRulebookProcessGroup {
  const normalizedFamily = normalizeRulebookToken(family)
  const normalizedCode = normalizeRulebookToken(code)
  if (normalizedFamily === 'PRODAT') {
    if (isProdatCustomerMasterdataCode(normalizedCode)) return 'customer_masterdata'
    if (isProdatSupplierSwitchCode(normalizedCode)) return 'supplier_switch'
    if (isProdatDeliveryContractCode(normalizedCode)) return 'delivery_contract'
    if (isProdatMasterdataCode(normalizedCode)) return 'masterdata'
    if (isProdatMeteringCode(normalizedCode)) return 'metering'
    if (isProdatMeteringAccessCode(normalizedCode)) return 'metering_access'
  }
  if (normalizedFamily === 'UTILTS') return 'meter_values'
  if (isAckFamily(normalizedFamily) || isAckFamily(normalizedCode)) return 'ediel_ack'
  if (normalizedFamily === 'AI_LIST' || normalizedCode === 'AI') return 'ai_list'
  if (normalizedFamily === 'BI_LIST' || normalizedCode === 'BI') return 'ai_list'
  return 'unknown'
}

export function defaultApplicationReferenceForProcess(processGroup: EdielRulebookProcessGroup, family?: string | null): string | null {
  if (family && normalizeRulebookToken(family) !== 'PRODAT') return null
  if (processGroup === 'metering_access') return '23-DGI-PRODAT'
  if (
    processGroup === 'supplier_switch'
    || processGroup === 'customer_masterdata'
    || processGroup === 'delivery_contract'
    || processGroup === 'masterdata'
    || processGroup === 'metering'
  ) return '23-DDQ-PRODAT'
  return null
}

export function messageVersionForFamily(family: string | null | undefined, code?: string | null): string {
  const normalizedFamily = normalizeRulebookToken(family)
  const normalizedCode = normalizeRulebookToken(code)
  if (normalizedFamily === 'PRODAT') return '26A'
  if (normalizedFamily === 'APERAK' || normalizedCode === 'APERAK') return '16B'
  if (normalizedFamily === 'CONTRL' || normalizedCode === 'CONTRL') return '1.0'
  if (normalizedFamily === 'UTILTS' || normalizedCode.startsWith('E') || normalizedCode.startsWith('S')) return 'E5SE5A'
  if (normalizedFamily === 'AI_LIST' || normalizedCode === 'AI' || normalizedCode === 'BI') return 'Ver20140401'
  return 'active'
}

export function activeRulebookRules(): EdielRulebookMessageRule[] {
  const prodatRules: EdielRulebookMessageRule[] = [
    { family: 'PRODAT', code: 'Z01', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'customer_masterdata', requiresContrl: true, requiresAperak: false, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['L', 'LK', 'Z22', 'Z23'], description: 'Förfrågan om kundidentitet/giltigt elnätsavtal inför relevant förändringsprocess.' },
    { family: 'PRODAT', code: 'Z02', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'customer_masterdata', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['L', 'LK', 'Z22', 'Z23'], description: 'Nätägarens svar på Z01.' },
    { family: 'PRODAT', code: 'Z03', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['L', 'LK', 'C', 'Z22', 'Z23', 'Z24'], description: 'Leverantörsbyte, kund- och leverantörsbyte eller återtagande.' },
    { family: 'PRODAT', code: 'Z04', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['L', 'LK', 'C', 'A', 'D', 'Z22', 'Z23', 'Z24', 'Z26', 'Z70'], description: 'Nätägarens bekräftelse/information om leveransförändring.' },
    { family: 'PRODAT', code: 'Z05', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'supplier_switch', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['L', 'LK', 'C', 'Z22', 'Z23', 'Z24'], description: 'Information till tidigare leverantör om leveransens upphörande eller återtagande.' },
    { family: 'PRODAT', code: 'Z06', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'masterdata', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['E', 'F', 'G', 'E34', 'E64', 'E32'], description: 'Nätägarens uppdatering av kund-/anläggningsgrunddata.' },
    { family: 'PRODAT', code: 'Z08', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'delivery_contract', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['H', 'Z25'], description: 'Leverantörens meddelande om hävning/avslut av leveransavtal.' },
    { family: 'PRODAT', code: 'Z09', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'masterdata', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['B', 'D', 'E', 'F', 'G', 'Z27', 'Z70', 'E34', 'E64', 'E32'], description: 'Leverantörens marknads-/masterdataändring till nätägaren.' },
    { family: 'PRODAT', code: 'Z10', version: '26A', previousVersion: null, applicationReference: '23-DDQ-PRODAT', processGroup: 'metering', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['M', 'E58'], description: 'Nätägarens mätarbyte/mätargrunddata.' },
    { family: 'PRODAT', code: 'Z13', version: '26A', previousVersion: null, applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['V', 'VH', 'S17', 'S18'], description: 'Berättigad parts begäran om start/historik för mätvärdesrapportering.' },
    { family: 'PRODAT', code: 'Z14', version: '26A', previousVersion: null, applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['V', 'VH', 'N', 'S17', 'S18', 'Z96'], description: 'Nätägarens godkännande/avslag av Z13.' },
    { family: 'PRODAT', code: 'Z15', version: '26A', previousVersion: null, applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['V', 'VH', 'C', 'S17', 'S18', 'Z24'], description: 'Nätägarens avslut av rapportering eller återtagande så att rapporteringen fortsätter.' },
    { family: 'PRODAT', code: 'Z18', version: '26A', previousVersion: null, applicationReference: '23-DGI-PRODAT', processGroup: 'metering_access', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', allowedSubtypes: ['V', 'S17'], description: 'Berättigad parts begäran att mätvärdesrapportering ska upphöra.' },
  ]

  return [
    ...prodatRules,
    { family: 'APERAK', code: 'APERAK', version: '16B', previousVersion: null, applicationReference: null, processGroup: 'ediel_ack', requiresContrl: true, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', description: 'Applikationskvittens.' },
    { family: 'CONTRL', code: 'CONTRL', version: '1.0', previousVersion: null, applicationReference: null, processGroup: 'ediel_ack', requiresContrl: false, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', description: 'Syntax-/teknisk kvittens.' },
    { family: 'UTILTS_ERR', code: 'UTILTS_ERR', version: 'E5SE5A', previousVersion: null, applicationReference: null, processGroup: 'ediel_ack', requiresContrl: true, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2026-04-01', status: 'active', description: 'Funktionsfel i UTILTS-flöde.' },
    { family: 'UTILTS', code: 'E66', version: 'E5SE5A', previousVersion: null, applicationReference: null, processGroup: 'meter_values', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: true, validFrom: '2025-06-01', status: 'active', description: 'Validerade mätdata per objekt.' },
    { family: 'UTILTS', code: 'E31', version: 'E5SE5A', previousVersion: null, applicationReference: null, processGroup: 'meter_values', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: true, validFrom: '2025-06-01', status: 'active', description: 'Summerade mätdata/slutliga andelstal.' },
    { family: 'UTILTS', code: 'S02', version: 'E5SE5A', previousVersion: null, applicationReference: null, processGroup: 'meter_values', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: true, validFrom: '2025-06-01', status: 'active', description: 'Förbrukningsprognos per objekt.' },
    { family: 'UTILTS', code: 'S03', version: 'E5SE5A', previousVersion: null, applicationReference: null, processGroup: 'meter_values', requiresContrl: true, requiresAperak: true, negativeAperakOnError: true, requiresUtiltsErr: true, validFrom: '2025-06-01', status: 'active', description: 'Preliminära andelstal/summerade planvärden.' },
    { family: 'AI_LIST', code: 'AI', version: 'Ver20140401', previousVersion: null, applicationReference: null, processGroup: 'ai_list', requiresContrl: false, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2025-10-01', status: 'active', description: 'Anläggningsinformationslista/strukturkontroll.' },
    { family: 'BI_LIST' as never, code: 'BI', version: 'Ver20140401', previousVersion: null, applicationReference: null, processGroup: 'ai_list', requiresContrl: false, requiresAperak: false, negativeAperakOnError: false, requiresUtiltsErr: false, validFrom: '2025-10-01', status: 'active', description: 'Ändringslista för anläggnings-id/nätområde/elnätsföretag.' },
  ]
}

export function getRulebookRule(family: string | null | undefined, code: string | null | undefined): EdielRulebookMessageRule | null {
  const normalizedFamily = normalizeRulebookToken(family)
  const normalizedCode = normalizeRulebookToken(code)
  return activeRulebookRules().find((rule) => normalizeRulebookToken(rule.family) === normalizedFamily && normalizeRulebookToken(rule.code) === normalizedCode) ?? null
}
