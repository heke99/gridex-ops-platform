export type ProdatSubtype = 'L' | 'LK' | 'C' | 'A' | 'B' | 'M' | 'D' | 'E' | 'F' | 'G' | 'H' | 'N' | 'V' | 'VH'
export type ProdatTransactionReasonCode = 'Z22' | 'Z23' | 'Z24' | 'Z26' | 'Z27' | 'E58' | 'Z70' | 'E34' | 'E64' | 'E32' | 'Z25' | 'Z96' | 'S17' | 'S18'
export type ProdatMessageCode = 'Z01' | 'Z02' | 'Z03' | 'Z04' | 'Z05' | 'Z06' | 'Z08' | 'Z09' | 'Z10' | 'Z13' | 'Z14' | 'Z15' | 'Z18'

export type ProdatSubtypeRule = {
  subtype: ProdatSubtype
  transactionReasonCode: ProdatTransactionReasonCode
  meaning: string
  allowedMessageCodes: readonly ProdatMessageCode[]
  bilateralOnlyFor?: readonly ProdatMessageCode[]
  source: {
    document: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B'
    version: '26.A'
    revision: '3'
    effectiveFrom: '2026-04-01'
    fieldNumber: '223'
    page: 122
  }
}

export type ProdatBusinessContext =
  | 'death'
  | 'bankruptcy'
  | 'identity_change'
  | 'other_masterdata'
  | 'unknown'

export type ProdatBusinessContextResolution = ProdatSubtypeResolution & {
  businessContext: ProdatBusinessContext | null
  customerStatusRequired: boolean
  bilateralReason: string | null
}

const source = {
  document: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
  version: '26.A',
  revision: '3',
  effectiveFrom: '2026-04-01',
  fieldNumber: '223',
  page: 122,
} as const

/**
 * Sole source-controlled mapping between Swedish PRODAT transaction reason
 * codes (field 223) and Gridex's compatibility subtype tokens.
 *
 * Consumers must call the helpers below instead of maintaining local alias
 * objects. This keeps parser, validator, renderer, lifecycle and UI projections
 * on exactly the same transaction semantics.
 */
export const PRODAT_SUBTYPE_RULES: readonly ProdatSubtypeRule[] = [
  { subtype: 'L',  transactionReasonCode: 'Z22', meaning: 'Change of supplier', allowedMessageCodes: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05'], source },
  { subtype: 'LK', transactionReasonCode: 'Z23', meaning: 'Change of customer and supplier', allowedMessageCodes: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z08'], bilateralOnlyFor: ['Z08'], source },
  { subtype: 'C',  transactionReasonCode: 'Z24', meaning: 'Cancellation', allowedMessageCodes: ['Z03', 'Z04', 'Z05', 'Z15'], source },
  { subtype: 'H',  transactionReasonCode: 'Z25', meaning: 'Rescission / unspecified', allowedMessageCodes: ['Z03', 'Z04', 'Z05', 'Z08'], bilateralOnlyFor: ['Z03', 'Z04', 'Z05'], source },
  // PRODAT 26.A p.65: Z26/Z04A may only be used after bilateral agreement.
  { subtype: 'A',  transactionReasonCode: 'Z26', meaning: 'Assigned/default supplier', allowedMessageCodes: ['Z04'], bilateralOnlyFor: ['Z04'], source },
  { subtype: 'D',  transactionReasonCode: 'Z70', meaning: 'Obligation to receive production', allowedMessageCodes: ['Z04', 'Z09'], source },
  { subtype: 'B',  transactionReasonCode: 'Z27', meaning: 'Change of balance responsible', allowedMessageCodes: ['Z09'], source },
  { subtype: 'N',  transactionReasonCode: 'Z96', meaning: 'Rejected reporting', allowedMessageCodes: ['Z14'], source },
  // E34 is context-sensitive. Death/bankruptcy is the normal Handbook process;
  // other Z06E/Z09E use requires counterparty-specific bilateral capability.
  // That condition is evaluated by resolveProdatBusinessContext below rather
  // than by bilateralOnlyFor, because it cannot be decided from code alone.
  { subtype: 'E',  transactionReasonCode: 'E34', meaning: 'Customer/consumer masterdata update', allowedMessageCodes: ['Z06', 'Z09'], source },
  { subtype: 'G',  transactionReasonCode: 'E32', meaning: 'Metering-point masterdata update', allowedMessageCodes: ['Z06', 'Z09'], source },
  { subtype: 'F',  transactionReasonCode: 'E64', meaning: 'Metering-point update requiring meter reading', allowedMessageCodes: ['Z06', 'Z09'], source },
  { subtype: 'M',  transactionReasonCode: 'E58', meaning: 'Meter masterdata update', allowedMessageCodes: ['Z10'], source },
  { subtype: 'V',  transactionReasonCode: 'S17', meaning: 'Start/end data sharing', allowedMessageCodes: ['Z13', 'Z14', 'Z15', 'Z18'], source },
  { subtype: 'VH', transactionReasonCode: 'S18', meaning: 'Historical metering data', allowedMessageCodes: ['Z13', 'Z14', 'Z15'], source },
] as const

export const PRODAT_TRANSACTION_REASON_CODES: readonly ProdatTransactionReasonCode[] = PRODAT_SUBTYPE_RULES.map(
  (rule) => rule.transactionReasonCode,
)

export type ProdatSubtypeResolution = {
  ok: boolean
  subtype: ProdatSubtype | null
  transactionReasonCode: ProdatTransactionReasonCode | null
  bilateralRequired: boolean
  reason: string | null
  source: ProdatSubtypeRule['source'] | null
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function stripCompositeMessageCode(value: string, messageCode?: string | null): string {
  const code = normalize(messageCode)
  if (code && value.startsWith(code) && value.length > code.length) return value.slice(code.length)
  return value
}

export function findProdatSubtypeRule(
  value: string | null | undefined,
  messageCode?: string | null,
): ProdatSubtypeRule | null {
  const normalized = stripCompositeMessageCode(normalize(value), messageCode)
  if (!normalized) return null
  return PRODAT_SUBTYPE_RULES.find(
    (candidate) => candidate.subtype === normalized || candidate.transactionReasonCode === normalized,
  ) ?? null
}

/** Normalize subtype/reason/composite tokens to the canonical compatibility subtype. */
export function canonicalProdatSubtypeAlias(
  value: string | null | undefined,
  messageCode?: string | null,
): ProdatSubtype | null {
  return findProdatSubtypeRule(value, messageCode)?.subtype ?? null
}

/** Normalize subtype/reason/composite tokens to the exact field-223 reason code. */
export function canonicalProdatTransactionReason(
  value: string | null | undefined,
  messageCode?: string | null,
): ProdatTransactionReasonCode | null {
  return findProdatSubtypeRule(value, messageCode)?.transactionReasonCode ?? null
}

export function resolveProdatSubtype(input: {
  messageCode: string | null | undefined
  subtypeOrReasonCode: string | null | undefined
  bilateralCapabilityVerified?: boolean
}): ProdatSubtypeResolution {
  const messageCode = normalize(input.messageCode) as ProdatMessageCode
  const token = stripCompositeMessageCode(normalize(input.subtypeOrReasonCode), messageCode)
  const rule = findProdatSubtypeRule(token, messageCode)

  if (!rule) {
    return { ok: false, subtype: null, transactionReasonCode: null, bilateralRequired: false, reason: `prodat_subtype_unknown:${token || 'missing'}`, source: null }
  }
  if (!rule.allowedMessageCodes.includes(messageCode)) {
    return { ok: false, subtype: rule.subtype, transactionReasonCode: rule.transactionReasonCode, bilateralRequired: false, reason: `prodat_subtype_not_allowed:${messageCode || 'missing'}:${rule.subtype}`, source: rule.source }
  }

  const bilateralRequired = Boolean(rule.bilateralOnlyFor?.includes(messageCode))
  if (bilateralRequired && input.bilateralCapabilityVerified !== true) {
    return { ok: false, subtype: rule.subtype, transactionReasonCode: rule.transactionReasonCode, bilateralRequired: true, reason: `prodat_bilateral_capability_required:${messageCode}:${rule.subtype}`, source: rule.source }
  }

  return { ok: true, subtype: rule.subtype, transactionReasonCode: rule.transactionReasonCode, bilateralRequired, reason: null, source: rule.source }
}

/**
 * Evaluate business-context conditions that cannot be inferred from field 223.
 *
 * Handbook 26A chapter 4.4 and PRODAT 26.A p.65:
 * - Z06E/Z09E are normally used for death/bankruptcy and require customer status.
 * - Other customer-identity/masterdata purposes require a bilateral agreement
 *   with the exact counterparty. A bilateral flag for one actor must never
 *   authorize another actor.
 */
export function resolveProdatBusinessContext(input: {
  messageCode: string | null | undefined
  subtypeOrReasonCode: string | null | undefined
  businessContext?: ProdatBusinessContext | null
  bilateralCapabilityVerified?: boolean
}): ProdatBusinessContextResolution {
  const base = resolveProdatSubtype({
    messageCode: input.messageCode,
    subtypeOrReasonCode: input.subtypeOrReasonCode,
    bilateralCapabilityVerified: input.bilateralCapabilityVerified,
  })
  const businessContext = input.businessContext ?? null
  if (!base.ok) {
    return { ...base, businessContext, customerStatusRequired: false, bilateralReason: null }
  }

  const code = normalize(input.messageCode)
  if (base.subtype !== 'E' || !['Z06', 'Z09'].includes(code)) {
    return { ...base, businessContext, customerStatusRequired: false, bilateralReason: null }
  }

  const normalDeathProcess = businessContext === 'death' || businessContext === 'bankruptcy'
  if (normalDeathProcess) {
    return {
      ...base,
      bilateralRequired: false,
      businessContext,
      customerStatusRequired: true,
      bilateralReason: null,
    }
  }

  if (input.bilateralCapabilityVerified === true) {
    return {
      ...base,
      bilateralRequired: true,
      businessContext,
      customerStatusRequired: false,
      bilateralReason: 'e34_non_death_masterdata_bilateral',
    }
  }

  return {
    ...base,
    ok: false,
    bilateralRequired: true,
    reason: `prodat_e34_business_context_or_bilateral_required:${code}`,
    businessContext,
    customerStatusRequired: false,
    bilateralReason: 'e34_non_death_masterdata_bilateral',
  }
}

export function allowedProdatSubtypes(messageCode: string | null | undefined): readonly ProdatSubtypeRule[] {
  const code = normalize(messageCode) as ProdatMessageCode
  return PRODAT_SUBTYPE_RULES.filter((rule) => rule.allowedMessageCodes.includes(code))
}

export function assertProdatSubtypeRegistryConsistency(): void {
  const subtypes = new Set<string>()
  const reasons = new Set<string>()
  for (const rule of PRODAT_SUBTYPE_RULES) {
    if (subtypes.has(rule.subtype)) throw new Error(`prodat_subtype_duplicate:${rule.subtype}`)
    if (reasons.has(rule.transactionReasonCode)) throw new Error(`prodat_reason_code_duplicate:${rule.transactionReasonCode}`)
    subtypes.add(rule.subtype)
    reasons.add(rule.transactionReasonCode)
  }
  if (PRODAT_SUBTYPE_RULES.find((rule) => rule.subtype === 'E')?.transactionReasonCode !== 'E34') {
    throw new Error('prodat_subtype_e_must_be_e34')
  }
}
