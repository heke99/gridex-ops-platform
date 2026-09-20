import type {GasReportingIdentitySelection} from './prodatGasReportingIdentity'
import {gasAggregate,gasStatus,isGasApplicabilityField,type GasSerialChangeSelection} from './prodatGasApplicability'
import {deathAggregate,isDeathStatusField,type DeathSelection} from './prodatDeathStatus'
import {isMeterChangeField,meterChangeAggregate,type MeterChangeSelection} from './prodatMeterChangeFacts'
import {isReportingPermissionField,type ReportingSelection} from './prodatReportingPermissionContext'
import {isProdatDateEventField,type ProdatDateEventObject,type ProdatDateEventSource} from './prodatDateEvents'
import type {ProdatInvoiceeObject} from './prodatInvoicee'
import type {ProdatEndUserAddressObject} from './prodatEndUserAddress'
import {
  PRODAT_26A_FIELD_MATRIX,
  PRODAT_26A_MESSAGE_CODES,
  type Prodat26AMessageCode,
} from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatSourceSubtypeRule, resolveProdatSourceSubtypeRequirement, type ProdatSubtypeRequirement } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import { isProdatReadingField } from './prodatRegisterReadings'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'

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
  /** Explicit per-object evidence. When supplied, missing/duplicate identities
   * do not borrow a message-wide fact. No count is inferred from field presence. */
  registerObjects?: readonly {
    meteringPointId: string
    identityAgency: '9' | '89'
    expectedRegisterCount?: number | null
    meterReadingsSentInUtilts?: boolean | null
  }[]
  endUserAddressObjects?: readonly ProdatEndUserAddressObject[]
  /** Legacy descriptive pre-wire hint only; outbound229 requires per-object source facts. */
  endUserAddressAvailable?: boolean | null
  gasSerialChange?: GasSerialChangeSelection | null
  gasReportingIdentity?: GasReportingIdentitySelection | null
  deathStatus?: DeathSelection | null
  meterChange?: MeterChangeSelection | null
  reportingPermission?: ReportingSelection | null
  dateEventObjects?: readonly ProdatDateEventObject[]
  dateEventSource?: ProdatDateEventSource
  invoiceeObjects?: readonly ProdatInvoiceeObject[]
  /** Legacy descriptive hint; never outbound IV evidence. */
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
  /** A wire-parent condition may use not_required as its pre-wire default. That
   * means there is no blanket child requirement; it is not evidence that every
   * object lacks the optional parent. Render/validation must decide per wire. */
  status: ProdatDependentConditionStatus
  decisionPhase?: 'pre_wire_parent' | 'rendered_wire_parent' | 'pre_wire_inventory_aggregate' | 'rendered_wire_inventory' | 'pre_wire_readings_aggregate' | 'rendered_wire_readings' | 'legacy_pre_wire_address_hint' | 'rendered_wire_address' | 'rendered_wire_invoicee' | 'rendered_wire_date_event' | 'rendered_wire_meter_change' | 'rendered_wire_death_status' | 'rendered_wire_gas'
  /** Present only for source-migrated cells; not_required alone does not mean optional. */
  requirement?: ProdatSubtypeRequirement
  source: ProdatDependentConditionSource
}

type PredicateContext = {
  messageCode: Prodat26AMessageCode
  fieldNumber: string
  id: string
  facts: ProdatDependentConditionFacts
}

/** Pre-wire knowledge only: no root boolean/subtype can certify another
 * object's outgoing readings. Rendered decisions use the actual own reason. */
function registerReadingFirstPredicate(context: PredicateContext): boolean | null {
  const objects = context.facts.registerObjects
  if (!objects?.length) return null
  const identities = new Set<string>()
  let readings = false
  for (const object of objects) {
    const key = JSON.stringify([object.meteringPointId, object.identityAgency])
    if (!object.meteringPointId || !['9', '89'].includes(object.identityAgency) || identities.has(key)
      || typeof object.meterReadingsSentInUtilts !== 'boolean') return null
    identities.add(key)
    readings ||= object.meterReadingsSentInUtilts
  }
  return readings
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

/** Field 258 describes physical inventory, so rendered LIN cardinality, a root
 * boolean and byCell statuses are not evidence. Message-level diagnostics can
 * say whether any independently inventoried object is multiple; exact per-object
 * enforcement remains in prodatRegisterPolicy where wire identity is available. */
function independentRegisterInventory(context: PredicateContext): boolean | null {
  const objects = context.facts.registerObjects
  if (!objects?.length) return null
  const seen = new Set<string>()
  let multiple = false
  for (const object of objects) {
    const id = object.meteringPointId
    const count = object.expectedRegisterCount
    const identity = JSON.stringify([id, object.identityAgency])
    if (!id || !['9', '89'].includes(object.identityAgency) || seen.has(identity)
      || !Number.isInteger(count) || (count as number) < 1 || (count as number) > 999999) return null
    seen.add(identity)
    if ((count as number) > 1) multiple = true
  }
  return multiple
}

/** The Z01/Z03/Z08 IT parent is optional until selected per wire object. A
 * message/root byCell flag cannot select it. The bounded wire-parent validator
 * and renderer diagnostics replace this default when an object emits NAD+IT. */
function optionalInstallationWireParent(): false {
  return false
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



function gasPredicate(context:PredicateContext):boolean|null {
  const requirement=gasAggregate(context.messageCode,context.fieldNumber,context.facts.market,context.facts.canonicalSubtype,context.facts.gasSerialChange)
  return requirement==='undetermined'?null:requirement==='required'
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
  { fieldNumber: '258', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'multiple_meter_registers', note: 'Obligatorisk för anläggningar/mätare med flera register.', predicate: independentRegisterInventory },
  { fieldNumber: '210', messageCodes: ['Z06', 'Z09', 'Z10'], conditionId: 'contract_start_date_business_rule', note: 'Giltigt startdatum enligt Handboken.', predicate: explicitCellFact },
  { fieldNumber: '211', messageCodes: ['Z09'], conditionId: 'contract_stop_date_business_rule', note: 'Giltigt slutdatum enligt Handboken.', predicate: explicitCellFact },
  { fieldNumber: '302', messageCodes: ['Z14'], conditionId: 'report_start_timestamp_business_rule', note: 'Tidstämpel för påbörjande av rapportering.', predicate: explicitCellFact },
  { fieldNumber: '321', messageCodes: ['Z13', 'Z14'], conditionId: 'report_end_timestamp_business_rule', note: 'Tidstämpel för avslutande av rapportering.', predicate: explicitCellFact },
  { fieldNumber: '216', messageCodes: ['Z09'], conditionId: 'validity_start_business_rule', note: 'Datum när aktuell ändring börjar gälla.', predicate: explicitCellFact },
  { fieldNumber: '508', messageCodes: ['Z06', 'Z14'], conditionId: 'observation_length_business_rule', note: 'Kvart/tim/månad/år.', predicate: explicitCellFact },
  { fieldNumber: '326', messageCodes: ['Z14'], conditionId: 'z14_except_n', note: 'Skickas i Z14 utom Z14N.', predicate: subtypeIsNot('N') },
  { fieldNumber: '214', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'meter_readings_sent_in_utilts', note: 'Obligatorisk om mätarställningar skickas i UTILTS.', predicate: registerReadingFirstPredicate },
  { fieldNumber: '217', messageCodes: ['Z06', 'Z09', 'Z14'], conditionId: 'measure_method_business_rule', note: 'Kvartsvis/timvis/månadsvis/årsvis mätning.', predicate: explicitCellFact },
  { fieldNumber: '218', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'meter_readings_sent_in_utilts', note: 'Obligatorisk om mätarställningar skickas.', predicate: registerReadingFirstPredicate },
  { fieldNumber: '306', messageCodes: ['Z06'], conditionId: 'installation_status_business_rule', note: 'Aktiv eller ej inkopplad.', predicate: explicitCellFact },
  { fieldNumber: '222', messageCodes: ['Z14'], conditionId: 'reporting_frequency_business_rule', note: 'Hur ofta rapportering sker.', predicate: explicitCellFact },
  { fieldNumber: '259', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'meter_time_frame_business_rule', note: 'Räkneverkskod, P26.A §2.2 s.19–20; första registret.', predicate: registerReadingFirstPredicate },
  { fieldNumber: '254', messageCodes: ['Z06', 'Z10'], conditionId: 'balance_settlement_method_business_rule', note: 'Dygns-/månadsavräkning.', predicate: explicitCellFact },
  { fieldNumber: '242', messageCodes: ['Z06', 'Z10'], conditionId: 'product_code_business_rule', note: 'Tidsserieprodukt.', predicate: explicitCellFact },
  { fieldNumber: '506', messageCodes: ['Z14'], conditionId: 'energy_product_business_rule', note: 'Energiprodukt.', predicate: explicitCellFact },
  { fieldNumber: '310', messageCodes: ['Z05', 'Z06', 'Z09'], conditionId: 'death_context_only', note: 'Används endast i anslutning till dödsfall.', predicate: context => deathAggregate(context.messageCode,context.facts.canonicalSubtype,context.facts.deathStatus) },
  { fieldNumber: '513', messageCodes: ['Z14'], conditionId: 'installation_direction_business_rule', note: 'Flödesriktning vid mätpunkten.', predicate: explicitCellFact },
  { fieldNumber: '323', messageCodes: ['Z13', 'Z14'], conditionId: 'private_customer_except_z14n', note: 'Ska anges för privatkunder i Z13/Z14, utom Z14N.', predicate: privateCustomerExceptZ14N },
  { fieldNumber: '260', messageCodes: ['Z14'], conditionId: 'net_area_business_rule', note: '3-ställig nätområdeskod.', predicate: explicitCellFact },
  { fieldNumber: '320', messageCodes: ['Z04', 'Z06'], conditionId: 'gas_market_only', note: 'Naturgas: Z04 samt Z06F/G krävs; Z06E får inte skickas.', predicate: gasPredicate },
  { fieldNumber: '240', messageCodes: ['Z04', 'Z06', 'Z10'], conditionId: 'gas_market_only', note: 'Naturgas: Z04 krävs; Z06E frivillig; Z06F/G och Z10M krävs endast vid egen kausal serie-id-ändring.', predicate: gasPredicate },
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
  { fieldNumber: '233', messageCodes: ['Z01', 'Z03', 'Z08'], conditionId: 'optional_installation_wire_parent', note: 'När IT väljs: samma värde som fält 209.', predicate: optionalInstallationWireParent },
  { fieldNumber: '234', messageCodes: ['Z01', 'Z03', 'Z08'], conditionId: 'optional_installation_wire_parent', note: 'När IT väljs: 1-3 adressrader.', predicate: optionalInstallationWireParent },
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
      const sourceField = entry.fieldNumber === 'END_USER_GROUP' && ['Z06', 'Z09', 'Z14'].includes(messageCode) ? '227' : entry.fieldNumber === 'INSTALLATION_GROUP' && messageCode === 'Z14' ? '209' : entry.fieldNumber
      const requirement = isGasApplicabilityField(messageCode,entry.fieldNumber) ? gasAggregate(messageCode,entry.fieldNumber,facts.market,facts.canonicalSubtype,facts.gasSerialChange) : resolveProdatSourceSubtypeRequirement({messageCode, fieldNumber: sourceField, subtype: facts.canonicalSubtype, market: facts.market})
      const sourceRule = prodatSourceSubtypeRule(messageCode, sourceField)
      const value = isDeathStatusField(messageCode,entry.fieldNumber) ? deathAggregate(messageCode,facts.canonicalSubtype,facts.deathStatus) : isMeterChangeField(messageCode,entry.fieldNumber) ? meterChangeAggregate(facts.meterChange,entry.fieldNumber) : (isReportingPermissionField(messageCode,entry.fieldNumber) || isProdatDateEventField(messageCode,entry.fieldNumber)) ? null : requirement !== null
        ? requirement === 'undetermined' ? null : requirement === 'required'
        : isProdatFieldInInapplicableParent({
        messageCode, subtype: normalized(facts.canonicalSubtype), fieldNumber: entry.fieldNumber,
      }) ? false : entry.predicate({
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
        status: isGasApplicabilityField(messageCode,entry.fieldNumber) ? gasStatus(requirement!) : value === null ? 'undetermined' : value ? 'required' : 'not_required',
        ...(entry.fieldNumber === '229'
          ? {decisionPhase:'legacy_pre_wire_address_hint' as const}
          : isProdatReadingField(entry.fieldNumber)
          ? { decisionPhase: 'pre_wire_readings_aggregate' as const }
          : entry.conditionId === 'optional_installation_wire_parent'
          ? { decisionPhase: 'pre_wire_parent' as const }
          : entry.conditionId === 'multiple_meter_registers'
            ? { decisionPhase: 'pre_wire_inventory_aggregate' as const }
          : {}),
        ...(requirement === null ? {} : {requirement}),
        source: sourceRule ? {...entry.source, section: `${entry.source.section}; P26.A §2.2 s.${sourceRule.page}`} : entry.source,
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


export type ProdatRegisterRequirement = 'required' | 'optional' | 'forbidden' | 'undetermined'

/** The register overlay belongs to this same canonical condition engine.
 * P26.A §2.2 pp15–20 / annex2 pp114–116. This does not rewrite the base matrix
 * or treat arbitrary field presence as evidence: first-field presence is used
 * only for the four express repetition conditions in annex2.
 */
export function resolveProdatRegisterRequirement(input: {
  messageCode: string
  fieldNumber: string
  subtype: string | null
  registerCount: number
  registerPosition: number
  firstFieldPresent: boolean
  fieldPresent: boolean
  market?: 'electricity' | 'gas' | null
  meterReadingsSentInUtilts?: boolean | null
  /** Independent physical inventory for this exact object. Observed LIN count
   * must never be supplied here as a fallback. */
  expectedRegisterCount?: number | null
  /** Explicit outbound qualification; inbound keeps its existing overlay. */
  outboundReadings?: boolean
}): ProdatRegisterRequirement | null {
  const { messageCode: code, fieldNumber: field } = input
  if (!['258','213','214','218','259'].includes(field)) return null
  const row = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === field)
  const usage = row?.requirements[PRODAT_26A_MESSAGE_CODES.findIndex(value => value === code)]
  if (usage === '-') return 'forbidden'
  if (!['Z04','Z06','Z10'].includes(code)) return null
  if (field === '258') {
    const count = input.expectedRegisterCount
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 999999) return 'undetermined'
    return (count as number) > 1 ? 'required' : 'forbidden'
  }
  if (field === '213') return code === 'Z04' || (input.registerPosition > 1 && input.firstFieldPresent) ? 'required' : 'optional'
  const readings = input.meterReadingsSentInUtilts
  if (input.outboundReadings && input.market !== 'gas') {
    if (field === '259' && input.market === 'electricity' && readings === false) return 'forbidden'
    if (code === 'Z06' && !input.subtype) return 'undetermined'
    if (field === '259' && (!input.market || typeof readings !== 'boolean')) return 'undetermined'
    if (readings === false && input.registerPosition === 1 && !(code === 'Z06' && ['E', 'G'].includes(input.subtype ?? ''))) return 'forbidden'
  }
  if (field === '259' && readings === false) {
    if (input.market === 'electricity') return 'forbidden' // §2.2 p20: only when readings are sent.
    if (!input.market) return 'undetermined'
  }
  if (code === 'Z06' && ['E','G'].includes(input.subtype ?? '')) {
    if (field === '259' && readings == null && input.fieldPresent && input.market !== 'gas') return 'undetermined'
    return input.registerPosition > 1 && input.firstFieldPresent ? 'required' : 'optional'
  }
  if (code === 'Z06' && input.subtype !== 'F') return 'undetermined'
  return readings === true ? 'required' : readings === false ? 'optional' : 'undetermined'
}
