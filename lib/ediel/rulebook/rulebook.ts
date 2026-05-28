// lib/ediel/rulebook/rulebook.ts

import type { EdielMessageStandard } from '@/lib/ediel/types'

export type EdielRulebookFamily =
  | 'PRODAT'
  | 'UTILTS'
  | 'APERAK'
  | 'CONTRL'
  | 'UTILTS_ERR'
  | 'AI_LIST'
  | 'BI_LIST'

export type EdielBusinessProcess =
  | 'customer_masterdata'
  | 'supplier_switch'
  | 'metering_access'
  | 'meter_values'
  | 'ediel_ack'
  | 'ai_list'
  | 'unknown'

export type FieldRequirement = 'required' | 'dependent' | 'optional' | 'not_used' | 'forbidden'

export type RulebookSeverity = 'error' | 'warning' | 'info'

export type RulebookIssue = {
  severity: RulebookSeverity
  code: string
  title: string
  description: string
}

export type RulebookMessageRule = {
  family: EdielRulebookFamily
  code: string
  label: string
  standard: EdielMessageStandard | 'ai_list'
  currentVersion: string
  previousVersion?: string | null
  validFrom: string | null
  businessProcess: EdielBusinessProcess
  defaultApplicationReference: string | null
  requiresContrl: boolean
  requiresAperak: boolean
  supportsNegativeAperak: boolean
  supportsUtiltsErr: boolean
  runtimeStatus: 'runtime_ready' | 'runtime_partial' | 'documented_not_enabled'
}

export const PRODAT_PROCESS_BY_CODE: Record<string, EdielBusinessProcess> = {
  Z01: 'customer_masterdata',
  Z02: 'customer_masterdata',
  Z03: 'supplier_switch',
  Z04: 'supplier_switch',
  Z05: 'supplier_switch',
  Z06: 'supplier_switch',
  Z08: 'supplier_switch',
  Z09: 'supplier_switch',
  Z10: 'supplier_switch',
  Z13: 'metering_access',
  Z14: 'metering_access',
  Z15: 'metering_access',
  Z18: 'metering_access',
}

export const PRODAT_CODES = Object.freeze(Object.keys(PRODAT_PROCESS_BY_CODE))

export const PRODAT_SUBTYPE_TO_TRANSACTION_TYPE: Record<string, string> = {
  L: 'Z22',
  LK: 'Z23',
  C: 'Z24',
  A: 'Z26',
  B: 'Z27',
  M: 'E58',
  D: 'Z70',
  E: 'Z34',
  F: 'E64',
  G: 'E32',
  H: 'Z25',
  N: 'Z96',
  V: 'S17',
  VH: 'S18',
}

export const RULEBOOK_MESSAGE_RULES = [
  rule('PRODAT', 'Z01', 'Förfrågan kund-/anläggningsuppgifter', 'customer_masterdata', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z02', 'Svar på kund-/anläggningsuppgifter', 'customer_masterdata', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z03', 'Leverantörsbyte / inflytt', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z04', 'Bekräftelse leverantörsbyte / inflytt', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z05', 'Information till tidigare leverantör', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z06', 'Uppdatering grunddata från nätägare', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z08', 'Avslut/hävning av leveransavtal', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z09', 'Uppdatering grunddata från leverantör', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z10', 'Mätaruppdatering från nätägare', 'supplier_switch', '23-DDQ-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z13', 'Begäran om mätvärdesåtkomst', 'metering_access', '23-DGI-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z14', 'Svar på mätvärdesåtkomst', 'metering_access', '23-DGI-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z15', 'Mätvärdesrapportering upphör', 'metering_access', '23-DGI-PRODAT', true, true, '26A', '2026-04-01'),
  rule('PRODAT', 'Z18', 'Begäran om avslut av mätvärdesrapportering', 'metering_access', '23-DGI-PRODAT', true, true, '26A', '2026-04-01'),
  rule('UTILTS', 'E66', 'Validerade mätdata per objekt', 'meter_values', '23-DDQ-UTILTS', true, true, 'E5SE5A', '2025-06-01', 'runtime_ready', true),
  rule('UTILTS', 'E73', 'Begäran om saknade validerade mätdata', 'meter_values', '23-DDQ-UTILTS', true, true, 'E5SE5A', '2025-06-01', 'runtime_partial', true),
  rule('UTILTS', 'E30', 'Insamlade mätdata per objekt', 'meter_values', '23-DDQ-UTILTS', true, true, 'E5SE5A', '2025-06-01', 'runtime_partial', true),
  rule('UTILTS', 'E31', 'Summerade mätdata / andelstal', 'meter_values', '23-DDQ-E31-S', true, true, 'E5SE5A', '2025-06-01', 'runtime_ready', true),
  rule('UTILTS', 'S02', 'Förbrukningsprognos per objekt', 'meter_values', '23-DDQ-UTILTS', true, true, 'E5SE5A', '2025-06-01', 'runtime_partial', true),
  rule('UTILTS', 'S03', 'Preliminära andelstal / planvärden', 'meter_values', '23-DDQ-UTILTS', true, true, 'E5SE5A', '2025-06-01', 'runtime_partial', true),
  rule('APERAK', 'APERAK', 'Applikationskvittens', 'ediel_ack', null, false, false, 'E2SE6A', null, 'runtime_ready'),
  rule('CONTRL', 'CONTRL', 'Syntax-/teknisk kvittens', 'ediel_ack', null, false, false, 'D96A', null, 'runtime_ready'),
  rule('UTILTS_ERR', 'UTILTS_ERR', 'Funktionsfel för UTILTS', 'ediel_ack', null, false, false, 'E5SE5A', '2025-06-01', 'runtime_ready'),
  {
    family: 'AI_LIST',
    code: 'AI',
    label: 'AI-lista strukturdatakontroll',
    standard: 'ai_list',
    currentVersion: 'Ver20140401',
    previousVersion: null,
    validFrom: '2025-10-01',
    businessProcess: 'ai_list',
    defaultApplicationReference: null,
    requiresContrl: false,
    requiresAperak: false,
    supportsNegativeAperak: false,
    supportsUtiltsErr: false,
    runtimeStatus: 'runtime_ready',
  },
  {
    family: 'BI_LIST',
    code: 'BI',
    label: 'BI-lista ändring anläggnings-/nätområdesinformation',
    standard: 'ai_list',
    currentVersion: 'Ver20140401',
    previousVersion: null,
    validFrom: '2025-10-01',
    businessProcess: 'ai_list',
    defaultApplicationReference: null,
    requiresContrl: false,
    requiresAperak: false,
    supportsNegativeAperak: false,
    supportsUtiltsErr: false,
    runtimeStatus: 'runtime_ready',
  },
] as const satisfies readonly RulebookMessageRule[]

function rule(
  family: Exclude<EdielRulebookFamily, 'AI_LIST' | 'BI_LIST'>,
  code: string,
  label: string,
  businessProcess: EdielBusinessProcess,
  defaultApplicationReference: string | null,
  requiresContrl: boolean,
  requiresAperak: boolean,
  currentVersion: string,
  validFrom: string | null,
  runtimeStatus: RulebookMessageRule['runtimeStatus'] = 'runtime_ready',
  supportsUtiltsErr = false
): RulebookMessageRule {
  return {
    family,
    code,
    label,
    standard: 'edifact',
    currentVersion,
    previousVersion: family === 'PRODAT' ? '16B' : null,
    validFrom,
    businessProcess,
    defaultApplicationReference,
    requiresContrl,
    requiresAperak,
    supportsNegativeAperak: family === 'PRODAT' || family === 'UTILTS',
    supportsUtiltsErr,
    runtimeStatus,
  }
}

function normalize(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase()
}

export function getRulebookMessageRule(params: {
  family?: string | null
  code?: string | null
}): RulebookMessageRule | null {
  const family = normalize(params.family)
  const code = normalize(params.code)
  return RULEBOOK_MESSAGE_RULES.find((item) => item.family === family && item.code === code) ?? null
}

export function getBusinessProcessForMessage(params: {
  family?: string | null
  code?: string | null
}): EdielBusinessProcess {
  const family = normalize(params.family)
  const code = normalize(params.code)
  if (family === 'PRODAT') return PRODAT_PROCESS_BY_CODE[code] ?? 'unknown'
  if (family === 'UTILTS') return 'meter_values'
  if (family === 'CONTRL' || family === 'APERAK' || family === 'UTILTS_ERR') return 'ediel_ack'
  if (family === 'AI_LIST' || family === 'BI_LIST') return 'ai_list'
  return 'unknown'
}

export function expectedApplicationReferenceForProcess(process: EdielBusinessProcess): string | null {
  if (process === 'customer_masterdata' || process === 'supplier_switch') return '23-DDQ-PRODAT'
  if (process === 'metering_access') return '23-DGI-PRODAT'
  return null
}

export function isPermissionProdatCode(code?: string | null): boolean {
  return getBusinessProcessForMessage({ family: 'PRODAT', code }) === 'metering_access'
}

export function isSupplierSwitchProdatCode(code?: string | null): boolean {
  return getBusinessProcessForMessage({ family: 'PRODAT', code }) === 'supplier_switch'
}
