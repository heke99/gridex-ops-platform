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

function utiltsToken(input: ApplicationReferenceResolverInput): string {
  const code = upper(input.businessCode ?? input.messageType)
  const subtype = upper(input.transactionSubtype)
  if (code === 'E66') {
    if (subtype.includes('KVART') || subtype.includes('QUARTER') || subtype === 'T' || subtype.includes('PT15')) return 'E66-T'
    return 'E66-S'
  }
  if (code === 'E31') return 'E31-S'
  if (code === 'S02') return 'S02-S'
  if (code === 'S03') return 'S03-S'
  return code || 'UTILTS'
}

// Policy-driven Application Reference (PART 2.4 / PART 3).
//
// The Application Reference is owned by policy. A route profile may DECLARE an
// expected Application Reference (so route configuration can be validated), but a
// route profile must never OVERRIDE the policy value. The previous behaviour
// (returning `routeProfile.applicationReference` unconditionally) is removed; the
// route-declared value is now only used for mismatch detection via
// `validateRouteDeclaredApplicationReference`.
export function resolveApplicationReference(input: ApplicationReferenceResolverInput): string {
  const family = upper(input.messageFamily)
  const role = roleToken(input)

  if (family === 'PRODAT') return `23-${role}-PRODAT`
  if (family === 'UTILTS') return `23-${role}-${utiltsToken(input)}`
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

// A route profile may declare an expected Application Reference. This validates
// that the declaration agrees with policy. Mismatch must block sending; it must
// never silently win over policy.
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
