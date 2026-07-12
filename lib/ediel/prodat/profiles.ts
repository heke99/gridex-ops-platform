import type { ProdatEngineCode, ProdatEngineProductionContext, ProdatEngineValidationIssue } from '@/lib/ediel/prodat/types'
import { sanitizeProdatText } from '@/lib/ediel/prodat/render/segments'

function textValue(value: unknown): string {
  return typeof value === 'string' ? sanitizeProdatText(value) : ''
}

export type ProdatProfile = {
  key: string
  code: ProdatEngineCode
  subtype: string
  version: string
  requiredContext: readonly (keyof ProdatEngineProductionContext)[]
  requiresCustomerIdentity: boolean
  requiresMeterPoint: boolean
  requiresStartDate: boolean
  requiresEndDate: boolean
  businessResponse?: string | null
}

const PROFILES: readonly ProdatProfile[] = [
  { key: 'prodat_26a_z01', code: 'Z01', subtype: '*', version: '26A', requiredContext: ['customerName'], requiresCustomerIdentity: false, requiresMeterPoint: false, requiresStartDate: false, requiresEndDate: false, businessResponse: 'Z02' },
  { key: 'prodat_26a_z02', code: 'Z02', subtype: '*', version: '26A', requiredContext: ['customerName'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false },
  { key: 'prodat_26a_z03_l', code: 'Z03', subtype: 'L', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false, businessResponse: 'Z04L' },
  { key: 'prodat_26a_z03_lk', code: 'Z03', subtype: 'LK', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false, businessResponse: 'Z04LK' },
  { key: 'prodat_26a_z04_l', code: 'Z04', subtype: 'L', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z04_lk', code: 'Z04', subtype: 'LK', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z04_c', code: 'Z04', subtype: 'C', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false },
  { key: 'prodat_26a_z04_a', code: 'Z04', subtype: 'A', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z04_d', code: 'Z04', subtype: 'D', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true },
  { key: 'prodat_26a_z05_l', code: 'Z05', subtype: 'L', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z08_h', code: 'Z08', subtype: 'H', version: '26A', requiredContext: ['contractClosureReason'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true, businessResponse: 'Z05L' },
  { key: 'prodat_26a_z06_f', code: 'Z06', subtype: 'F', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false },
  { key: 'prodat_26a_z06_g', code: 'Z06', subtype: 'G', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false },
  { key: 'prodat_26a_z09_f', code: 'Z09', subtype: 'F', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: false, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z09_g', code: 'Z09', subtype: 'G', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: false, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z09_d', code: 'Z09', subtype: 'D', version: '26A', requiredContext: ['reasonForTransaction'], requiresCustomerIdentity: false, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z10', code: 'Z10', subtype: '*', version: '26A', requiredContext: [], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false },
  { key: 'prodat_26a_z13_v', code: 'Z13', subtype: 'V', version: '26A', requiredContext: ['reasonForTransaction', 'installationDirection', 'permissionPurpose', 'reportingFrequency', 'energyProductId'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z13_vh', code: 'Z13', subtype: 'VH', version: '26A', requiredContext: ['reasonForTransaction', 'installationDirection', 'permissionPurpose', 'reportingFrequency', 'energyProductId', 'permissionEndDate'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: true },
  { key: 'prodat_26a_z14_v', code: 'Z14', subtype: 'V', version: '26A', requiredContext: ['permissionStatus'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: false },
  { key: 'prodat_26a_z14_n', code: 'Z14', subtype: 'N', version: '26A', requiredContext: ['permissionStatus'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: false },
  { key: 'prodat_26a_z14_vh', code: 'Z14', subtype: 'VH', version: '26A', requiredContext: ['permissionStatus', 'permissionEndDate'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: true, requiresEndDate: true },
  { key: 'prodat_26a_z15_v', code: 'Z15', subtype: 'V', version: '26A', requiredContext: ['permissionStatus', 'permissionEndReason', 'permissionEndDate'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true },
  { key: 'prodat_26a_z18_v', code: 'Z18', subtype: 'V', version: '26A', requiredContext: ['permissionId', 'permissionTimestamp', 'permissionEndReason', 'permissionEndDate'], requiresCustomerIdentity: true, requiresMeterPoint: true, requiresStartDate: false, requiresEndDate: true },
] as const

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

export function normalizeProdatSubtype(code: ProdatEngineCode, value?: string | null, context?: ProdatEngineProductionContext): string {
  const explicit = normalize(value)
  if (explicit) return explicit.replace(code, '') || explicit
  const reason = normalize(context?.reasonForTransaction)
  if (reason === 'Z22') return 'L'
  if (reason === 'Z23') return 'LK'
  if (reason === 'E64') return 'F'
  if (reason === 'E32') return 'G'
  if (reason === 'Z70') return 'D'
  if (reason === 'S18') return 'VH'
  if (reason === 'S17') return 'V'
  if (code === 'Z08') return 'H'
  if (['Z01', 'Z02', 'Z10'].includes(code)) return '*'
  return ''
}

export function resolveProdatProfile(input: {
  code: ProdatEngineCode
  subtype?: string | null
  version?: string | null
  context: ProdatEngineProductionContext
}): ProdatProfile | null {
  const version = normalize(input.version).replace('E2SE6A', '26A') || '26A'
  const subtype = normalizeProdatSubtype(input.code, input.subtype, input.context)
  return PROFILES.find((profile) => profile.code === input.code && profile.version === version && (profile.subtype === subtype || profile.subtype === '*')) ?? null
}

export function validateProdatProfile(input: {
  code: ProdatEngineCode
  subtype?: string | null
  version?: string | null
  context: ProdatEngineProductionContext
}): { profile: ProdatProfile | null; issues: ProdatEngineValidationIssue[] } {
  const profile = resolveProdatProfile(input)
  const issues: ProdatEngineValidationIssue[] = []
  if (!profile) {
    issues.push({
      severity: 'error',
      code: 'prodat_profile_missing',
      title: 'PRODAT-profil saknas',
      description: `Ingen aktiv profil finns för ${input.code}/${normalizeProdatSubtype(input.code, input.subtype, input.context) || 'saknad subtype'}/${input.version ?? '26A'}. Affärsdata får inte gissas.`,
    })
    return { profile: null, issues }
  }

  for (const key of profile.requiredContext) {
    if (!textValue(input.context[key])) {
      issues.push({
        severity: 'error',
        code: `prodat_${input.code.toLowerCase()}_${String(key)}_missing`,
        title: `Obligatoriskt fält saknas: ${String(key)}`,
        description: `${profile.key} kräver ${String(key)}. Buildern får inte skapa ett standardvärde.`,
      })
    }
  }
  if (profile.requiresCustomerIdentity && !(sanitizeProdatText(input.context.customerId) && sanitizeProdatText(input.context.customerName))) {
    issues.push({ severity: 'error', code: 'prodat_customer_identity_missing', title: 'Kundidentitet saknas', description: `${profile.key} kräver både kund-id och kundnamn.` })
  }
  if (profile.requiresMeterPoint && !sanitizeProdatText(input.context.meterPointId)) {
    issues.push({ severity: 'error', code: 'prodat_metering_point_missing', title: 'Anläggnings-id saknas', description: `${profile.key} kräver ett verkligt anläggnings-id. Placeholder tillåts inte.` })
  }
  if (profile.requiresStartDate && !sanitizeProdatText(input.context.startDate)) {
    issues.push({ severity: 'error', code: 'prodat_start_date_missing', title: 'Startdatum saknas', description: `${profile.key} kräver startdatum.` })
  }
  const endDate = sanitizeProdatText(input.context.endDate ?? input.context.permissionEndDate)
  if (profile.requiresEndDate && !endDate) {
    issues.push({ severity: 'error', code: 'prodat_end_date_missing', title: 'Slutdatum saknas', description: `${profile.key} kräver ett explicit slutdatum. Slutdatum får inte härledas eller fabriceras.` })
  }
  return { profile, issues }
}

export function listProdatProfiles(): readonly ProdatProfile[] {
  return PROFILES
}
