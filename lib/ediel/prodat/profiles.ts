import type { ProdatEngineCode, ProdatEngineProductionContext, ProdatEngineValidationIssue } from '@/lib/ediel/prodat/types'
import {
  canonicalProdatSubtypeAlias,
  canonicalProdatTransactionReason,
} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {
  listCanonicalProdatRuntimeProfiles,
  resolveCanonicalProdatRuntimeProfile,
  type CanonicalProdatRuntimeProfile,
} from '@/lib/ediel/rulebook/prodatRuntimeProfileRegistry'
import {
  normalizeProdatEndUserIdQualifier,
  sanitizeProdatText,
} from '@/lib/ediel/prodat/render/segments'

function textValue(value: unknown): string {
  return typeof value === 'string' ? sanitizeProdatText(value) : ''
}

/** Compatibility type retained for existing engine/tests. Normative ownership
 * lives in rulebook/prodatRuntimeProfileRegistry. */
export type ProdatProfile = CanonicalProdatRuntimeProfile

function subtypeSource(
  code: ProdatEngineCode,
  value?: string | null,
  context?: ProdatEngineProductionContext,
): string | null {
  const explicit = String(value ?? '').trim()
  if (explicit) return explicit

  const reason = String(context?.reasonForTransaction ?? '').trim()
  if (reason) return reason

  // Z08 uses the termination reason as field-223 transaction semantics in the
  // legacy engine input. Resolve it through the same canonical subtype registry.
  if (code === 'Z08') {
    const closure = String(context?.contractClosureReason ?? '').trim()
    if (closure) return closure
  }
  return null
}

export function normalizeProdatSubtype(
  code: ProdatEngineCode,
  value?: string | null,
  context?: ProdatEngineProductionContext,
): string {
  // No message-family wildcard is a valid substitute for PRODAT business
  // subtype. Z01/Z02 must preserve L vs LK and Z10 must resolve to M/E58.
  return canonicalProdatSubtypeAlias(subtypeSource(code, value, context), code) ?? ''
}

export function resolveProdatProfile(input: {
  code: ProdatEngineCode
  subtype?: string | null
  version?: string | null
  context: ProdatEngineProductionContext
}): ProdatProfile | null {
  const subtypeOrReasonCode = subtypeSource(input.code, input.subtype, input.context)
  return resolveCanonicalProdatRuntimeProfile({
    code: input.code,
    subtypeOrReasonCode,
    version: input.version,
  })
}

export function validateProdatProfile(input: {
  code: ProdatEngineCode
  subtype?: string | null
  version?: string | null
  context: ProdatEngineProductionContext
}): { profile: ProdatProfile | null; issues: ProdatEngineValidationIssue[] } {
  const profile = resolveProdatProfile(input)
  const issues: ProdatEngineValidationIssue[] = []
  const subtype = normalizeProdatSubtype(input.code, input.subtype, input.context)

  if (!profile) {
    const source = subtypeSource(input.code, input.subtype, input.context)
    const canonicalReason = canonicalProdatTransactionReason(source, input.code)
    issues.push({
      severity: 'error',
      code: 'prodat_profile_missing',
      title: 'PRODAT-profil saknas',
      description: `Ingen canonical runtimeprofil finns för ${input.code}/${subtype || canonicalReason || 'saknad subtype'}/${input.version ?? 'saknad version'}. Affärsdata eller version får inte gissas.`,
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

  if (profile.requiresCustomerIdentity) {
    const customerId = sanitizeProdatText(input.context.customerId)
    const customerName = sanitizeProdatText(input.context.customerName)
    const customerIdQualifier = normalizeProdatEndUserIdQualifier(input.context.customerIdCodeListQualifier)

    if (!(customerId && customerName)) {
      issues.push({
        severity: 'error',
        code: 'prodat_customer_identity_missing',
        title: 'Kundidentitet saknas',
        description: `${profile.key} kräver både kund-id och kundnamn.`,
      })
    } else if (!customerIdQualifier) {
      issues.push({
        severity: 'error',
        code: 'prodat_customer_identity_qualifier_missing',
        title: 'Kundidentitetens kodlista saknas',
        description: `${profile.key} kräver en explicit giltig PRODAT-kodlista för kund-id (SE1, SE2 eller 1). Kodlistan får inte härledas från id-längd.`,
      })
    }
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
  return listCanonicalProdatRuntimeProfiles()
}
