import { canonicalProdatSubtypeAlias } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import { PRODAT_26A_FIELD_MATRIX, PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { renderProdatDateField, prodatDateExcludedBySubtype } from '@/lib/ediel/prodat/prodatDateFields'
import { prodatNowDate203 } from '@/lib/ediel/prodat/render/dates'

/** Explicit business meanings. Legacy start/end aliases are resolved only at
 * the API boundary, by message function; they never become parser fallbacks. */
export type ProdatDateInputs = {
  messageDate?: string | null
  timezoneOffset?: string | null
  contractStartDate?: string | null
  contractEndDate?: string | null
  validityStartDate?: string | null
  firstMeterReadingDate?: string | null
  birthDate?: string | null
  reportStartDate?: string | null
  reportEndDate?: string | null
  permissionTimestamp?: string | null
  permissionEndDate?: string | null
  observationLength?: string | null
  observationLengthFormat?: string | null
}
const keys: Readonly<Record<string, keyof ProdatDateInputs>> = {
  '205':'messageDate', '206':'timezoneOffset', '210':'contractStartDate', '211':'contractEndDate',
  '216':'validityStartDate', '212':'firstMeterReadingDate', '249':'birthDate', '302':'reportStartDate',
  '321':'reportEndDate', '326':'permissionTimestamp', '327':'permissionEndDate', '508':'observationLength',
}

/** The first own, defined alias is authoritative, including explicit null.
 * Only absence/undefined permits a lower-priority alias or source fallback. */
function pick(source: Readonly<Record<string, unknown>> | null | undefined, names: readonly string[]): string | null | undefined {
  for (const name of names) {
    if (!source || !Object.prototype.hasOwnProperty.call(source, name)) continue
    const value = source[name]
    if (value === undefined) continue
    if (value === null) return null
    if (typeof value !== 'string') throw new Error(`prodat_date_input_invalid:${name}`)
    return value
  }
  return undefined
}

/** Preserve documented legacy API aliases within their own message function.
 * Snapshot values, when present, are never repaired using fallback metadata. */
export function resolveProdatDateInputs(code: string, variant: string | null | undefined,
  source: Readonly<Record<string, unknown>>, snapshot?: Readonly<Record<string, unknown>> | null): ProdatDateInputs {
  variant = canonicalProdatSubtypeAlias(variant, code)
  const get = (names: string[]) => {
    const value = pick(snapshot, names)
    return value !== undefined ? value : pick(source, names)
  }
  const report = code === 'Z13' || code === 'Z14'
  const validity = code === 'Z06' || code === 'Z10' || (code === 'Z09' && variant !== 'D')
  const contractStart = ['Z01','Z03','Z04'].includes(code) || (code === 'Z09' && variant === 'D')
  return {
    messageDate: get(['messageDate','createdAt']), timezoneOffset: get(['timezoneOffset']),
    contractStartDate: get(['contractStartDate','agreementStartDateTime', ...(contractStart ? ['startDate','requestedStartDate'] : [])]),
    contractEndDate: get(['contractEndDate','agreementEndDateTime','endDate']),
    validityStartDate: get(['validityStartDate', ...(validity ? ['startDate'] : [])]),
    firstMeterReadingDate: get(['firstMeterReadingDate']), birthDate: get(['birthDate']),
    reportStartDate: get(['reportStartDate','reportStartDateTime', ...(report ? ['startDate'] : [])]),
    // The legacy permission API called approved reporting end permissionEndDate.
    // This alias applies only to Z13/Z14, never to contractual closure (93).
    reportEndDate: get(['reportEndDate','reportEndDateTime', ...(report ? ['permissionEndDate'] : [])]),
    permissionTimestamp: get(['permissionTimestamp']), permissionEndDate: get(['permissionEndDate','permissionEndTimestamp']),
    observationLength: get(['observationLength']), observationLengthFormat: get(['observationLengthFormat']),
  }
}

/** All date segments are built once: P header205/206, then SG8 object dates.
 * National D requirements remain in the condition engine; omission is not proof
 * that a conditional/required field has been satisfied. */
export function buildProdatDateSegments(code: string, variant: string | null | undefined, input: ProdatDateInputs, now?: Date): { header: string[]; line: string[] } {
  variant = canonicalProdatSubtypeAlias(variant, code)
  const codeIndex = PRODAT_26A_MESSAGE_CODES.findIndex(value => value === code)
  if (codeIndex < 0) throw new Error('prodat_date_unknown_message')
  const values: ProdatDateInputs = { ...input, messageDate: input.messageDate ?? prodatNowDate203(now), timezoneOffset: input.timezoneOffset ?? '1' }
  const header: string[] = [], line: string[] = []
  for (const field of PRODAT_26A_FIELD_MATRIX.filter(row => row.dateQualifier)) {
    if (field.requirements[codeIndex] === '-') continue
    if (prodatDateExcludedBySubtype(code, variant, field.fieldNumber)) continue
    const segment = renderProdatDateField(field.fieldNumber, values[keys[field.fieldNumber]], values.observationLengthFormat ?? undefined)
    if (segment) (field.dateScope === 'header' ? header : line).push(segment)
  }
  if (code === 'Z09' && variant === 'D' && input.contractStartDate != null && input.contractEndDate != null) {
    throw new Error('prodat_date_z09d_contract_start_end_exclusive')
  }
  return { header, line }
}
