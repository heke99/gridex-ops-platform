import {
  PRODAT_26A_FIELD_MATRIX,
  PRODAT_26A_MESSAGE_CODES,
  type Prodat26AMessageCode,
} from '@/lib/ediel/prodat/prodat26AFieldMatrix'

export const PRODAT_26A_DEPENDENT_SOURCE_DOCUMENT =
  '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B' as const

export const PRODAT_26A_DEPENDENT_EVIDENCE_PROJECTION =
  'supabase/migrations/20260530190000_import_prodat_26a_field_matrix.sql' as const

export type ProdatDependentConditionStatus = 'required' | 'not_required' | 'undetermined'

export type ProdatDependentConditionFacts = {
  /** Canonical subtype, never a raw alias/reason code. */
  canonicalSubtype?: string | null
  /** Canonical business context from prodatSubtypeRegistry. */
  businessContext?: string | null
  market?: 'electricity' | 'gas' | null
  customerKind?: 'private' | 'business' | null
  meterReadingsSentInUtilts?: boolean | null
  multipleMeterRegisters?: boolean | null
  endUserAddressAvailable?: boolean | null
  invoiceeAddressDiffersFromEndUser?: boolean | null
  /**
   * Explicit source-backed facts for D conditions that cannot be derived from the
   * canonical protocol/business context above. Missing values are deliberately
   * undetermined; callers are never allowed to infer a value from field presence.
   */
  byCell?: Readonly<Record<string, boolean | null | undefined>>
}

export type ProdatDependentConditionSource = {
  document: typeof PRODAT_26A_DEPENDENT_SOURCE_DOCUMENT
  section: string
  evidenceProjection: typeof PRODAT_26A_DEPENDENT_EVIDENCE_PROJECTION
  note: string
}

export type ProdatDependentConditionEvaluation = {
  id: string
  messageCode: Prodat26AMessageCode
  fieldNumber: string
  conditionId: string
  status: ProdatDependentConditionStatus
  source: ProdatDependentConditionSource
}

type PredicateContext = {
  messageCode: Prodat26AMessageCode
  fieldNumber: string
  id: string
  facts: ProdatDependentConditionFacts
}

type ConditionGroup = {
  fieldNumber: string
  messageCodes: readonly Prodat26AMessageCode[]
  conditionId: string
  note: string
  predicate: (context: PredicateContext) => boolean | null
}

function cellId(messageCode: Prodat26AMessageCode, fieldNumber: string): string {
  return `${messageCode}:${fieldNumber}`
}

function booleanFact(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalized(value: string | null | undefined): string | null {
  const result = String(value ?? '').trim().toUpperCase()
  return result || null
}

function explicitCellFact(context: PredicateContext): boolean | null {
  return booleanFact(context.facts.byCell?.[context.id])
}

function subtypeIs(expected: string) {
  return (context: PredicateContext): boolean | null => {
    const subtype = normalized(context.facts.canonicalSubtype)
    return subtype ? subtype === expected.toUpperCase() : null
  }
}

function subtypeIsNot(expected: string) {
  return (context: PredicateContext): boolean | null => {
    const subtype = normalized(context.facts.canonicalSubtype)
    return subtype ? subtype !== expected.toUpperCase() : null
  }
}

function businessContextIs(expected: string) {
  return (context: PredicateContext): boolean | null => {
    const businessContext = normalized(context.facts.businessContext)
    return businessContext ? businessContext === expected.toUpperCase() : null
  }
}

function marketIs(expected: 'electricity' | 'gas') {
  return (context: PredicateContext): boolean | null => {
    const market = context.facts.market ?? null
    return market ? market === expected : null
  }
}

function privateCustomerExceptZ14N(context: PredicateContext): boolean | null {
  if (context.messageCode === 'Z14') {
    const subtype = normalized(context.facts.canonicalSubtype)
    if (!subtype) return null
    if (subtype === 'N') return false
  }
  const kind = context.facts.customerKind ?? null
  return kind ? kind === 'private' : null
}

const GROUPS: readonly ConditionGroup[] = [
  { fieldNumber: '209', messageCodes: ['Z14'], conditionId: 'z14_except_n', note: 'Skickas i Z14 utom Z14N.', predicate: subtypeIsNot('N') },
  { fieldNumber: '258', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'multiple_meter_registers', note: 'Obligatorisk för anläggningar/mätare med flera register.', predicate: ({ facts }) => booleanFact(facts.multipleMeterRegisters) },
  { fieldNumber: '210', messageCodes: ['Z06', 'Z09', 'Z10'], conditionId: 'contract_start_date_business_rule', note: 'Giltigt startdatum enligt Handboken.', predicate: explicitCellFact },
  { fieldNumber: '211', messageCodes: ['Z09'], conditionId: 'contract_stop_date_business_rule', note: 'Giltigt slutdatum enligt Handboken.', predicate: explicitCellFact },
  { fieldNumber: '302', messageCodes: ['Z14'], conditionId: 'report_start_timestamp_business_rule', note: 'Tidstämpel för påbörjande av rapportering.', predicate: explicitCellFact },
  { fieldNumber: '321', messageCodes: ['Z13', 'Z14'], conditionId: 'report_end_timestamp_business_rule', note: 'Tidstämpel för avslutande av rapportering.', predicate: explicitCellFact },
  { fieldNumber: '216', messageCodes: ['Z09'], conditionId: 'validity_start_business_rule', note: 'Datum när aktuell ändring börjar gälla.', predicate: explicitCellFact },
  { fieldNumber: '508', messageCodes: ['Z06', 'Z14'], conditionId: 'observation_length_business_rule', note: 'Kvart/tim/månad/år.', predicate: explicitCellFact },
  { fieldNumber: '326', messageCodes: ['Z14'], conditionId: 'z14_except_n', note: 'Skickas i Z14 utom Z14N.', predicate: subtypeIsNot('N') },
  { fieldNumber: '214', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'meter_readings_sent_in_utilts', note: 'Obligatorisk om mätarställningar skickas i UTILTS.', predicate: ({ facts }) => booleanFact(facts.meterReadingsSentInUtilts) },
  { fieldNumber: '217', messageCodes: ['Z06', 'Z09', 'Z14'], conditionId: 'measure_method_business_rule', note: 'Kvartsvis/timvis/månadsvis/årsvis mätning.', predicate: explicitCellFact },
  { fieldNumber: '218', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'meter_readings_sent_in_utilts', note: 'Obligatorisk om mätarställningar skickas.', predicate: ({ facts }) => booleanFact(facts.meterReadingsSentInUtilts) },
  { fieldNumber: '306', messageCodes: ['Z06'], conditionId: 'installation_status_business_rule', note: 'Aktiv eller ej inkopplad.', predicate: explicitCellFact },
  { fieldNumber: '222', messageCodes: ['Z14'], conditionId: 'reporting_frequency_business_rule', note: 'Hur ofta rapportering sker.', predicate: explicitCellFact },
  { fieldNumber: '259', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'meter_time_frame_business_rule', note: 'Räkneverkskod.', predicate: explicitCellFact },
  { fieldNumber: '254', messageCodes: ['Z06', 'Z10'], conditionId: 'balance_settlement_method_business_rule', note: 'Dygns-/månadsavräkning.', predicate: explicitCellFact },
  { fieldNumber: '242', messageCodes: ['Z06', 'Z10'], conditionId: 'product_code_business_rule', note: 'Tidsserieprodukt.', predicate: explicitCellFact },
  { fieldNumber: '506', messageCodes: ['Z14'], conditionId: 'energy_product_business_rule', note: 'Energiprodukt.', predicate: explicitCellFact },
  { fieldNumber: '310', messageCodes: ['Z05', 'Z06', 'Z09'], conditionId: 'death_context_only', note: 'Används endast i anslutning till dödsfall.', predicate: businessContextIs('death') },
  { fieldNumber: '513', messageCodes: ['Z14'], conditionId: 'installation_direction_business_rule', note: 'Flödesriktning vid mätpunkten.', predicate: explicitCellFact },
  { fieldNumber: '323', messageCodes: ['Z13', 'Z14'], conditionId: 'private_customer_except_z14n', note: 'Ska anges för privatkunder i Z13/Z14, utom Z14N.', predicate: privateCustomerExceptZ14N },
  { fieldNumber: '260', messageCodes: ['Z14'], conditionId: 'net_area_business_rule', note: '3-ställig nätområdeskod.', predicate: explicitCellFact },
  { fieldNumber: '320', messageCodes: ['Z04', 'Z06'], conditionId: 'gas_market_only', note: 'Endast naturgasmarknaden.', predicate: marketIs('gas') },
  { fieldNumber: '240', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'gas_market_only', note: 'Endast naturgasmarknaden.', predicate: marketIs('gas') },
  { fieldNumber: '319', messageCodes: ['Z04'], conditionId: 'z04d_only', note: 'Obligatorisk i Z04D.', predicate: subtypeIs('D') },
  { fieldNumber: '325', messageCodes: ['Z14'], conditionId: 'z14_except_n', note: 'Tillståndets id skickas ej i Z14N.', predicate: subtypeIsNot('N') },
  { fieldNumber: 'END_USER_GROUP', messageCodes: ['Z06', 'Z09', 'Z14'], conditionId: 'end_user_group_business_rule', note: 'Elanvändare.', predicate: explicitCellFact },
  { fieldNumber: '227', messageCodes: ['Z06', 'Z09', 'Z14'], conditionId: 'end_user_id_business_rule', note: 'Kund-id.', predicate: explicitCellFact },
  { fieldNumber: '228', messageCodes: ['Z06', 'Z09', 'Z14'], conditionId: 'end_user_name_business_rule', note: '1-2 rader.', predicate: explicitCellFact },
  { fieldNumber: '229', messageCodes: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'end_user_address_available', note: 'När elanvändaren anges ska adress fyllas i om den finns.', predicate: ({ facts }) => booleanFact(facts.endUserAddressAvailable) },
  { fieldNumber: '231', messageCodes: ['Z06', 'Z09'], conditionId: 'end_user_postcode_business_rule', note: 'Postnummer.', predicate: explicitCellFact },
  { fieldNumber: '232', messageCodes: ['Z06', 'Z09'], conditionId: 'end_user_city_business_rule', note: 'Postort.', predicate: explicitCellFact },
  { fieldNumber: '316', messageCodes: ['Z06', 'Z09'], conditionId: 'end_user_country_business_rule', note: 'Land.', predicate: explicitCellFact },
  { fieldNumber: 'INSTALLATION_GROUP', messageCodes: ['Z14'], conditionId: 'installation_group_business_rule', note: 'Anläggningsadress.', predicate: explicitCellFact },
  { fieldNumber: '233', messageCodes: ['Z01', 'Z03', 'Z08'], conditionId: 'installation_id_business_rule', note: 'Samma värde som fält 209.', predicate: explicitCellFact },
  { fieldNumber: '234', messageCodes: ['Z01', 'Z03', 'Z08'], conditionId: 'installation_address_business_rule', note: '1-3 rader.', predicate: explicitCellFact },
  { fieldNumber: 'INVOICEE_GROUP', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: 'Skickas om fakturamottagarens adress skiljer sig från elanvändarens.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
  { fieldNumber: '250', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: 'När fakturamottagare skickas anges id.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
  { fieldNumber: '251', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: '1-2 rader.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
  { fieldNumber: '252', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: 'Adress fakturamottagare.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
  { fieldNumber: '253', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: 'Postnummer fakturamottagare.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
  { fieldNumber: '317', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: 'Postort fakturamottagare.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
  { fieldNumber: '318', messageCodes: ['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09'], conditionId: 'invoicee_address_differs', note: 'Land fakturamottagare.', predicate: ({ facts }) => booleanFact(facts.invoiceeAddressDiffersFromEndUser) },
] as const

export const PRODAT_26A_DEPENDENT_CONDITION_REGISTRY = GROUPS.flatMap((group) =>
  group.messageCodes.map((messageCode) => ({
    id: cellId(messageCode, group.fieldNumber),
    messageCode,
    fieldNumber: group.fieldNumber,
    conditionId: group.conditionId,
    source: {
      document: PRODAT_26A_DEPENDENT_SOURCE_DOCUMENT,
      section: `PRODAT 26-A field matrix: ${messageCode} / field ${group.fieldNumber} / D`,
      evidenceProjection: PRODAT_26A_DEPENDENT_EVIDENCE_PROJECTION,
      note: group.note,
    },
    predicate: group.predicate,
  })),
)

function matrixDependentCellIds(): string[] {
  const result: string[] = []
  for (const row of PRODAT_26A_FIELD_MATRIX) {
    for (const [index, requirement] of row.requirements.entries()) {
      if (requirement !== 'D') continue
      const messageCode = PRODAT_26A_MESSAGE_CODES[index]
      if (messageCode) result.push(cellId(messageCode, row.fieldNumber))
    }
  }
  return result.sort()
}

export function assertCanonicalProdatDependentConditionCoverage(): void {
  const expected = matrixDependentCellIds()
  const actual = PRODAT_26A_DEPENDENT_CONDITION_REGISTRY.map((entry) => entry.id).sort()
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index)
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const missing = expected.filter((id) => !actualSet.has(id))
  const extra = actual.filter((id) => !expectedSet.has(id))

  if (duplicates.length || missing.length || extra.length || actual.length !== expected.length) {
    throw new Error(
      `prodat_26a_dependent_condition_coverage_mismatch:expected=${expected.length}:actual=${actual.length}:missing=${missing.join(',') || '-'}:extra=${extra.join(',') || '-'}:duplicates=${[...new Set(duplicates)].join(',') || '-'}`,
    )
  }
}

export function evaluateProdatDependentConditions(input: {
  messageCode: string
  facts?: ProdatDependentConditionFacts | null
}): ProdatDependentConditionEvaluation[] {
  const messageCode = String(input.messageCode ?? '').trim().toUpperCase() as Prodat26AMessageCode
  const facts = input.facts ?? {}
  return PRODAT_26A_DEPENDENT_CONDITION_REGISTRY
    .filter((entry) => entry.messageCode === messageCode)
    .map((entry) => {
      const value = entry.predicate({
        messageCode: entry.messageCode,
        fieldNumber: entry.fieldNumber,
        id: entry.id,
        facts,
      })
      return {
        id: entry.id,
        messageCode: entry.messageCode,
        fieldNumber: entry.fieldNumber,
        conditionId: entry.conditionId,
        status: value === null ? 'undetermined' : value ? 'required' : 'not_required',
        source: entry.source,
      }
    })
}

export function assertProdatDependentConditionsDetermined(
  evaluations: readonly ProdatDependentConditionEvaluation[],
): void {
  const undetermined = evaluations.filter((entry) => entry.status === 'undetermined')
  if (undetermined.length > 0) {
    throw new Error(`prodat_dependent_condition_undetermined:${undetermined.map((entry) => entry.id).join(',')}`)
  }
}

export function resolveProdatDependentCondition(input: {
  messageCode: string
  fieldNumber: string
  facts?: ProdatDependentConditionFacts | null
}): ProdatDependentConditionEvaluation | null {
  return evaluateProdatDependentConditions({ messageCode: input.messageCode, facts: input.facts })
    .find((entry) => entry.fieldNumber === input.fieldNumber) ?? null
}

// Fail immediately in any runtime/build path that imports the canonical engine if
// the independently maintained executable registry drifts from the official D cells.
assertCanonicalProdatDependentConditionCoverage()
