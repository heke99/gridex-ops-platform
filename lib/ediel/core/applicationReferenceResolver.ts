import { resolveCanonicalUtiltsApplicationReference } from '@/lib/ediel/rulebook/utiltsMarketEngine'

export type EdielCompanyRole = 'supplier' | 'energy_service_company' | 'system_supplier' | string

export type ApplicationReferenceResolverInput = {
  market?: string | null
  companyRole?: EdielCompanyRole | null
  actorRole?: string | null
  messageFamily: string
  messageType?: string | null
  businessCode?: string | null
  transactionSubtype?: string | null
  environment?: string | null
  sender?: string | null
  receiver?: string | null
  routeProfile?: {
    applicationReference?: string | null
    actorRole?: string | null
    companyRole?: string | null
  } | null
}

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function roleToken(input: ApplicationReferenceResolverInput): string {
  const role = upper(input.actorRole ?? input.routeProfile?.actorRole ?? input.companyRole ?? input.routeProfile?.companyRole)
  if (role === 'DGI' || role.includes('ENERGY_SERVICE') || role.includes('ENERGITJANST')) return 'DGI'
  return 'DDQ'
}

function utiltsResolution(input: ApplicationReferenceResolverInput): string | null {
  const subtype = upper(input.transactionSubtype)
  if (subtype.includes('KVART') || subtype.includes('QUARTER') || subtype === 'T' || subtype.includes('PT15')) return 'quarter_hour'
  if (subtype.includes('HOUR') || subtype.includes('PT60')) return 'hourly'
  if (subtype.includes('DAY') || subtype.includes('P1D')) return 'daily'
  return subtype || null
}

function utiltsApplicationReference(input: ApplicationReferenceResolverInput): string {
  const code = upper(input.businessCode ?? input.messageType)
  // E73 does not identify itself in Application Reference: it identifies the
  // requested S02/E66 application. The generic resolver therefore cannot safely
  // derive it; the dedicated E73 market flow must supply it explicitly.
  if (code === 'E73') throw new Error('utilts_e73_requested_message_required')

  if (['E66', 'E31', 'S02', 'S03'].includes(code)) {
    return resolveCanonicalUtiltsApplicationReference({
      code,
      actorRole: input.actorRole ?? input.routeProfile?.actorRole ?? input.companyRole ?? input.routeProfile?.companyRole,
      resolution: utiltsResolution(input),
    })
  }

  // Other UTILTS families are not approved generic supplier-outbound paths.
  // Failing closed prevents a fabricated `23-DDQ-UTILTS` or `23-DDQ-<code>`
  // from escaping simply because a route exists.
  throw new Error(`utilts_application_reference_unsupported:${code || 'missing'}`)
}

// Policy-driven Application Reference.
// A route profile may declare an expected value but never override policy.
export function resolveApplicationReference(input: ApplicationReferenceResolverInput): string {
  const family = upper(input.messageFamily)
  const role = roleToken(input)

  if (family === 'PRODAT') return `23-${role}-PRODAT`
  if (family === 'UTILTS') return utiltsApplicationReference(input)
  if (family === 'APERAK') return `23-${role}-APERAK`
  if (family === 'CONTRL') return `23-${role}-CONTRL`
  return `23-${role}-${family || 'EDIEL'}`
}

export type RouteDeclaredApplicationReferenceCheck = {
  ok: boolean
  policyApplicationReference: string
  routeDeclaredApplicationReference: string | null
  reason: string | null
}

export function validateRouteDeclaredApplicationReference(
  input: ApplicationReferenceResolverInput,
): RouteDeclaredApplicationReferenceCheck {
  const policyValue = resolveApplicationReference(input)
  const declared = input.routeProfile?.applicationReference?.trim() || null
  if (!declared) {
    return { ok: true, policyApplicationReference: policyValue, routeDeclaredApplicationReference: null, reason: null }
  }
  const ok = declared.toUpperCase() === policyValue.toUpperCase()
  return {
    ok,
    policyApplicationReference: policyValue,
    routeDeclaredApplicationReference: declared,
    reason: ok
      ? null
      : `Route profile declarerar Application Reference ${declared} men policy kräver ${policyValue}. Route får inte åsidosätta policy.`,
  }
}
