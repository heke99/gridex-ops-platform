import { listCanonicalAckMatrix } from '@/lib/ediel/ack/canonicalAckEngine'
import { PRODAT_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/prodatRulebook'
import { PRODAT_SUBTYPE_RULES } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

export type RulebookCodeListRule = {
  codeList: string
  values: string[]
  description: string
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

const prodatMessageCodes = PRODAT_CANONICAL_PROFILES.map((profile) => profile.messageCode)
const permissionCodes = new Set(
  PRODAT_CANONICAL_PROFILES
    .filter((profile) => profile.processGroup === 'metering_access')
    .map((profile) => profile.messageCode),
)

const permissionSubtypeRules = PRODAT_SUBTYPE_RULES.filter((rule) =>
  rule.allowedMessageCodes.some((code) => permissionCodes.has(code)),
)
const supplierSubtypeRules = PRODAT_SUBTYPE_RULES.filter((rule) =>
  rule.allowedMessageCodes.some((code) => !permissionCodes.has(code)),
)

const ackFamilies = unique(
  listCanonicalAckMatrix()
    .map((rule) => rule.family)
    .filter((family) => family !== 'PRODAT' && family !== 'UTILTS'),
)

/** UI/test compatibility code lists projected from canonical Ediel registries. */
export const STATIC_CODE_RULES: RulebookCodeListRule[] = [
  { codeList: 'PRODAT_MESSAGE_CODES', values: unique(prodatMessageCodes), description: 'Svenska PRODAT-funktioner.' },
  { codeList: 'PRODAT_SUPPLIER_SUBTYPES', values: unique(supplierSubtypeRules.flatMap((rule) => [rule.subtype, rule.transactionReasonCode])), description: 'Leverantörs-/grunddataflöden.' },
  { codeList: 'PRODAT_PERMISSION_SUBTYPES', values: unique(permissionSubtypeRules.flatMap((rule) => [rule.subtype, rule.transactionReasonCode])), description: 'Mätvärdesåtkomst/berättigad part.' },
  { codeList: 'ACK_FAMILIES', values: ackFamilies, description: 'Kvittenstyper.' },
  { codeList: 'AI_BI_FORMATS', values: ['skv', 'csv', 'Ver20140401'], description: 'AI/BI-listor; csv efter 2025-10-01 men fortsatt semikolonseparerat.' },
]

export function allowedValuesForCodeList(codeList: string): string[] {
  return STATIC_CODE_RULES.find((rule) => rule.codeList === codeList)?.values ?? []
}
