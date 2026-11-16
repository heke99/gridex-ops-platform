export type UtiltsApplicationReferenceMessageCode =
  | 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S07'
  | 'E30' | 'E31' | 'E66'

export type UtiltsRequestMessageCode = 'E72' | 'E73' | 'E74' | 'S06'

/**
 * Exact static Application Reference values from Svenska kraftnät UTILTS 25-A-3
 * field 311. Process-type variants for S01/S05 are intentionally NOT expanded
 * here: the guide delegates their valid suffixes to the time-series-product
 * code list. Until that code list is represented by a trusted canonical
 * registry, those dynamic variants must fail closed instead of accepting an
 * arbitrary `23-...-<processType>` string.
 */
export const UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES: Readonly<
  Record<UtiltsApplicationReferenceMessageCode, readonly string[]>
> = {
  S02: ['23-DDQ-S02-S'],
  S03: ['23-DDQ-S03-S', '23-DDK-S03-S', '23-DDX-S03-S'],
  S04: ['23-DDK-S04-S'],
  E30: ['23-MDR-E30-S', '23-MDR-E30-T'],
  E31: [
    '23-DDQ-E31-S', '23-DDQ-E31-T',
    '23-DDK-E31-S', '23-DDK-E31-T',
    '23-DEA-E31-T',
    '23-DDX-E31-S', '23-DDX-E31-T',
  ],
  E66: [
    '23-DEA-E66-S', '23-DEA-E66-T',
    '23-DDQ-E66-S', '23-DDQ-E66-T',
    '23-DEC-E66-S', '23-DEC-E66-T',
    '23-DGI-E66-S', '23-DGI-E66-T',
    '23-DDK-E66-S', '23-DDK-E66-T',
    '23-PQ-E66-T',
    '23-EZ-E66-T',
  ],
  S01: ['23-DDK-S01-S', '23-DEA-S01-T'],
  S05: ['23-DDQ-S05-S'],
  S07: [
    '23-DDQ-S07-S', '23-DDQ-S07-T',
    '23-DEC-S07-S', '23-DEC-S07-T',
    '23-DDK-S07-S', '23-DDK-S07-T',
  ],
} as const

export const UTILTS_25_A_3_REQUEST_TARGETS: Readonly<Record<UtiltsRequestMessageCode, readonly UtiltsApplicationReferenceMessageCode[]>> = {
  E72: ['E30'],
  E73: ['E66', 'S02'],
  E74: ['E31', 'S03'],
  S06: ['S01', 'S04'],
} as const

function upper(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function isUtiltsRequestMessageCode(value: string | null | undefined): value is UtiltsRequestMessageCode {
  return ['E72', 'E73', 'E74', 'S06'].includes(upper(value))
}

export function isUtiltsApplicationReferenceMessageCode(
  value: string | null | undefined,
): value is UtiltsApplicationReferenceMessageCode {
  return Object.prototype.hasOwnProperty.call(UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES, upper(value))
}

/**
 * Resolve the field-311 target for a UTILTS request without heuristics.
 *
 * An explicit requestedMessageCode wins only if it is listed for the request.
 * For inbound requests the exact Application Reference is itself authoritative
 * evidence: it is matched against the target allowlists and accepted only when
 * exactly one target matches. A request with exactly one possible target (E72)
 * may resolve that target directly. Zero or multiple matches fail closed.
 */
export function getUtiltsApplicationReferenceTarget(input: {
  messageCode: string
  requestedMessageCode?: string | null
  applicationReference?: string | null
}): UtiltsApplicationReferenceMessageCode {
  const messageCode = upper(input.messageCode)

  if (isUtiltsRequestMessageCode(messageCode)) {
    const allowedTargets = UTILTS_25_A_3_REQUEST_TARGETS[messageCode]
    const requested = upper(input.requestedMessageCode)
    if (requested) {
      if (!isUtiltsApplicationReferenceMessageCode(requested) || !allowedTargets.includes(requested)) {
        throw new Error(`utilts_request_application_reference_target_invalid:${messageCode}:${requested}`)
      }
      return requested
    }

    const candidate = upper(input.applicationReference)
    if (candidate) {
      const matches = allowedTargets.filter((target) =>
        UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES[target].includes(candidate),
      )
      if (matches.length === 1) return matches[0]
      throw new Error(
        `utilts_request_application_reference_target_${matches.length === 0 ? 'invalid' : 'ambiguous'}:${messageCode}:${candidate}`,
      )
    }

    if (allowedTargets.length === 1) return allowedTargets[0]
    throw new Error(`utilts_request_application_reference_target_invalid:${messageCode}:missing`)
  }

  if (!isUtiltsApplicationReferenceMessageCode(messageCode)) {
    throw new Error(`utilts_application_reference_message_unsupported:${messageCode || 'missing'}`)
  }
  return messageCode
}

export function isStaticUtiltsApplicationReferenceAllowed(input: {
  messageCode: string
  applicationReference: string
  requestedMessageCode?: string | null
}): boolean {
  const target = getUtiltsApplicationReferenceTarget({
    ...input,
    applicationReference: input.applicationReference,
  })
  const candidate = upper(input.applicationReference)
  return UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES[target].includes(candidate)
}

/**
 * Resolve only when the answer is unambiguous from the authoritative matrix.
 *
 * - An explicit candidate is always checked against the exact allowlist.
 * - Request targets can be proven by explicit requestedMessageCode or by an
 *   exact unique field-311 allowlist match; no S/T or actor-role inference is used.
 * - A single-valued target (currently S02/S04) may be resolved without a
 *   candidate.
 * - Multi-valued targets require an explicit, already selected value.
 */
export function resolveVerifiedUtiltsApplicationReference(input: {
  messageCode: string
  requestedMessageCode?: string | null
  applicationReference?: string | null
}): string {
  const target = getUtiltsApplicationReferenceTarget({
    messageCode: input.messageCode,
    requestedMessageCode: input.requestedMessageCode,
    applicationReference: input.applicationReference,
  })
  const allowed = UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES[target]
  const candidate = upper(input.applicationReference)

  if (candidate) {
    if (!allowed.includes(candidate)) {
      throw new Error(`utilts_application_reference_not_allowed:${target}:${candidate}`)
    }
    return candidate
  }

  if (allowed.length === 1) return allowed[0]

  throw new Error(`utilts_application_reference_explicit_value_required:${target}`)
}

export function assertUtiltsApplicationReferenceRegistryConsistency(): void {
  for (const [code, values] of Object.entries(UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES)) {
    if (values.length === 0) throw new Error(`utilts_application_reference_empty_registry:${code}`)
    if (new Set(values).size !== values.length) throw new Error(`utilts_application_reference_duplicate:${code}`)
    for (const value of values) {
      if (value !== value.toUpperCase() || !value.startsWith('23-')) {
        throw new Error(`utilts_application_reference_invalid_registry_value:${code}:${value}`)
      }
    }
  }

  for (const [requestCode, targets] of Object.entries(UTILTS_25_A_3_REQUEST_TARGETS)) {
    if (targets.length === 0) throw new Error(`utilts_request_target_empty:${requestCode}`)
    for (const target of targets) {
      if (!isUtiltsApplicationReferenceMessageCode(target)) {
        throw new Error(`utilts_request_target_unknown:${requestCode}:${target}`)
      }
    }
    const references = targets.flatMap((target) =>
      UTILTS_25_A_3_STATIC_APPLICATION_REFERENCES[target].map((applicationReference) => ({ target, applicationReference })),
    )
    const duplicates = references.filter((item, index) =>
      references.findIndex((candidate) => candidate.applicationReference === item.applicationReference) !== index,
    )
    if (duplicates.length > 0) {
      throw new Error(`utilts_request_target_application_reference_ambiguous:${requestCode}:${duplicates[0].applicationReference}`)
    }
  }
}
