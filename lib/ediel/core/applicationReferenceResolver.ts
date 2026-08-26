import { resolveVerifiedUtiltsApplicationReference } from '@/lib/ediel/rulebook/utiltsApplicationReference'

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

const PRODAT_DDQ_CODES = new Set(['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10'])
const PRODAT_DGI_CODES = new Set(['Z13', 'Z14', 'Z15', 'Z18'])

function prodatApplicationReference(input: ApplicationReferenceResolverInput): string {
  const code = upper(input.businessCode ?? input.messageType)
  if (PRODAT_DDQ_CODES.has(code)) return '23-DDQ-PRODAT'
  if (PRODAT_DGI_CODES.has(code)) return '23-DGI-PRODAT'
  throw new Error(`prodat_application_reference_message_unsupported:${code || 'missing'}`)
}

function utiltsApplicationReference(input: ApplicationReferenceResolverInput): string {
  const code = upper(input.businessCode ?? input.messageType)
  return resolveVerifiedUtiltsApplicationReference({
    messageCode: code,
    requestedMessageCode: input.requestedMessageCode,
    applicationReference: input.routeProfile?.applicationReference ?? null,
  })
}

// Policy-driven Application Reference.
//
// No family is allowed to manufacture a fallback `23-<role>-<family>` value.
// PRODAT is selected by its verified business-code group. UTILTS is validated
// against the exact 25-A-3 field-311 registry. ACK families must echo/correlate
// the original Application Reference and therefore cannot be resolved without
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
