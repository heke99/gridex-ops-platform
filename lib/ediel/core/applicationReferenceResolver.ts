import {
  canonicalProdatApplicationReferenceForProcess,
  canonicalProdatProfileForMessage,
  canonicalVerifiedUtiltsApplicationReference,
} from '@/lib/ediel/rulebook/canonicalEdielFacade'

export type EdielCompanyRole = 'supplier' | 'energy_service_company' | 'system_supplier' | string

export type ApplicationReferenceResolverInput = {
  market?: string | null
  companyRole?: EdielCompanyRole | null
  actorRole?: string | null
  messageFamily: string
  messageType?: string | null
  businessCode?: string | null
  requestedMessageCode?: string | null
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

function prodatApplicationReference(input: ApplicationReferenceResolverInput): string {
  const code = upper(input.businessCode ?? input.messageType)
  const profile = canonicalProdatProfileForMessage(code)
  if (!profile) {
    throw new Error(`prodat_application_reference_message_unsupported:${code || 'missing'}`)
  }
  return profile.applicationReference
}

export function resolveProdatApplicationReferenceForProcess(
  businessProcess: string | null | undefined,
): string {
  const process = String(businessProcess ?? '').trim().toLowerCase()
  const reference = canonicalProdatApplicationReferenceForProcess(process)
  if (!reference) {
    throw new Error(`prodat_application_reference_process_unsupported:${process || 'missing'}`)
  }
  return reference
}

function utiltsApplicationReference(input: ApplicationReferenceResolverInput): string {
  const code = upper(input.businessCode ?? input.messageType)
  return canonicalVerifiedUtiltsApplicationReference({
    messageCode: code,
    requestedMessageCode: input.requestedMessageCode,
    applicationReference: input.routeProfile?.applicationReference ?? null,
  })
}

// Policy-driven Application Reference.
//
// No family is allowed to manufacture a fallback `23-<role>-<family>` value.
// PRODAT is resolved from its canonical message profile. UTILTS is validated
// against the exact field-311 registry. ACK families must echo/correlate the
// original Application Reference and therefore cannot be resolved without
// original-message context by this generic function.
export function resolveApplicationReference(input: ApplicationReferenceResolverInput): string {
  const family = upper(input.messageFamily)

  if (family === 'PRODAT') return prodatApplicationReference(input)
  if (family === 'UTILTS') return utiltsApplicationReference(input)
  if (family === 'APERAK' || family === 'CONTRL') {
    throw new Error(`ack_application_reference_original_required:${family}`)
  }
  throw new Error(`application_reference_family_unsupported:${family || 'missing'}`)
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
