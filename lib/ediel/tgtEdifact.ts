// lib/ediel/tgtEdifact.ts

import type {
  CreateEdielMessageInput,
  EdielAckOutcome,
  EdielDirection,
  EdielMessageFamily,
  EdielTestRoleCode,
  EdielTestSuite,
} from '@/lib/ediel/types'
import {
  EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
  EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  GRIDEX_EDIEL_ID,
} from '@/lib/ediel/fileEngine'
import {
  getEdielTgtTestCaseByCode,
  type EdielTgtExpectedStep,
} from '@/lib/ediel/tgtRegistry'
import { getEdielTgtTestDataForCase, type EdielTgtCaseTestData } from '@/lib/ediel/tgtTestData'

export type EdielTgtDraftValidationIssue = {
  severity: 'error' | 'warning' | 'info'
  code: string
  title: string
  description: string
}

export type EdielTgtDraftBuildParams = {
  actorUserId: string
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
  stepNo: number
  importedTestData?: EdielTgtCaseTestData | null
}

export type EdielTgtDraftOption = {
  stepNo: number
  label: string
  description: string
  family: EdielMessageFamily
  code: string
  direction: EdielDirection
  outcome: EdielAckOutcome | null
  canGenerate: boolean
  disabledReason: string | null
}

export type EdielTgtDraftBuildResult = {
  step: EdielTgtExpectedStep
  fileName: string
  rawPayload: string
  validationIssues: EdielTgtDraftValidationIssue[]
  messageInput: CreateEdielMessageInput
}

type DraftReferences = {
  interchangeRef: string
  messageRef: string
  transactionRef: string
  externalRef: string
  originalInterchangeRef: string
  originalMessageRef: string
  createdDate: string
  createdTime: string
  createdLongDate: string
}

type EdifactEnvelopeParams = {
  refs: DraftReferences
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference: string
  family: EdielMessageFamily
  version: string
  bodySegments: string[]
}

type ParsedEdifactSegments = {
  segments: string[]
  segmentNames: string[]
  unhRef: string | null
  untRef: string | null
  untCount: number | null
  countedMessageSegments: number | null
  unbRef: string | null
  unzRef: string | null
  unzCount: number | null
}

type TgtPortalRegister = {
  label: string
  annualEnergyKwh: string
  meterConstant: string
  meterDigits: string
  meterTimeInterval: string
  resolution?: string | null
}

type TgtProdatMutation = {
  meteringPointId?: string
  gridAreaId?: string
  agreementStartDateTime?: string
  reasonForTransaction?: string
  balanceResponsibleId?: string
  omitLineItem?: boolean
}

type TgtPortalCustomerData = {
  source: 'tgt_test_data_registry' | 'missing_test_data'
  testCustomerLabel: string
  sourceColumnName?: string | null
  sourceOrder?: number | null
  prodatTransactionType?: string | null
  meteringPointId: string
  agreementStartDateTime: string
  validityDateTime?: string | null
  agreementEndDateTime?: string | null
  annualEnergyUnit: string
  meteringMethod: string
  reasonForTransaction?: string | null
  priority?: string | null
  reportingFrequency?: string | null
  permissionStatus?: string | null
  permissionPurpose?: string | null
  permissionEndReason?: string | null
  permissionId?: string | null
  permissionTimestamp?: string | null
  energyProductId?: string | null
  installationDirection?: string | null
  meterNumber?: string | null
  customerId: string
  customerIdCodeListQualifier?: string | null
  customerName: string
  customerAddress?: string | null
  customerPostalCode?: string | null
  customerCity?: string | null
  customerCountry?: string | null
  birthDate?: string | null
  billingRecipientId?: string | null
  billingRecipientName?: string | null
  billingRecipientAddress?: string | null
  billingRecipientPostalCode?: string | null
  billingRecipientCity?: string | null
  billingRecipientCountry?: string | null
  siteAddress?: string | null
  sitePostalCode?: string | null
  siteCity?: string | null
  siteCountry?: string | null
  productCode?: string | null
  settlementMethod?: string | null
  gridAreaId: string
  powerOfAttorneyReference?: string | null
  balanceResponsibleId?: string | null
  installationStatus?: string | null
  tariffCode?: string | null
  registers: TgtPortalRegister[]
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

let tgtInterchangeRefSequence = 0

function base36Token(value: number, length: number): string {
  return Math.max(0, value).toString(36).toUpperCase().padStart(length, '0').slice(-length)
}

function shortCaseToken(testCaseCode: string): string {
  const hash = Array.from(testCaseCode).reduce((sum, char) => (sum + char.charCodeAt(0)) % 36, 0)
  return base36Token(hash, 1)
}

function buildTgtInterchangeReference(params: {
  createdDate: string
  createdTime: string
  seconds: number
  milliseconds: number
  testCaseCode: string
  stepNo: number
}): string {
  // UNB/0020 får vara max 14 tecken i TGT-flödet.
  // Format: YYMMDD + HHMM + SS(base36) + millisecond-bucket(base36) + sequence(base36).
  // Det gör referensen kort men unik även vid dubbelklick, server action retry
  // eller flera starter samma sekund.
  const secondsToken = base36Token(params.seconds, 2)
  const millisecondBucket = Math.min(35, Math.floor(params.milliseconds / 28))
  const millisecondToken = base36Token(millisecondBucket, 1)
  const caseToken = shortCaseToken(params.testCaseCode)
  const sequenceToken = base36Token((tgtInterchangeRefSequence++ + params.stepNo + Number.parseInt(caseToken, 36)) % 36, 1)

  return `${params.createdDate}${params.createdTime}${secondsToken}${millisecondToken}${sequenceToken}`.slice(0, 14)
}

function nowRefs(testCaseCode: string, stepNo: number): DraftReferences {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = pad(now.getUTCMonth() + 1)
  const d = pad(now.getUTCDate())
  const hh = pad(now.getUTCHours())
  const mm = pad(now.getUTCMinutes())
  const ss = pad(now.getUTCSeconds())
  const compact = `${y}${m}${d}${hh}${mm}${ss}`
  const safeCase = testCaseCode.replace(/[^A-Za-z0-9]/g, '')
  const createdDate = `${String(y).slice(2)}${m}${d}`
  const createdTime = `${hh}${mm}`

  const interchangeRef = buildTgtInterchangeReference({
    createdDate,
    createdTime,
    seconds: now.getUTCSeconds(),
    milliseconds: now.getUTCMilliseconds(),
    testCaseCode,
    stepNo,
  })
  const uniqueSuffix = interchangeRef.slice(-4)
  const messageRef = `M${interchangeRef.slice(1)}`.slice(0, 14)

  return {
    interchangeRef,
    messageRef,
    transactionRef: `TGT-${testCaseCode}-S${stepNo}`,
    externalRef: `GRIDEX-${testCaseCode}-S${stepNo}-${compact}-${uniqueSuffix}`.slice(0, 35),
    originalInterchangeRef: `P${safeCase}${Math.max(1, stepNo - 1)}${createdDate}${createdTime}`.slice(0, 14),
    originalMessageRef: `P${safeCase}${Math.max(1, stepNo - 1)}${compact}`.slice(0, 14),
    createdDate,
    createdTime,
    createdLongDate: `${y}${m}${d}`,
  }
}

function stripDecorations(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/^Fel\s+[^=]+=\s*/i, '')
    .trim()
}

function firstToken(value: string | null | undefined): string | null {
  const clean = stripDecorations(value)
  if (!clean) return null
  return clean.split(/\s+/)[0]?.trim() || null
}

function sanitize(value: string | null | undefined, fallback = 'UNKNOWN', maxLength = 70): string {
  const trimmed = stripDecorations(value)
  if (!trimmed) return fallback
  return trimmed
    .replace(/[ÅÄ]/g, 'A')
    .replace(/[Ö]/g, 'O')
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^A-Za-z0-9 ._\-/]/g, '')
    .slice(0, maxLength)
}

function sanitizeCode(value: string | null | undefined, fallback: string, maxLength = 35): string {
  const cleaned = sanitize(firstToken(value) ?? value, fallback, maxLength).replace(/\s+/g, '')
  return cleaned.length > 0 ? cleaned : fallback
}

function edifactEscape(value: string): string {
  return value
    .replace(/\?/g, '??')
    .replace(/'/g, "?'")
    .replace(/\+/g, '?+')
    .replace(/:/g, '?:')
}

function normalizeSearch(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeTgtCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

function columnMatches(columnName: string, selectors: readonly string[]): boolean {
  const haystack = normalizeSearch(columnName)
  return selectors.some((selector) => haystack.includes(normalizeSearch(selector)))
}

type OrderedTgtColumn = { name: string; index: number; sourceOrder?: number | null; testCase?: string }

function sourceOrderForColumn(column: OrderedTgtColumn, fallback: number): number {
  const value = Number(column.sourceOrder)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sortColumnsBySourceOrder<T extends OrderedTgtColumn>(columns: readonly T[]): T[] {
  return [...columns].sort((a, b) => {
    const orderDiff = sourceOrderForColumn(a, a.index) - sourceOrderForColumn(b, b.index)
    if (orderDiff !== 0) return orderDiff
    return a.index - b.index
  })
}

function preferredColumnSelectorsForStep(step: EdielTgtExpectedStep): string[] {
  if (step.family !== 'PRODAT') return []
  if (step.code === 'Z03') return ['z03']
  if (step.code === 'Z04') return ['z04']
  return [step.code]
}

type TestDataLookupParams = Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'> & {
  importedTestData?: EdielTgtCaseTestData | null
}

function getTgtTestData(params: TestDataLookupParams): EdielTgtCaseTestData | null {
  const importedCaseCode = normalizeTgtCode(params.importedTestData?.testCaseCode)
  const requestedCaseCode = normalizeTgtCode(params.testCaseCode)

  if (params.importedTestData && (!importedCaseCode || importedCaseCode === requestedCaseCode)) {
    return params.importedTestData
  }

  return getEdielTgtTestDataForCase(params.testSuite, params.roleCode, params.testCaseCode)
}

function findTestValue(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  selectors: readonly string[],
  preferredColumnSelectors: readonly string[] = []
): string | null {
  const data = getTgtTestData(params)
  if (!data) return null
  const normalizedSelectors = selectors.map(normalizeSearch)

  for (const group of data.groups) {
    const preferredColumns = preferredColumnSelectors.length > 0
      ? group.columns.filter((column) => columnMatches(`${column.name} ${column.testCase}`, preferredColumnSelectors))
      : []
    const candidateColumns = sortColumnsBySourceOrder(preferredColumns.length > 0 ? preferredColumns : group.columns)

    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`)
      if (!normalizedSelectors.some((selector) => haystack.includes(selector))) continue

      for (const column of candidateColumns) {
        const trimmed = field.values[column.name]?.trim()
        if (trimmed) return trimmed
      }
    }
  }

  return null
}

function findTestValueForStep(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  selectors: readonly string[]
): string | null {
  return findTestValue(params, selectors, preferredColumnSelectorsForStep(step))
}

type TgtMatchedField = {
  fieldCode: string
  fieldName: string
  value: string | null
}

function findTestFieldForStep(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  selectors: readonly string[]
): TgtMatchedField | null {
  const data = getTgtTestData(params)
  if (!data) return null

  const normalizedSelectors = selectors.map(normalizeSearch)
  const preferredColumnSelectors = preferredColumnSelectorsForStep(step)

  for (const group of data.groups) {
    const preferredColumns = preferredColumnSelectors.length > 0
      ? group.columns.filter((column) => columnMatches(`${column.name} ${column.testCase}`, preferredColumnSelectors))
      : []
    const candidateColumns = sortColumnsBySourceOrder(preferredColumns.length > 0 ? preferredColumns : group.columns)

    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`)
      if (!normalizedSelectors.some((selector) => haystack.includes(selector))) continue

      for (const column of candidateColumns) {
        const trimmed = field.values[column.name]?.trim()
        if (trimmed) {
          return {
            fieldCode: field.fieldCode,
            fieldName: field.fieldName,
            value: trimmed,
          }
        }
      }
    }
  }

  return null
}

function inferCustomerIdCodeListQualifier(fieldName: string | null | undefined, customerId: string | null | undefined): string {
  const normalizedField = normalizeSearch(fieldName)
  if (normalizedField.includes('se1')) return 'SE1'
  if (normalizedField.includes('se2')) return 'SE2'

  const normalizedCustomerId = String(customerId ?? '').replace(/\D/g, '')
  if (/^\d{12}$/.test(normalizedCustomerId)) return 'SE2'
  if (/^\d{10}$/.test(normalizedCustomerId)) return 'SE1'

  return 'SE2'
}

function findSourceColumn(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  columnName: string
): OrderedTgtColumn | null {
  const data = getTgtTestData(params)
  if (!data) return null

  for (const group of data.groups) {
    const column = group.columns.find((candidate) => candidate.name === columnName)
    if (column) return column
  }

  return null
}

function findFieldValueForColumn(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  columnName: string,
  selectors: readonly string[]
): string | null {
  const data = getTgtTestData(params)
  if (!data) return null
  const normalizedSelectors = selectors.map(normalizeSearch)

  for (const group of data.groups) {
    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`)
      if (!normalizedSelectors.some((selector) => haystack.includes(selector))) continue
      const trimmed = field.values[columnName]?.trim()
      if (trimmed) return trimmed
    }
  }

  return null
}

function selectedRegisterColumns(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep
): string[] {
  const data = getTgtTestData(params)
  if (!data) return []
  const names: string[] = []

  for (const group of data.groups) {
    for (const column of getPreferredColumnsForStep(params, step, group.columns)) {
      if (!names.includes(column.name)) names.push(column.name)
    }
  }

  return names
}

function buildRegistersFromTestData(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep
): TgtPortalRegister[] {
  const columns = selectedRegisterColumns(params, step)
  const registers = columns.map((columnName, index) => {
    const annualEnergyRaw = firstToken(findFieldValueForColumn(params, columnName, ['213 uppskattad årsenergi']))
    const meterConstantRaw = firstToken(findFieldValueForColumn(params, columnName, ['214 konstant']))
    const meterDigitsRaw = firstToken(findFieldValueForColumn(params, columnName, ['218 antal siffror']))
    const intervalRaw = firstToken(findFieldValueForColumn(params, columnName, ['259 mätare, tidsintervall', '259 matare']))
    const resolutionRaw = firstToken(findFieldValueForColumn(params, columnName, ['508b upplösning', '508 upplösning', '508 tidslängd']))

    return {
      label: `register_${index + 1}`,
      annualEnergyKwh: annualEnergyRaw && /^\d+$/.test(annualEnergyRaw) ? annualEnergyRaw : '',
      meterConstant: meterConstantRaw && /^\d+(?:[.,]\d+)?$/.test(meterConstantRaw) ? meterConstantRaw.replace(',', '.') : '',
      meterDigits: meterDigitsRaw && /^\d+$/.test(meterDigitsRaw) ? meterDigitsRaw : '',
      meterTimeInterval: intervalRaw && /^\d+$/.test(intervalRaw) ? intervalRaw : '',
      resolution: resolutionRaw && /^\d+$/.test(resolutionRaw) ? resolutionRaw : null,
    }
  })

  return registers.filter((register) =>
    register.annualEnergyKwh ||
    register.meterConstant ||
    register.meterDigits ||
    register.meterTimeInterval ||
    register.resolution
  )
}

function cleanOptional(value: string | null | undefined, maxLength = 70): string | null {
  const cleaned = sanitize(value, '', maxLength)
  if (cleaned === '-') return null
  return cleaned.length > 0 ? cleaned : null
}

function cleanOptionalCode(value: string | null | undefined, maxLength = 35): string | null {
  const cleaned = sanitizeCode(value, '', maxLength)
  if (cleaned === '-') return null
  return cleaned.length > 0 ? cleaned : null
}

function senderControlledText(value: string | null | undefined): boolean {
  const normalized = normalizeSearch(value)
  return (
    !normalized ||
    normalized.includes('satts av avsandaren') ||
    normalized.includes('sätts av avsändaren') ||
    normalized.includes('valfritt') ||
    normalized === 'optional'
  )
}

function defaultAgreementStartDateTime(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const nextMonth = new Date(Date.UTC(year, month + 1, 10, 0, 0, 0))
  return `${nextMonth.getUTCFullYear()}${pad(nextMonth.getUTCMonth() + 1)}100000`
}

function firstDayNextMonthDateTime(): string {
  const now = new Date()
  const firstDayNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
  return `${firstDayNextMonth.getUTCFullYear()}${pad(firstDayNextMonth.getUTCMonth() + 1)}010000`
}

function formatUtcDateTime(date: Date, includeTime = false): string {
  const y = date.getUTCFullYear()
  const m = pad(date.getUTCMonth() + 1)
  const d = pad(date.getUTCDate())
  const hh = pad(date.getUTCHours())
  const mm = pad(date.getUTCMinutes())
  return includeTime ? `${y}${m}${d}${hh}${mm}` : `${y}${m}${d}0000`
}

function firstDayPreviousMonthDateTime(): string {
  const now = new Date()
  return formatUtcDateTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0)))
}

function fifteenthDayPreviousMonthDateTime(): string {
  const now = new Date()
  return formatUtcDateTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 0, 0, 0)))
}

function firstDaySameMonthPreviousYearDateTime(): string {
  const now = new Date()
  return formatUtcDateTime(new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1, 0, 0, 0)))
}

function currentDayDateTime(): string {
  const now = new Date()
  return formatUtcDateTime(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)))
}

function currentUtcMinuteDateTime(): string {
  return formatUtcDateTime(new Date(), true)
}

function fifteenthDayNextMonthDateTime(): string {
  const now = new Date()
  const fifteenthDayNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 15, 0, 0, 0))
  return `${fifteenthDayNextMonth.getUTCFullYear()}${pad(fifteenthDayNextMonth.getUTCMonth() + 1)}150000`
}

function resolvePortalDateTime(value: string | null | undefined): string {
  const token = firstToken(value)
  if (token && /^\d{8,12}$/.test(token)) return token.length === 8 ? `${token}0000` : token.slice(0, 12)

  const normalized = normalizeSearch(value)
  if (normalized.includes('aktuell tidpunkt') || normalized.includes('tidpunkten nar tillstandet skapas') || normalized.includes('tidpunkten när tillståndet skapas')) {
    return currentUtcMinuteDateTime()
  }
  if (normalized.includes('dagens datum')) return currentDayDateTime()
  if (normalized.includes('15') && normalized.includes('foregaende manad')) return fifteenthDayPreviousMonthDateTime()
  if (normalized.includes('15') && normalized.includes('föregående månad')) return fifteenthDayPreviousMonthDateTime()
  if (normalized.includes('1') && normalized.includes('samma manad') && normalized.includes('foregaende ar')) return firstDaySameMonthPreviousYearDateTime()
  if (normalized.includes('1') && normalized.includes('samma månad') && normalized.includes('föregående år')) return firstDaySameMonthPreviousYearDateTime()
  if (normalized.includes('1') && normalized.includes('foregaende manad')) return firstDayPreviousMonthDateTime()
  if (normalized.includes('1') && normalized.includes('föregående månad')) return firstDayPreviousMonthDateTime()
  if (normalized.includes('15') && normalized.includes('nasta manad')) return fifteenthDayNextMonthDateTime()
  if (normalized.includes('10') && normalized.includes('nasta manad')) return defaultAgreementStartDateTime()

  return defaultAgreementStartDateTime()
}

function defaultPowerOfAttorneyReference(params: Pick<EdielTgtDraftBuildParams, 'testCaseCode'>): string {
  if (params.testCaseCode === '1.3.1') return 'AVTAL05'
  if (params.testCaseCode === '8.1.1' || params.testCaseCode === '8.2.1') return 'AVTALE5'
  const safeCase = params.testCaseCode.replace(/[^0-9A-Za-z]/g, '').slice(0, 8).toUpperCase()
  return `AVTAL${safeCase || 'TGT'}`.slice(0, 35)
}

function defaultPermissionId(params: Pick<EdielTgtDraftBuildParams, 'testCaseCode'>): string {
  const safeCase = params.testCaseCode.replace(/[^0-9A-Za-z]/g, '').slice(0, 10).toUpperCase()
  return `TILLST${safeCase || 'TGT'}`.slice(0, 35)
}

function resolveSenderControlledCode(
  value: string | null | undefined,
  fallback: string,
  maxLength = 35
): string | null {
  if (senderControlledText(value)) return fallback
  return cleanOptionalCode(value, maxLength) ?? fallback
}

type TgtRequiredFieldRule = {
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCodes: readonly string[]
  stepFamily: EdielMessageFamily
  stepCode: string
  fieldCode: string
  value: string
  reason: string
}

const TGT_REQUIRED_FIELD_RULES: readonly TgtRequiredFieldRule[] = [
  {
    testSuite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCodes: ['1.2.1', '1.2.2', '1.4.2', '1.4.2B', '1.5.1'],
    stepFamily: 'PRODAT',
    stepCode: 'Z03',
    fieldCode: '217',
    value: 'Z03',
    reason:
      'Edielportalens aktiva TGT-validering kräver Z03 i fält 217 för utgående start-Z03 i dessa leverantörstest. Portalens testdatavy kan samtidigt visa Z01 för senare Z04-/normaldata, men den får inte styra start-Z03.',
  },
  {
    testSuite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCodes: ['2.5.1'],
    stepFamily: 'PRODAT',
    stepCode: 'Z09',
    fieldCode: '217',
    value: 'Z04',
    reason:
      'Z09F avtal om 15-minutersvärden ska anmäla kvartsmätning. Edielportalens aktiva testfall 2.5.1 kräver därför fält 217 = Z04 även om importerat underlag visar äldre/grunddata.',
  },
  {
    testSuite: 'PRODAT',
    roleCode: 'supplier',
    testCaseCodes: ['2.5.2'],
    stepFamily: 'PRODAT',
    stepCode: 'Z09',
    fieldCode: '217',
    value: 'Z03',
    reason:
      'Z09G avtal om timvärden upphör ska återgå enligt Z09G-profilen. Fält 217 styrs av Z09-profilen, inte av slumpmässig importerad grunddata.',
  },
]

function resolveTgtRequiredFieldRule(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  fieldCode: string
): TgtRequiredFieldRule | null {
  const testCaseCode = params.testCaseCode.trim()
  const normalizedStepCode = normalizeTgtCode(step.code)
  const normalizedFieldCode = normalizeTgtCode(fieldCode)

  return (
    TGT_REQUIRED_FIELD_RULES.find((rule) =>
      rule.testSuite === params.testSuite &&
      rule.roleCode === params.roleCode &&
      rule.testCaseCodes.includes(testCaseCode) &&
      rule.stepFamily === step.family &&
      normalizeTgtCode(rule.stepCode) === normalizedStepCode &&
      normalizeTgtCode(rule.fieldCode) === normalizedFieldCode
    ) ?? null
  )
}

function resolveTgtRequiredFieldValue(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  fieldCode: string
): string | null {
  return resolveTgtRequiredFieldRule(params, step, fieldCode)?.value ?? null
}

function resolveTgtMeteringMethod(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  importedValue: string | null
): string {
  return resolveTgtRequiredFieldValue(params, step, '217') ?? importedValue ?? ''
}

function resolveTgtValidityDateTime(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  importedValue: string | null
): string | null {
  if (params.testSuite === 'PRODAT' && params.roleCode === 'supplier' && step.code === 'Z09') {
    if (params.testCaseCode === '2.5.1' || params.testCaseCode === '2.5.2') {
      return firstDayNextMonthDateTime()
    }
  }

  return importedValue ? resolvePortalDateTime(importedValue) : null
}

function getPortalData(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  columnName?: string | null
): TgtPortalCustomerData {
  const data = getTgtTestData(params)
  const valueFor = (selectors: readonly string[]) =>
    columnName ? findFieldValueForColumn(params, columnName, selectors) : findTestValueForStep(params, step, selectors)
  const fieldFor = (selectors: readonly string[]): TgtMatchedField | null => {
    if (!columnName) return findTestFieldForStep(params, step, selectors)
    const value = findFieldValueForColumn(params, columnName, selectors)
    if (!value) return null

    const normalizedSelectors = selectors.map(normalizeSearch)
    for (const group of getTgtTestData(params)?.groups ?? []) {
      for (const field of group.fields) {
        const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`)
        if (normalizedSelectors.some((selector) => haystack.includes(selector))) {
          return { fieldCode: field.fieldCode, fieldName: field.fieldName, value }
        }
      }
    }

    return { fieldCode: '', fieldName: '', value }
  }

  const startDateRaw = valueFor(['210 avtal', 'startdatum', 'leveransstart'])
  const validityDateRaw = valueFor(['216 giltighetsdatum', '216 validity', '216 valid'])
  const endDateRaw = valueFor(['211 avtal, slutdatum', '211 slutdatum', '211 end date', '321 rapportslutdatum', '327 tjänsten/rapporteringen upphör', '327 tjansten/rapporteringen upphor', 'slutdatum'])
  const registers = columnName ? [] : buildRegistersFromTestData(params, step)
  const importedMeteringMethod = cleanOptionalCode(valueFor(['217 mätmetod', '217 matmetod']), 12)
  const poaRaw = valueFor(['261 referens'])
  const balanceResponsibleRaw = valueFor(['262 balansansvarig'])
  const customerIdField = fieldFor(['227 kund-id', 'personnummer', 'kundidentitet'])
  const customerId = cleanOptionalCode(customerIdField?.value, 35) ?? ''

  const sourceColumn = columnName ? findSourceColumn(params, columnName) : null
  const rawMeteringPointId = cleanOptionalCode(
    valueFor(['209 anläggningsid', '209 anlaggningsid', '233 anläggningsid', '233 anlaggningsid', 'metering point', 'mätpunkt']),
    35
  )
  const meteringPointId = resolveEscoZ13MeteringPointId(params, step, rawMeteringPointId, sourceColumn?.name ?? columnName ?? null)

  return {
    source: data ? 'tgt_test_data_registry' : 'missing_test_data',
    testCustomerLabel: columnName || data?.title || `TGT ${params.testSuite} ${params.testCaseCode}`,
    sourceColumnName: sourceColumn?.name ?? columnName ?? null,
    sourceOrder: sourceColumn?.sourceOrder ?? sourceColumn?.index ?? null,
    meteringPointId,
    agreementStartDateTime: resolvePortalDateTime(startDateRaw),
    validityDateTime: resolveTgtValidityDateTime(params, step, validityDateRaw),
    agreementEndDateTime: endDateRaw ? resolvePortalDateTime(endDateRaw) : null,
    annualEnergyUnit: cleanOptionalCode(valueFor(['enhet för uppskattad årsenergi']), 8) ?? 'KWH',
    meteringMethod: resolveTgtMeteringMethod(params, step, importedMeteringMethod),
    reasonForTransaction: cleanOptionalCode(valueFor(['223 transaktionstyp', 'reason for transaction']), 12),
    priority: cleanOptionalCode(valueFor(['220 prioritet']), 12),
    reportingFrequency: cleanOptionalCode(valueFor(['222 rapporteringsfrekvens']), 12),
    permissionStatus: cleanOptionalCode(valueFor(['322 tillståndets status', '322 tillstandets status', 'permission status']), 12),
    permissionPurpose: cleanOptionalCode(valueFor(['323 tillståndets syfte', '323 tillstandets syfte', 'permission purpose']), 12),
    permissionEndReason: cleanOptionalCode(valueFor(['324 orsak till tillståndets upphörande', '324 orsak till tillstandets upphorande', 'permission end reason']), 12),
    permissionId: resolveSenderControlledCode(valueFor(['325 tillståndets id', '325 tillstandets id', 'permission id']), defaultPermissionId(params), 35),
    permissionTimestamp: resolvePortalDateTime(valueFor(['326 tillståndets tidstämpel', '326 tillstandets timestampel', 'permission timestamp'])),
    energyProductId: cleanOptionalCode(valueFor(['506 produkt id', '506 energiprodukt', 'energiprodukt', 'energy product']), 35),
    installationDirection: cleanOptionalCode(valueFor(['513 riktning', '513 typ av anläggning', '513 typ av anlaggning', 'typ av anläggning', 'installation direction']), 12),
    meterNumber: cleanOptionalCode(valueFor(['224 mätarnummer', '224 matarnummer']), 35),
    customerId,
    customerIdCodeListQualifier: inferCustomerIdCodeListQualifier(customerIdField?.fieldName, customerId),
    customerName: cleanOptional(valueFor(['228 namn-elanvändare', '228 namn-elanvandare', 'kundnamn', 'customer']), 70) ?? '',
    customerAddress: cleanOptional(valueFor(['229 adress-elanvändare', '229 adress-elanvandare']), 70),
    customerPostalCode: cleanOptionalCode(valueFor(['231 postnr-elanvändare', '231 postnr-elanvandare']), 12),
    customerCity: cleanOptional(valueFor(['232 postort-elanvändare', '232 postort-elanvandare']), 35),
    customerCountry: cleanOptionalCode(valueFor(['316 land-elanvändare', '316 land-elanvandare']), 3),
    siteAddress: cleanOptional(valueFor(['234 adress-anläggning', '234 address-anläggning', '234 adress-anlaggning', '234 address-anlaggning']), 70),
    sitePostalCode: cleanOptionalCode(valueFor(['235 postnr-anläggning', '235 postnr-anlaggning']), 12),
    siteCity: cleanOptional(valueFor(['236 postort-anläggning', '236 postort-anlaggning']), 35),
    siteCountry: cleanOptionalCode(valueFor(['237 land-anläggning', '237 land-anlaggning']), 3),
    billingRecipientId: cleanOptionalCode(valueFor(['250 fakturamottagare']), 35),
    billingRecipientName: cleanOptional(valueFor(['251 namn-fakturamottagare']), 70),
    billingRecipientAddress: cleanOptional(valueFor(['252 adress-fakturamottagare', '252 address-fakturamottagare']), 70),
    billingRecipientPostalCode: cleanOptionalCode(valueFor(['253 postnr-fakturamottagare', '253 postnr-fakturamottgare']), 12),
    billingRecipientCity: cleanOptional(valueFor(['317 postort-fakturamottagare']), 35),
    billingRecipientCountry: cleanOptionalCode(valueFor(['318 land-fakturamottagare']), 3),
    birthDate: cleanOptionalCode(valueFor(['249 födelsesdatum', '249 födelsedatum', '249 fodelsesdatum', '249 fodelsedatum']), 8),
    productCode: cleanOptionalCode(valueFor(['242 produktkod']), 35),
    settlementMethod: cleanOptionalCode(valueFor(['254 avräkningsmetod', '254 avrackningsmetod', '254 avrakningsmetod']), 12),
    gridAreaId: cleanOptionalCode(valueFor(['260 nätområdesid', '260 natomradesid']), 12) ?? '',
    powerOfAttorneyReference: resolveSenderControlledCode(poaRaw, defaultPowerOfAttorneyReference(params), 35),
    balanceResponsibleId: resolveSenderControlledCode(balanceResponsibleRaw, '91109', 35),
    installationStatus: cleanOptionalCode(valueFor(['306 installationsstatus']), 12),
    tariffCode: cleanOptionalCode(valueFor(['307 tariffkod']), 20),
    registers,
  }
}

function getColumnStepScore(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  column: OrderedTgtColumn
): number {
  const selectors = preferredColumnSelectorsForStep(step)
  const haystack = `${column.name} ${column.testCase}`
  let score = selectors.length > 0 && columnMatches(haystack, selectors) ? 100 : 0

  if (step.family === 'PRODAT') {
    const transactionType = buildTgtProdatTransactionType(params, step)
    const transactionValue = findFieldValueForColumn(params, column.name, ['223 transaktionstyp', 'reason for transaction'])
    const normalizedTransaction = normalizeSearch(transactionValue)
    if (transactionType && normalizedTransaction.includes(normalizeSearch(transactionType))) score += 90
    if (step.code && normalizedTransaction.includes(normalizeSearch(step.code))) score += 60

    const meteringValue = firstToken(findFieldValueForColumn(params, column.name, ['217 mätmetod', '217 matmetod']))
    if (step.code === 'Z03' && meteringValue === 'Z03') score += 25
    if (step.code === 'Z03' && meteringValue === 'Z01') score -= 25
  }

  return score
}

function getPreferredColumnsForStep(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  columns: readonly OrderedTgtColumn[]
): OrderedTgtColumn[] {
  const scored = columns.map((column) => ({ column, score: getColumnStepScore(params, step, column) }))
  const bestScore = Math.max(0, ...scored.map((entry) => entry.score))
  const selected = bestScore > 0 ? scored.filter((entry) => entry.score === bestScore).map((entry) => entry.column) : [...columns]
  return sortColumnsBySourceOrder(selected)
}


function findFirstTgtFieldValueAcrossColumns(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  selectors: readonly string[],
  options: { excludeColumnName?: string | null; preferredColumnSelectors?: readonly string[] } = {}
): string | null {
  const data = getTgtTestData(params)
  if (!data) return null

  const normalizedSelectors = selectors.map(normalizeSearch)
  const preferredColumnSelectors = options.preferredColumnSelectors ?? []

  for (const group of data.groups) {
    const preferredColumns = preferredColumnSelectors.length > 0
      ? group.columns.filter((column) => columnMatches(`${column.name} ${column.testCase}`, preferredColumnSelectors))
      : []
    const candidateColumns = sortColumnsBySourceOrder(preferredColumns.length > 0 ? preferredColumns : group.columns)
      .filter((column) => column.name !== options.excludeColumnName)

    for (const field of group.fields) {
      const haystack = normalizeSearch(`${field.fieldCode} ${field.fieldName}`)
      if (!normalizedSelectors.some((selector) => haystack.includes(selector))) continue

      for (const column of candidateColumns) {
        const trimmed = field.values[column.name]?.trim()
        if (trimmed && cleanOptionalCode(trimmed, 35)) return trimmed
      }
    }
  }

  return null
}


function fallbackEscoPermissionMeteringPointId(params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>, step: EdielTgtExpectedStep): string {
  if (params.testSuite !== 'PRODAT' || params.roleCode !== 'esco') return ''

  if (params.testCaseCode === '8.1.1' && step.code === 'Z13') return '735999888000000109'
  if (params.testCaseCode === '8.1.2' && step.code === 'Z13') return '735999888000000108'
  if (params.testCaseCode === '8.1.3' && step.code === 'Z13') return '735999888000000112'
  if (params.testCaseCode === '9.1.2' && step.code === 'Z18') return '735999888000000113'

  return ''
}

function resolveEscoZ13MeteringPointId(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep,
  currentMeteringPointId: string | null | undefined,
  sourceColumnName?: string | null
): string {
  const cleanCurrent = cleanOptionalCode(currentMeteringPointId, 35)
  if (cleanCurrent) return cleanCurrent
  if (params.testSuite !== 'PRODAT' || params.roleCode !== 'esco' || step.code !== 'Z13') return ''

  // I ESCO-testerna ligger anläggnings-id ibland på portalens svarskolumn (Z14/Z15)
  // medan det utgående Z13-fältet anges som '-' eller tomt. För att skapa en stabil
  // TGT-fil använder vi första objekt-id som hör till samma testfall.
  return cleanOptionalCode(
    findFirstTgtFieldValueAcrossColumns(
      params,
      ['209 anläggningsid', '209 anlaggningsid', '233 anläggningsid', '233 anlaggningsid', 'metering point', 'mätpunkt'],
      { excludeColumnName: sourceColumnName, preferredColumnSelectors: ['z14', 'z15'] }
    ),
    35
  ) ?? fallbackEscoPermissionMeteringPointId(params, step)
}

function resolvePermissionInstallationDirection(params: {
  portalData: TgtPortalCustomerData
  step: EdielTgtExpectedStep
  transactionType: string
}): string {
  const imported = sanitizeCode(params.portalData.installationDirection, '', 12)
  if (imported) return imported
  if (params.step.code === 'Z13') return 'E19'
  if (params.step.code === 'Z14') return params.transactionType.endsWith('H') ? 'E18' : 'E17'
  return ''
}

function getPortalDataColumnNames(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep
): string[] {
  const data = getTgtTestData(params)
  if (!data) return []

  const names: string[] = []

  for (const group of data.groups) {
    const candidateColumns = getPreferredColumnsForStep(params, step, group.columns)

    for (const column of candidateColumns) {
      const hasObjectId = Boolean(findFieldValueForColumn(params, column.name, ['209 anläggningsid', '209 anlaggningsid', '233 anläggningsid', '233 anlaggningsid']))
      const hasCustomer = Boolean(findFieldValueForColumn(params, column.name, ['227 kund-id', 'personnummer', 'kundidentitet']))
      if ((hasObjectId || hasCustomer) && !names.includes(column.name)) names.push(column.name)
    }
  }

  return names
}

function getPortalDataRows(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep
): TgtPortalCustomerData[] {
  const columnNames = getPortalDataColumnNames(params, step)
  if (columnNames.length === 0) return [getPortalData(params, step)]
  return columnNames.map((columnName) => getPortalData(params, step, columnName))
}

function date102FromPortalDate(value: string | null | undefined, fallback: string): string {
  const token = firstToken(value)
  if (token && /^\d{8,12}$/.test(token)) return token.slice(0, 8)
  return fallback
}

function date203FromPortalDate(value: string | null | undefined, fallback: string): string {
  const token = firstToken(value)
  if (token && /^\d{8,12}$/.test(token)) return token.length === 8 ? `${token}0000` : token.slice(0, 12)
  return `${fallback}0000`
}

function isZ09DTransaction(transactionType: string | null | undefined): boolean {
  return normalizeTgtCode(transactionType) === 'Z09D'
}

function buildZ09FOrZ09GLineDateSegment(portalData: TgtPortalCustomerData, refs: DraftReferences): string {
  const dateSource = portalData.validityDateTime ?? portalData.agreementStartDateTime
  const validityDate = date203FromPortalDate(dateSource, refs.createdLongDate)
  return `DTM+157:${validityDate}:203`
}

function buildZ09DLineDateSegments(portalData: TgtPortalCustomerData, refs: DraftReferences): string[] {
  const startDate = date203FromPortalDate(portalData.agreementStartDateTime, refs.createdLongDate)
  const endDate = portalData.agreementEndDateTime
    ? date203FromPortalDate(portalData.agreementEndDateTime, refs.createdLongDate)
    : null

  return [
    `DTM+92:${startDate}:203`,
    ...(endDate ? [`DTM+93:${endDate}:203`] : []),
  ]
}

function expectedZ09LineDateSegments(portalData: TgtPortalCustomerData, refs: DraftReferences): string[] {
  return isZ09DTransaction(portalData.prodatTransactionType ?? portalData.reasonForTransaction)
    ? buildZ09DLineDateSegments(portalData, refs)
    : [buildZ09FOrZ09GLineDateSegment(portalData, refs)]
}

function serializeEdifactSegments(segments: string[]): string {
  return [`UNA:+.? '`, ...segments.map((segment) => `${segment}'`)].join('\n')
}

function buildUnb(params: {
  refs: DraftReferences
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference: string
}): string {
  const sender = params.senderSubAddress
    ? `${params.senderEdielId}:ZZ:${params.senderSubAddress}`
    : `${params.senderEdielId}:ZZ`
  const receiver = params.receiverSubAddress
    ? `${params.receiverEdielId}:ZZ:${params.receiverSubAddress}`
    : `${params.receiverEdielId}:ZZ`

  return `UNB+UNOC:3+${sender}+${receiver}+${params.refs.createdDate}:${params.refs.createdTime}+${params.refs.interchangeRef}++${params.applicationReference}++1`
}

function buildUnh(refs: DraftReferences, family: EdielMessageFamily, version: string): string {
  if (family === 'APERAK') return `UNH+${refs.messageRef}+APERAK:D:96A:UN:E2SE3B`
  if (family === 'CONTRL') return `UNH+${refs.messageRef}+CONTRL:2:2:UN:EDIEL2`
  if (family === 'UTILTS_ERR') return `UNH+${refs.messageRef}+APERAK:D:96A:UN:E5SE5A`
  if (family === 'UTILTS') return `UNH+${refs.messageRef}+UTILTS:D:02B:UN:${version}`
  return `UNH+${refs.messageRef}+PRODAT:D:97A:UN:${version === '26A' ? 'E2SE6A' : version}`
}

function buildInterchange(params: EdifactEnvelopeParams): string {
  const unb = buildUnb({
    refs: params.refs,
    senderEdielId: params.senderEdielId,
    senderSubAddress: params.senderSubAddress,
    receiverEdielId: params.receiverEdielId,
    receiverSubAddress: params.receiverSubAddress,
    applicationReference: params.applicationReference,
  })
  const unh = buildUnh(params.refs, params.family, params.version)
  const messageSegments = [unh, ...params.bodySegments]
  const unt = `UNT+${messageSegments.length + 1}+${params.refs.messageRef}`
  const unz = `UNZ+1+${params.refs.interchangeRef}`
  return serializeEdifactSegments([unb, ...messageSegments, unt, unz])
}

function positiveAperakSegments(refs: DraftReferences): string[] {
  return [
    'BGM+313+APERAK+34',
    `DTM+137:${refs.createdLongDate}:102`,
    `RFF+ACE:${refs.transactionRef}`,
    'ERC+100',
    'FTX+AAO+++OK',
  ]
}

function negativeAperakSegments(refs: DraftReferences): string[] {
  return [
    'BGM+313+APERAK+40',
    `DTM+137:${refs.createdLongDate}:102`,
    `RFF+ACE:${refs.transactionRef}`,
    'ERC+105',
    'FTX+AAO+++The object could not be identified',
  ]
}

function buildTgtProdatTransactionType(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode' | 'importedTestData'>,
  step: EdielTgtExpectedStep
): string {
  if (step.code === 'Z09') {
    if (params.testCaseCode === '2.5.1') return 'Z09F'
    if (params.testCaseCode === '2.5.2') return 'Z09G'
    if (params.testCaseCode === '2.5.3') return 'Z09D'
  }

  if (params.testCaseCode === '1.2.2') return step.code === 'Z03' ? 'Z03LK' : 'Z04LK'

  if (step.code === 'Z05') {
    if (['3.1.2', '3.2.1', '6.1.2'].includes(params.testCaseCode)) return 'Z05LK'
    if (['3.1.1', '6.1.1'].includes(params.testCaseCode)) return 'Z05L'
  }

  // Negativt PRODAT-test 1.3.1 bygger på samma Z03LK-profil i portalens
  // testdata: fält 223 ska vara Z23 och fält 210 ska vara avtalsstart den
  // 10:e nästkommande månad. Detta ska styras på testfallsnivå så alla
  // genererade filer för testfallet får rätt facit, inte bara en enskild fil.
  if (params.testCaseCode === '1.3.1' && step.code === 'Z03') return 'Z03LK'

  if (params.testCaseCode === '1.2.5') return step.code === 'Z04' ? 'Z04D' : `${step.code}D`

  if (params.roleCode === 'esco') {
    if (step.code === 'Z13') return params.testCaseCode === '8.1.3' ? 'Z13VH' : 'Z13V'
    if (step.code === 'Z14') return params.testCaseCode === '8.1.2' ? 'Z14N' : params.testCaseCode === '8.1.3' ? 'Z14VH' : 'Z14V'
    if (step.code === 'Z15') return 'Z15V'
    if (step.code === 'Z18') return 'Z18V'
  }

  if (['2.1.1', '2.1.2'].includes(params.testCaseCode)) {
    return step.code === 'Z06' ? 'Z06F' : `${step.code}F`
  }

  if (params.testCaseCode === '2.1.3') {
    return step.code === 'Z06' ? 'Z06G' : `${step.code}G`
  }

  return step.code === 'Z03' ? 'Z03L' : `${step.code}L`
}

function reasonForProdatSubtype(transactionType: string): string {
  if (transactionType === 'Z13V' || transactionType === 'Z14V' || transactionType === 'Z15V' || transactionType === 'Z18V') return 'S17'
  if (transactionType === 'Z13VH' || transactionType === 'Z14VH') return 'S18'
  if (transactionType.endsWith('LK')) return 'Z23'
  if (transactionType.endsWith('F')) return 'E64'
  if (transactionType.endsWith('G')) return 'E32'
  if (transactionType.endsWith('D')) return 'Z70'
  return 'Z22'
}

function getTgtProdatMutation(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep): TgtProdatMutation {
  if (step.family !== 'PRODAT') return {}

  if (params.testCaseCode === '1.3.1' && step.code === 'Z03') {
    return {
      agreementStartDateTime: defaultAgreementStartDateTime(),
      reasonForTransaction: 'Z23',
    }
  }

  if (params.testCaseCode === '1.3.2' && step.code === 'Z03') {
    return { gridAreaId: 'TEX', reasonForTransaction: 'Z23' }
  }

  if (params.testCaseCode === '1.3.3' && step.code === 'Z03') {
    return {
      reasonForTransaction: 'Z26',
      balanceResponsibleId: '99999',
      omitLineItem: true,
    }
  }

  if ((params.testCaseCode === '1.3.4' || params.testCaseCode === '1.3.4B') && step.code === 'Z03') return {}

  return {}
}

function applyProdatMutationToPortalData(
  sourcePortalData: TgtPortalCustomerData,
  mutation: TgtProdatMutation
): TgtPortalCustomerData {
  return {
    ...sourcePortalData,
    agreementStartDateTime: mutation.agreementStartDateTime ?? sourcePortalData.agreementStartDateTime,
    meteringPointId: mutation.meteringPointId ?? sourcePortalData.meteringPointId,
    gridAreaId: mutation.gridAreaId ?? sourcePortalData.gridAreaId,
    reasonForTransaction: mutation.reasonForTransaction ?? sourcePortalData.reasonForTransaction,
    balanceResponsibleId: mutation.balanceResponsibleId ?? sourcePortalData.balanceResponsibleId,
  }
}


function isPermissionProdatCode(code: string | null | undefined): boolean {
  return code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18'
}

function permissionPurposeForTransaction(transactionType: string, imported?: string | null): string | null {
  const clean = sanitizeCode(imported, '', 12)
  if (clean) return clean
  return transactionType.endsWith('H') ? 'B72' : 'B71'
}

function buildProdatPermissionLineSegments(params: {
  portalData: TgtPortalCustomerData
  step: EdielTgtExpectedStep
  refs: DraftReferences
  transactionType: string
  mutation: TgtProdatMutation
  lineNo: number
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
}): string[] {
  const { portalData, step, refs, transactionType, mutation, lineNo, testSuite, roleCode, testCaseCode } = params
  const meteringPointId = sanitizeCode(
    portalData.meteringPointId || fallbackEscoPermissionMeteringPointId({ testSuite, roleCode, testCaseCode }, step),
    '',
    35
  )
  const gridAreaId = sanitizeCode(portalData.gridAreaId, '', 12)
  const lineReference = lineNo === 1 ? refs.externalRef : `${refs.externalRef}-${lineNo}`.slice(0, 35)
  const startDate = date203FromPortalDate(portalData.agreementStartDateTime, refs.createdLongDate)
  const endDate = portalData.agreementEndDateTime ? date203FromPortalDate(portalData.agreementEndDateTime, refs.createdLongDate) : null
  const reasonForTransaction = sanitizeCode(portalData.reasonForTransaction ?? reasonForProdatSubtype(transactionType), reasonForProdatSubtype(transactionType), 12)
  const meteringMethod = sanitizeCode(portalData.meteringMethod, step.code === 'Z13' ? 'Z04' : '', 12)
  const reportingFrequency = sanitizeCode(portalData.reportingFrequency, step.code === 'Z13' ? 'D' : '', 12)
  const energyProductId = sanitizeCode(portalData.energyProductId ?? portalData.productCode, step.code === 'Z13' ? '8716867000030' : '', 35)
  const installationDirection = step.code === 'Z13' || step.code === 'Z14'
    ? resolvePermissionInstallationDirection({ portalData, step, transactionType })
    : sanitizeCode(portalData.installationDirection, '', 12)
  const permissionPurpose = step.code === 'Z13' || step.code === 'Z14'
    ? permissionPurposeForTransaction(transactionType, portalData.permissionPurpose)
    : sanitizeCode(portalData.permissionPurpose, '', 12)
  const permissionStatus = sanitizeCode(portalData.permissionStatus, step.code === 'Z15' ? 'A75' : '', 12)
  const permissionEndReason = sanitizeCode(portalData.permissionEndReason, step.code === 'Z15' ? 'B79' : step.code === 'Z18' ? 'B80' : '', 12)
  const permissionId = sanitizeCode(portalData.permissionId, '', 35)
  const permissionTimestamp = date203FromPortalDate(portalData.permissionTimestamp, refs.createdLongDate)
  const powerOfAttorneyReference = sanitizeCode(portalData.powerOfAttorneyReference, '', 35)

  const segments: string[] = [`LIN+${lineNo}++${meteringPointId}:::9`]

  if (step.code === 'Z15' || step.code === 'Z18') {
    segments.push(`DTM+93:${endDate ?? startDate}:203`)
  } else {
    segments.push(`DTM+92:${startDate}:203`)
  }

  segments.push('CCI++Z13', `CAV+${reasonForTransaction}`)

  if (meteringMethod) segments.push('CCI++Z04', `CAV+${meteringMethod}`)
  if (reportingFrequency) segments.push('CCI++Z12', `CAV+:::${reportingFrequency}`)
  if (energyProductId) segments.push('CCI++Z14', `CAV+:::${energyProductId}`)
  if (installationDirection) segments.push('CCI++Z22', `CAV+${installationDirection}`)
  if (permissionStatus) segments.push('CCI++Z23', `CAV+${permissionStatus}`)
  if (permissionPurpose) segments.push('CCI++Z24', `CAV+${permissionPurpose}`)
  if (permissionEndReason) segments.push('CCI++Z25', `CAV+${permissionEndReason}`)

  if (!mutation.omitLineItem) segments.push(`RFF+LI:${lineReference}`)
  if (powerOfAttorneyReference && step.code === 'Z13') segments.push(`RFF+ANJ:${powerOfAttorneyReference}`)
  if (gridAreaId) segments.push(`RFF+Z05:${gridAreaId}`)
  if (permissionId && step.code !== 'Z13') segments.push(`RFF+Z07:${permissionId}`)
  if (permissionTimestamp && (step.code === 'Z14' || step.code === 'Z15')) segments.push(`DTM+265:${permissionTimestamp}:203`)

  const siteAddressPlain = sanitize(portalData.siteAddress, '', 70)
  const siteCityPlain = sanitize(portalData.siteCity, '', 35)
  const sitePostalCode = sanitizeCode(portalData.sitePostalCode, '', 12)
  const siteCountry = sanitizeCode(portalData.siteCountry, 'SE', 3)
  const customerId = sanitizeCode(portalData.customerId, '', 35)
  const customerNamePlain = sanitize(portalData.customerName, '', 70)
  if (customerId && customerNamePlain) {
    const customerName = edifactEscape(customerNamePlain)
    const customerAddress = edifactEscape(sanitize(portalData.customerAddress, '', 70))
    const customerCity = edifactEscape(sanitize(portalData.customerCity, '', 35))
    const customerPostalCode = sanitizeCode(portalData.customerPostalCode, '', 12)
    const customerCountry = sanitizeCode(portalData.customerCountry, 'SE', 3)
    segments.push(
      `NAD+UD+${customerId}:${sanitizeCode(portalData.customerIdCodeListQualifier, 'SE2', 8)}:260++${customerName}+${customerAddress}+${customerCity}++${customerPostalCode}+${customerCountry}`
    )
  }

  if (meteringPointId && step.code !== 'Z13') {
    const hasSitePostalDetails = Boolean(siteAddressPlain || siteCityPlain || sitePostalCode)
    segments.push(
      hasSitePostalDetails
        ? `NAD+IT+${meteringPointId}::9+++${edifactEscape(siteAddressPlain)}+${edifactEscape(siteCityPlain)}++${sitePostalCode}+${siteCountry}`
        : `NAD+IT+${meteringPointId}::9`
    )
  }

  return segments
}

function buildProdatLineSegments(params: {
  portalData: TgtPortalCustomerData
  step: EdielTgtExpectedStep
  refs: DraftReferences
  transactionType: string
  mutation: TgtProdatMutation
  lineNo: number
  testSuite: EdielTestSuite
  roleCode: EdielTestRoleCode
  testCaseCode: string
}): string[] {
  const { portalData, step, refs, transactionType, mutation, lineNo } = params
  if (isPermissionProdatCode(step.code)) {
    return buildProdatPermissionLineSegments(params)
  }
  const isZ09 = step.code === 'Z09'
  const isZ09D = isZ09DTransaction(transactionType)
  const startDate = date102FromPortalDate(portalData.agreementStartDateTime, refs.createdLongDate)

  const meteringPointId = sanitizeCode(portalData.meteringPointId, '', 35)
  const customerId = sanitizeCode(portalData.customerId, '', 35)
  const customerNamePlain = sanitize(portalData.customerName, '', 70)
  const customerName = edifactEscape(customerNamePlain)
  const customerAddressPlain = sanitize(portalData.customerAddress, '', 70)
  const customerCityPlain = sanitize(portalData.customerCity, '', 35)
  const customerAddress = edifactEscape(customerAddressPlain)
  const customerCity = edifactEscape(customerCityPlain)
  const customerPostalCode = sanitizeCode(portalData.customerPostalCode, '', 12)
  const customerCountry = sanitizeCode(portalData.customerCountry, 'SE', 3)
  const siteAddressPlain = sanitize(portalData.siteAddress, '', 70)
  const siteCityPlain = sanitize(portalData.siteCity, '', 35)
  const siteAddress = edifactEscape(siteAddressPlain)
  const siteCity = edifactEscape(siteCityPlain)
  const sitePostalCode = sanitizeCode(portalData.sitePostalCode, '', 12)
  const siteCountry = sanitizeCode(portalData.siteCountry, 'SE', 3)
  const lineReference = lineNo === 1 ? refs.externalRef : `${refs.externalRef}-${lineNo}`.slice(0, 35)
  const reasonForTransaction = sanitizeCode(portalData.reasonForTransaction ?? reasonForProdatSubtype(transactionType), 'Z22', 12)
  const meteringMethod = sanitizeCode(portalData.meteringMethod, '', 12)
  const gridAreaId = sanitizeCode(portalData.gridAreaId, '', 12)
  const powerOfAttorneyReference = sanitizeCode(portalData.powerOfAttorneyReference, '', 35)

  const segments: string[] = [`LIN+${lineNo}++${meteringPointId}:::9`]

  if (isZ09) {
    segments.push(...expectedZ09LineDateSegments({ ...portalData, prodatTransactionType: transactionType }, refs))
  } else if (step.code === 'Z05') {
    const endDate = date203FromPortalDate(portalData.agreementEndDateTime ?? fifteenthDayNextMonthDateTime(), refs.createdLongDate)
    segments.push(`DTM+93:${endDate}:203`)
  } else {
    segments.push(`DTM+92:${startDate}0000:203`)
  }

  segments.push('CCI++Z13')
  segments.push(`CAV+${reasonForTransaction}`)

  if (meteringMethod && !(isZ09 && isZ09D)) {
    segments.push('CCI++Z04')
    segments.push(`CAV+${meteringMethod}`)
  }

  if (!mutation.omitLineItem) {
    segments.push(`RFF+LI:${lineReference}`)
  }

  if (gridAreaId) {
    segments.push(`RFF+Z05:${gridAreaId}`)
  }

  if (!isZ09 && powerOfAttorneyReference) {
    segments.push(`RFF+ANJ:${powerOfAttorneyReference}`)
  }

  if (customerId && customerNamePlain && !isZ09D) {
    segments.push(
      `NAD+UD+${customerId}:${sanitizeCode(portalData.customerIdCodeListQualifier, 'SE2', 8)}:260++${customerName}+${customerAddress}+${customerCity}++${customerPostalCode}+${customerCountry}`
    )
  }

  if (!isZ09 && step.code !== 'Z03' && meteringPointId) {
    const hasSitePostalDetails = Boolean(siteAddressPlain || siteCityPlain || sitePostalCode)
    if (hasSitePostalDetails) {
      segments.push(`NAD+IT+${meteringPointId}::9+++${siteAddress}+${siteCity}++${sitePostalCode}+${siteCountry}`)
    } else {
      segments.push(`NAD+IT+${meteringPointId}::9`)
    }
  }

  const balanceResponsibleId = portalData.balanceResponsibleId
  if (balanceResponsibleId) {
    segments.push(`NAD+Z02+${sanitizeCode(balanceResponsibleId, '', 35)}:160:SVK`)
  }

  return segments
}

function buildPortalProdatSegments(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): {
  bodySegments: string[]
  portalData: TgtPortalCustomerData
} {
  const transactionType = buildTgtProdatTransactionType(params, step)
  const mutation = getTgtProdatMutation(params, step)
  const sourceRows = step.code === 'Z03' || (params.roleCode === 'esco' && step.code === 'Z13' && params.testCaseCode === '8.1.1') ? getPortalDataRows(params, step) : [getPortalData(params, step)]
  const portalRows = sourceRows.map((row) => ({
    ...applyProdatMutationToPortalData(row, mutation),
    prodatTransactionType: transactionType,
  }))
  const primaryPortalData = portalRows[0] ?? {
    ...applyProdatMutationToPortalData(getPortalData(params, step), mutation),
    prodatTransactionType: transactionType,
  }

  const bodySegments: string[] = [
    `BGM+${step.code}+${refs.externalRef}+9+AB`,
    `DTM+137:${refs.createdLongDate}${refs.createdTime}:203`,
    'DTM+ZZZ:1:805',
    `NAD+FR+${GRIDEX_EDIEL_ID}:160:SVK+++++++SE`,
    `NAD+DO+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}:160:SVK+++++++SE`,
  ]

  portalRows.forEach((portalData, index) => {
    bodySegments.push(
      ...buildProdatLineSegments({
        portalData,
        step,
        refs,
        transactionType,
        mutation,
        lineNo: index + 1,
        testSuite: params.testSuite,
        roleCode: params.roleCode,
        testCaseCode: params.testCaseCode,
      })
    )
  })

  if (step.code === 'Z06') {
    if (params.testCaseCode === '2.1.1') {
      bodySegments.push('CCI++Z10')
      bodySegments.push(`CAV+${sanitizeCode(primaryPortalData.settlementMethod ?? 'Z32', 'Z32', 12)}`)
      bodySegments.push('CCI++Z04')
      bodySegments.push(`CAV+${sanitizeCode(primaryPortalData.meteringMethod ?? 'Z04', 'Z04', 12)}`)
      bodySegments.push('CCI++Z12')
      bodySegments.push(`CAV+${sanitizeCode(primaryPortalData.reportingFrequency ?? 'D', 'D', 12)}`)
    }

    if (params.testCaseCode === '2.1.2') {
      const register = primaryPortalData.registers[0]
      bodySegments.push('CCI++Z04')
      bodySegments.push(`CAV+${sanitizeCode(primaryPortalData.meteringMethod ?? 'Z04', 'Z04', 12)}`)
      bodySegments.push('CCI++Z08')
      bodySegments.push(`CAV+${sanitizeCode(register?.meterTimeInterval ?? '901', '901', 12)}`)
    }
  }

  return { bodySegments, portalData: primaryPortalData }
}

function buildProdatDraft(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const { bodySegments } = buildPortalProdatSegments(params, step, refs)

  return buildInterchange({
    refs,
    senderEdielId: GRIDEX_EDIEL_ID,
    senderSubAddress: EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
    applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
    family: 'PRODAT',
    version: '26A',
    bodySegments,
  })
}

function buildAckDraft(step: EdielTgtExpectedStep, refs: DraftReferences, params?: Pick<EdielTgtDraftBuildParams, 'roleCode' | 'testCaseCode'>): string {
  const family = step.family === 'UTILTS_ERR' ? 'UTILTS_ERR' : step.family
  const outcome = step.outcome ?? 'positive'
  const isContrl = family === 'CONTRL'
  const isNegative = outcome === 'negative'
  const applicationReference = EDIEL_TGT_PRODAT_APPLICATION_REFERENCE

  const bodySegments = isContrl
    ? [
        isNegative
          ? `UCI+${refs.originalInterchangeRef}+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}:ZZ:PRODAT+${GRIDEX_EDIEL_ID}:ZZ:PRODAT+4`
          : `UCI+${refs.originalInterchangeRef}+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}:ZZ:PRODAT+${GRIDEX_EDIEL_ID}:ZZ:PRODAT+1`,
      ]
    : isNegative
      ? negativeAperakSegments(refs)
      : positiveAperakSegments(refs)

  return buildInterchange({
    refs,
    senderEdielId: GRIDEX_EDIEL_ID,
    senderSubAddress: family === 'APERAK' || family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS : null,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiverSubAddress: family === 'APERAK' || family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
    applicationReference,
    family,
    version: family === 'CONTRL' ? 'D96A' : family === 'UTILTS_ERR' ? 'E5SE5A' : 'E2SE3B',
    bodySegments,
  })
}

function parseTgtNumber(value: string | null | undefined, fallback: string): string {
  const token = firstToken(value)
  if (!token) return fallback
  const normalized = token.replace(',', '.').replace(/[^0-9.\-]/g, '')
  return normalized && /^-?\d+(?:\.\d+)?$/.test(normalized) ? normalized : fallback
}

function buildUtiltsE31SchDraftBody(params: EdielTgtDraftBuildParams, refs: DraftReferences): string[] {
  const gridAreaId = sanitizeCode(
    findTestValue(params, ['nätområdesid', 'natomradesid', 'nätavräkningsområde', 'network area', 'grid area', 'field 239', '239']),
    'SE1',
    35,
  )
  const supplierId = sanitizeCode(
    findTestValue(params, ['leverantör', 'supplier', 'elleverantör', 'balance supplier', 'field 260', '260']),
    GRIDEX_EDIEL_ID,
    35,
  )
  const balanceResponsibleId = sanitizeCode(
    findTestValue(params, ['balansansvarig', 'balance responsible', 'brp', 'field 261', '261']),
    GRIDEX_EDIEL_ID,
    35,
  )
  const shareValue = parseTgtNumber(
    findTestValue(params, ['andelstal', 'slutligt andelstal', 'final share', 'energi', 'energy', 'quantity', 'kwh']),
    '1000',
  )
  const unit = sanitizeCode(findTestValue(params, ['enhet', 'unit', 'kwh']), 'KWH', 8)
  const period = firstToken(findTestValue(params, ['leveransperiod', 'period', 'observationsperiod', 'field 245', '245']))
  const period719 = period && /^\d{24}$/.test(period)
    ? period
    : `${refs.createdLongDate}0000${refs.createdLongDate}2359`

  return [
    `BGM+E31::260+${refs.externalRef}+9+AB`,
    `DTM+137:${refs.createdLongDate}${refs.createdTime}:203`,
    'DTM+735:?+0100:406',
    'MKS+23+E02::260',
    `RFF+TN:${refs.transactionRef}`,
    `NAD+MS+${GRIDEX_EDIEL_ID}:SVK:260`,
    `NAD+MR+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}:SVK:260`,
    'NAD+DDQ',
    `IDE+24+${refs.transactionRef}`,
    `LOC+239+${gridAreaId}:SVK:260`,
    `NAD+DDQ+${supplierId}:SVK:260`,
    `NAD+DDK+${balanceResponsibleId}:SVK:260`,
    `DTM+324:${period719}:719`,
    'DTM+354:1:802',
    'STS+7++E31::260',
    `MEA+AAZ++${unit}`,
    `QTY+136:${shareValue}`,
  ]
}

function buildUtiltsDraft(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const meteringPointId = sanitizeCode(findTestValue(params, ['anläggningsid', 'metering point', 'mätpunkt', 'anlaggningsid']), '735999100000000001', 35)
  const isE31Sch = step.code === 'E31'

  return buildInterchange({
    refs,
    senderEdielId: GRIDEX_EDIEL_ID,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    applicationReference: isE31Sch ? '23-DDQ-E31-S' : '23-DDQ-UTILTS',
    family: 'UTILTS',
    version: 'E5SE5A',
    bodySegments: isE31Sch
      ? buildUtiltsE31SchDraftBody(params, refs)
      : [
          `BGM+${step.code}+${refs.externalRef}+9`,
          `DTM+137:${refs.createdLongDate}:102`,
          `RFF+ACE:${refs.transactionRef}`,
          `NAD+MS+${GRIDEX_EDIEL_ID}::9++GRIDEX`,
          `NAD+MR+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}::9++EDIELPORTALEN`,
          `LOC+172+${meteringPointId}`,
          'QTY+220:1:KWH',
        ],
  })
}

export function getEdielTgtDraftOptionsForCase(
  testSuite: EdielTestSuite,
  roleCode: EdielTestRoleCode,
  testCaseCode: string
): EdielTgtDraftOption[] {
  const definition = getEdielTgtTestCaseByCode(testSuite, roleCode, testCaseCode)
  if (!definition) return []

  return definition.expectedSteps.map((step) => {
    const canGenerate = step.actor === 'gridex'
    return {
      stepNo: step.stepNo,
      label: `Steg ${step.stepNo}: ${step.title}`,
      description: step.description,
      family: step.family,
      code: step.code,
      direction: step.direction,
      outcome: step.outcome ?? null,
      canGenerate,
      disabledReason: canGenerate ? null : 'Detta steg kommer från Edielportalen och ska importeras som inbound-fil.',
    }
  })
}

export function parseEdifactSegments(rawPayload: string): ParsedEdifactSegments {
  const normalized = rawPayload.replace(/^UNA[^']*'/i, '')
  const segments = normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
  const segmentNames = segments.map((segment) => segment.split('+')[0]?.toUpperCase() ?? '')
  const unhIndex = segmentNames.indexOf('UNH')
  const untIndex = segmentNames.indexOf('UNT')
  const unb = segments.find((segment) => segment.toUpperCase().startsWith('UNB+')) ?? null
  const unz = segments.find((segment) => segment.toUpperCase().startsWith('UNZ+')) ?? null
  const unh = unhIndex >= 0 ? segments[unhIndex] : null
  const unt = untIndex >= 0 ? segments[untIndex] : null

  return {
    segments,
    segmentNames,
    unhRef: unh?.split('+')[1] ?? null,
    untRef: unt?.split('+')[2] ?? null,
    untCount: Number(unt?.split('+')[1] ?? NaN) || null,
    countedMessageSegments: unhIndex >= 0 && untIndex >= unhIndex ? untIndex - unhIndex + 1 : null,
    unbRef: unb?.split('+')[5] ?? null,
    unzRef: unz?.split('+')[2] ?? null,
    unzCount: Number(unz?.split('+')[1] ?? NaN) || null,
  }
}

function pushIssue(
  issues: EdielTgtDraftValidationIssue[],
  severity: EdielTgtDraftValidationIssue['severity'],
  code: string,
  title: string,
  description: string
) {
  issues.push({ severity, code, title, description })
}

function prodatStepRequiresRegisterCoverage(step: EdielTgtExpectedStep): boolean {
  if (step.family !== 'PRODAT') return false
  return ['Z04', 'Z06', 'Z10'].includes(String(step.code))
}

function prodatStepRequiresCustomerData(step: EdielTgtExpectedStep): boolean {
  if (step.family !== 'PRODAT') return false

  // Z09-profilen i TGT ska inte tvinga ut SG17/UD. Portalens Z09D-rapport
  // markerar SG17[UD] som not in use. Kunddata kan finnas i testdatat, men ska
  // inte styras ut i denna PRODAT-variant.
  if (step.code === 'Z09') return false

  // S8/S9 är tillståndshantering för energitjänsteföretag. I portalens
  // testdata kan utgående Z13/Z18 sakna fält 227/228 (kund-id/kundnamn), och
  // testet ska då inte blockeras lokalt. Kopplingen görs via Z13/Z14- eller
  // Z18/Z15-kedjan, ärendereferens och portalens testkund.
  if (step.code === 'Z13' || step.code === 'Z18') return false

  return true
}

function prodatStepRequiresMeteringMethod(step: EdielTgtExpectedStep, portalData: TgtPortalCustomerData): boolean {
  if (step.family !== 'PRODAT') return false

  // Z15/Z18 i ESCO-avslutsflödet har ingen mätmetod i portalens testdata.
  // Mätmetod hör till Z13/Z14-tillståndets rapporteringsdefinition, inte själva avslutet.
  if (step.code === 'Z15' || step.code === 'Z18') return false

  // Z09D ska inte använda SG14[Z04]/fält 217. Z09F/Z09G ska däremot fortfarande
  // ha mätmetod enligt profilreglerna ovan.
  if (step.code === 'Z09' && isZ09DTransaction(portalData.prodatTransactionType ?? portalData.reasonForTransaction)) {
    return false
  }

  return true
}

function prodatStepRequiresObjectCoverage(step: EdielTgtExpectedStep): boolean {
  if (step.family !== 'PRODAT') return false

  // Z13 är en tillståndsbegäran från energitjänsteföretag till nätägare.
  // I S8/S9 saknar portalens Z13-testdata ofta anläggnings-id och nätområde.
  // GridCore får därför inte blockera Z13 internt på 209/260; Edielportalen
  // är facit för själva Z13-innehållet. Övriga PRODAT-flöden behåller kravet.
  if (step.code === 'Z13') return false

  return true
}

function validatePortalDataCoverage(
  issues: EdielTgtDraftValidationIssue[],
  rawPayload: string,
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData | null
) {
  if (step.family !== 'PRODAT' || !portalData) return

  const requiresObjectCoverage = prodatStepRequiresObjectCoverage(step)
  const requiredValues = [
    ...(requiresObjectCoverage
      ? [['metering_point_id', portalData.meteringPointId, 'Anläggnings-id saknas i payload.'] as const]
      : []),
    ...(prodatStepRequiresCustomerData(step)
      ? [
          ['customer_id', portalData.customerId, 'Kund-id saknas i payload.'] as const,
          ['customer_name', portalData.customerName, 'Kundnamn saknas i payload.'] as const,
        ]
      : []),
    ...(requiresObjectCoverage
      ? [['grid_area_id', portalData.gridAreaId, 'Nätområde saknas i payload.'] as const]
      : []),
    ...(prodatStepRequiresMeteringMethod(step, portalData)
      ? [['metering_method', portalData.meteringMethod, 'Mätmetod saknas i payload.'] as const]
      : []),
  ] as const

  for (const [code, value, description] of requiredValues) {
    const cleanValue = sanitize(value, '', 70)
    const cleanCodeValue = sanitizeCode(value, '', 70)
    const normalizedPayload = rawPayload.toUpperCase()
    const existsInPayload = Boolean(
      (cleanValue && normalizedPayload.includes(cleanValue.toUpperCase())) ||
      (cleanCodeValue && normalizedPayload.includes(cleanCodeValue.toUpperCase()))
    )

    if (!value || !existsInPayload) {
      pushIssue(issues, 'error', `missing_${code}`, 'Portaltestdata saknas', description)
    }
  }

  if (step.code === 'Z09') {
    const expectedSegments = expectedZ09LineDateSegments(portalData, {
      interchangeRef: '',
      messageRef: '',
      transactionRef: '',
      externalRef: '',
      originalInterchangeRef: '',
      originalMessageRef: '',
      createdDate: '',
      createdTime: '',
      createdLongDate: '',
    })

    for (const segment of expectedSegments) {
      if (!rawPayload.includes(segment)) {
        pushIssue(
          issues,
          'error',
          'missing_z09_line_date',
          'Z09 datumsegment saknas',
          isZ09DTransaction(portalData.prodatTransactionType ?? portalData.reasonForTransaction)
            ? 'Z09D ska använda DTM+92 från 210 Avtal/startdatum och DTM+93 från 211 Avtal/slutdatum om slutdatum finns. Z09D ska inte använda DTM+157.'
            : 'Z09F/Z09G ska använda DTM+157 i SG8. Primärt används 216 Giltighetsdatum. Om 216 saknas används 210 Avtal/startdatum.'
        )
      }
    }

    if (isZ09DTransaction(portalData.prodatTransactionType ?? portalData.reasonForTransaction)) {
      if (rawPayload.includes('DTM+157:')) {
        pushIssue(
          issues,
          'error',
          'z09d_dtm157_not_allowed',
          'Z09D får inte skicka DTM+157',
          'Edielportalen markerar SG8[157] som not in use för Z09D. Använd DTM+92 och DTM+93 i stället.'
        )
      }

      if (rawPayload.includes('CCI++Z04')) {
        pushIssue(
          issues,
          'error',
          'z09d_metering_method_not_allowed',
          'Z09D får inte skicka mätmetod',
          'Z09D-profilen ska inte skicka SG14[Z04]/fält 217. Edielportalen markerar mätmetod som not in use för nytt avtal om mikroproduktion.'
        )
      }

      if (rawPayload.includes('NAD+UD+')) {
        pushIssue(
          issues,
          'error',
          'z09d_customer_party_not_allowed',
          'Z09D får inte skicka elanvändare som UD',
          'Edielportalen markerar SG17[UD] som not in use för Z09D i detta test. Kunddata kan finnas i testdataregistret men ska inte skickas i denna variant.'
        )
      }
    }
  } else if (step.code === 'Z05') {
    const expectedEndDate = date203FromPortalDate(portalData.agreementEndDateTime ?? fifteenthDayNextMonthDateTime(), '')
    if (!rawPayload.includes(`DTM+93:${expectedEndDate}:203`)) {
      pushIssue(
        issues,
        'error',
        'missing_z05_end_date',
        'Z05 slutdatum saknas',
        'Z05 ska använda DTM+93 från fält 211 Avtal/slutdatum. I TGT används 15:e nästkommande månad när testdata anger att datum sätts av avsändaren.'
      )
    }
  } else if (!portalData.agreementStartDateTime) {
    pushIssue(issues, 'error', 'missing_agreement_start_date', 'Avtalsstart saknas', 'Avtalsstart kunde inte hämtas som datum från testdataregistret. Uppdatera underlaget innan filen skickas.')
  }

  if (prodatStepRequiresRegisterCoverage(step)) {
    portalData.registers.forEach((register, index) => {
      const registerNo = index + 1
      if (!register.annualEnergyKwh) {
        pushIssue(issues, 'error', `missing_register_${registerNo}_annual_energy`, 'Registerdata saknas', `Register ${registerNo} saknar uppskattad årsenergi. Uppdatera testdata/underlag innan filen skickas.`)
      }
      if (!register.meterConstant) {
        pushIssue(issues, 'error', `missing_register_${registerNo}_meter_constant`, 'Registerdata saknas', `Register ${registerNo} saknar mätarkonstant.`)
      }
      if (!register.meterDigits) {
        pushIssue(issues, 'error', `missing_register_${registerNo}_meter_digits`, 'Registerdata saknas', `Register ${registerNo} saknar antal siffror för mätare.`)
      }
      if (!register.meterTimeInterval) {
        pushIssue(issues, 'error', `missing_register_${registerNo}_time_interval`, 'Registerdata saknas', `Register ${registerNo} saknar räkneverkskod/tidsintervall.`)
      }
    })

    if (portalData.registers.length > 1 && !rawPayload.includes(portalData.registers[1]?.meterTimeInterval ?? '')) {
      pushIssue(issues, 'error', 'missing_second_register', 'Saknar andra registret', 'Z04D-testet kräver två register från testdataregistret.')
    }
  }
}

export function validateEdielTgtDraft(rawPayload: string, step: EdielTgtExpectedStep, portalData: TgtPortalCustomerData | null = null): EdielTgtDraftValidationIssue[] {
  const issues: EdielTgtDraftValidationIssue[] = []
  const normalized = rawPayload.toUpperCase()
  const parsed = parseEdifactSegments(rawPayload)

  const requiredSegments = ['UNB', 'UNH', 'BGM', 'UNT', 'UNZ']
  for (const segment of requiredSegments) {
    if (!parsed.segmentNames.includes(segment)) {
      pushIssue(issues, 'error', `missing_${segment.toLowerCase()}`, `Saknar ${segment}`, `Utkastet saknar EDIFACT-segmentet ${segment}.`)
    }
  }

  if (parsed.untCount !== null && parsed.countedMessageSegments !== null && parsed.untCount !== parsed.countedMessageSegments) {
    pushIssue(issues, 'error', 'unt_count_mismatch', 'Fel UNT-räkning', `UNT anger ${parsed.untCount} segment men meddelandet innehåller ${parsed.countedMessageSegments} segment från UNH till UNT.`)
  }

  if (parsed.unbRef && parsed.unzRef && parsed.unbRef !== parsed.unzRef) {
    pushIssue(issues, 'error', 'unz_reference_mismatch', 'UNZ matchar inte UNB', 'UNZ-referensen måste vara samma som UNB interchange reference.')
  }

  if (parsed.unbRef && parsed.unbRef.length > 14) {
    pushIssue(issues, 'error', 'interchange_reference_too_long', 'Utväxlingsreferens är för lång', `UNB/0020 är ${parsed.unbRef.length} tecken. TGT-utkast ska hålla UNB/0020 kort, max 14 tecken.`)
  }

  if (parsed.unzRef && parsed.unzRef.length > 14) {
    pushIssue(issues, 'error', 'unz_reference_too_long', 'UNZ-referens är för lång', `UNZ/0020 är ${parsed.unzRef.length} tecken. UNZ ska använda samma korta referens som UNB.`)
  }

  if (parsed.unzCount !== null && parsed.unzCount !== 1) {
    pushIssue(issues, 'warning', 'unz_count_not_one', 'UNZ antal är inte 1', 'Filmotorn skapar ett meddelande per interchange. UNZ bör därför vara 1.')
  }

  if (!normalized.includes(GRIDEX_EDIEL_ID)) {
    pushIssue(issues, 'error', 'missing_sender', 'Saknar Gridex Ediel-ID', `Utkastet ska innehålla Gridex Ediel-ID ${GRIDEX_EDIEL_ID}.`)
  }
  if (!normalized.includes(EDIEL_TGT_TESTSYSTEM_EDIEL_ID)) {
    pushIssue(issues, 'error', 'missing_receiver', 'Saknar Edielportalens test-ID', `Utkastet ska innehålla Edielportalens test-ID ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}.`)
  }
  if (step.family === 'PRODAT' && !normalized.includes(EDIEL_TGT_PRODAT_APPLICATION_REFERENCE)) {
    pushIssue(issues, 'error', 'missing_application_reference', 'Saknar Application Reference', `PRODAT TGT ska använda ${EDIEL_TGT_PRODAT_APPLICATION_REFERENCE}.`)
  }

  if (step.family === 'PRODAT' && (normalized.includes('UNKNOWN') || normalized.includes('999999999999999999'))) {
    const dummySegments = parsed.segments
      .filter((segment) => segment.toUpperCase().includes('UNKNOWN') || segment.includes('999999999999999999'))
      .slice(0, 5)
      .join(' | ')

    pushIssue(
      issues,
      'error',
      'dummy_test_data_detected',
      'Dummydata i PRODAT-utkast',
      `PRODAT till Edielportalen får inte innehålla UNKNOWN eller 999999999999999999. Utkastet måste byggas från portalens testdataregister.${dummySegments ? ` Segment: ${dummySegments}` : ''}`
    )
  }

  if ((step.family === 'PRODAT' || step.family === 'APERAK') && !normalized.includes(EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS)) {
    pushIssue(issues, 'warning', 'missing_prodat_subaddress', 'Kontrollera PRODAT-subadress', `PRODAT TGT ska adresseras mot subadress ${EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}.`)
  }

  if (step.family === 'APERAK' && step.outcome === 'positive' && !normalized.includes('ERC+100')) {
    pushIssue(issues, 'warning', 'aperak_positive_code', 'Kontrollera positiv APERAK', 'Positiv APERAK i TGT brukar använda ERC 100 och OK-text.')
  }

  if ((step.family === 'APERAK' || step.family === 'UTILTS_ERR') && step.outcome === 'negative' && normalized.includes('ERC+100')) {
    pushIssue(issues, 'error', 'aperak_negative_conflict', 'Negativ kvittens ser positiv ut', 'Negativ APERAK/UTILTS-ERR ska inte använda ERC 100 som positiv kvittens.')
  }

  if (step.family === 'CONTRL' && step.outcome === 'positive' && !normalized.includes('+1')) {
    pushIssue(issues, 'warning', 'contrl_positive_check', 'Kontrollera positiv CONTRL', 'Positiv CONTRL ska markera godkänd syntax med UCI/0083 = 1.')
  }

  if (step.family === 'CONTRL' && step.outcome === 'negative' && !normalized.includes('+4')) {
    pushIssue(issues, 'warning', 'contrl_negative_check', 'Kontrollera negativ CONTRL', 'Negativ CONTRL ska markera avvisad syntax med UCI/0083 = 4.')
  }

  validatePortalDataCoverage(issues, rawPayload, step, portalData)

  if (issues.length === 0) {
    pushIssue(issues, 'info', 'draft_ready', 'Utkastet är internt godkänt', 'Intern kontroll hittade inga blockerande fel. Edielportalen är fortfarande facit.')
  }

  return issues
}

export function buildEdielTgtDraft(params: EdielTgtDraftBuildParams): EdielTgtDraftBuildResult {
  const definition = getEdielTgtTestCaseByCode(params.testSuite, params.roleCode, params.testCaseCode)
  if (!definition) throw new Error(`Okänt TGT-testfall: ${params.testSuite}/${params.roleCode}/${params.testCaseCode}`)

  const step = definition.expectedSteps.find((candidate) => candidate.stepNo === params.stepNo)
  if (!step) throw new Error(`Steg ${params.stepNo} finns inte på testfallet ${params.testCaseCode}`)
  if (step.actor !== 'gridex') throw new Error('Detta steg ska komma från Edielportalen och kan inte genereras som Gridex-utkast.')

  const refs = nowRefs(params.testCaseCode, params.stepNo)
  const portalBuild = step.family === 'PRODAT' ? buildPortalProdatSegments(params, step, refs) : null
  const rawPayload = step.family === 'PRODAT'
    ? buildInterchange({
        refs,
        senderEdielId: GRIDEX_EDIEL_ID,
        senderSubAddress: EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS,
        receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
        receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
        applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
        family: 'PRODAT',
        version: '26A',
        bodySegments: portalBuild?.bodySegments ?? [],
      })
    : step.family === 'UTILTS'
      ? buildUtiltsDraft(params, step, refs)
      : buildAckDraft(step, refs, params)

  const validationIssues = validateEdielTgtDraft(rawPayload, step, portalBuild?.portalData ?? null)
  const hasErrors = validationIssues.some((issue) => issue.severity === 'error')
  const messageFamily = step.family as EdielMessageFamily
  const messageVersion = step.family === 'PRODAT'
    ? '26A'
    : step.family === 'UTILTS' || step.family === 'UTILTS_ERR'
      ? 'E5SE5A'
      : step.family === 'APERAK'
        ? 'E2SE3B'
        : 'D96A'
  const fileName = `gridex_tgt_${params.testSuite.toLowerCase()}_${params.testCaseCode.replace(/\./g, '_')}_s${params.stepNo}_${messageFamily.toLowerCase()}_${step.code.toLowerCase()}.edi`

  return {
    step,
    fileName,
    rawPayload,
    validationIssues,
    messageInput: {
      actorUserId: params.actorUserId,
      direction: step.direction,
      messageStandard: 'edifact',
      messageFamily,
      messageCode: step.code,
      messageVersion,
      processType: step.family === 'PRODAT' ? 'tgt_prodat_portal_test' : 'tgt_ack_test',
      environment: 'test',
      testFlag: 1,
      status: hasErrors ? 'draft' : 'prepared',
      transportType: 'manual_upload',
      mailbox: 'tgt-file-engine',
      mailboxMessageId: refs.interchangeRef,
      senderEdielId: GRIDEX_EDIEL_ID,
      senderSubAddress: step.family === 'PRODAT' || step.family === 'APERAK' || step.family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_SENDER_SUB_ADDRESS : null,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      receiverSubAddress: step.family === 'PRODAT' || step.family === 'APERAK' || step.family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
      receiverEmail: '91100@ediel.se',
      subject: `Gridex TGT ${params.testCaseCode} steg ${params.stepNo} ${messageFamily}/${step.code}`,
      fileName,
      mimeType: 'application/EDIFACT',
      interchangeReference: refs.interchangeRef,
      externalReference: refs.externalRef,
      transactionReference: refs.transactionRef,
      applicationReference: step.family === 'PRODAT' || step.family === 'APERAK' || step.family === 'UTILTS_ERR'
        ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE
        : step.family === 'UTILTS' && step.code === 'E31'
          ? '23-DDQ-E31-S'
          : step.family === 'UTILTS'
            ? '23-DDQ-UTILTS'
            : null,
      rawPayload,
      parsedPayload: {
        source: 'tgt_draft_generator_portal_ready_v4',
        testSuite: params.testSuite,
        roleCode: params.roleCode,
        testCaseCode: params.testCaseCode,
        stepNo: params.stepNo,
        expectedTitle: step.title,
        readyForDownload: !hasErrors,
        validationIssues,
        references: refs,
        portalData: portalBuild?.portalData ?? null,
        productionNote:
          'Samma struktur ska i produktion fyllas från kund, anläggning, mätpunkt, fullmakt, avtal och routeprofil i stället för låst portaltestdata.',
      },
      validationReport: {
        source: 'tgt_draft_generator_portal_ready_v4',
        readyForEdielPortal: !hasErrors,
        issues: validationIssues,
        portalDataCoverage: portalBuild?.portalData
          ? {
              testCustomerLabel: portalBuild.portalData.testCustomerLabel,
              meteringPointId: portalBuild.portalData.meteringPointId,
              customerId: portalBuild.portalData.customerId,
              customerName: portalBuild.portalData.customerName,
              customerIdCodeListQualifier: portalBuild.portalData.customerIdCodeListQualifier,
              reasonForTransaction: portalBuild.portalData.reasonForTransaction,
              prodatTransactionType: portalBuild.portalData.prodatTransactionType,
              validityDateTime: portalBuild.portalData.validityDateTime,
              agreementStartDateTime: portalBuild.portalData.agreementStartDateTime,
              agreementEndDateTime: portalBuild.portalData.agreementEndDateTime,
              registerCount: portalBuild.portalData.registers.length,
            }
          : null,
      },
      requiresContrl: step.family !== 'CONTRL',
      requiresAperak: step.family === 'PRODAT' || step.family === 'UTILTS',
      contrlStatus: step.family === 'CONTRL' ? 'not_required' : 'pending',
      aperakStatus: step.family === 'PRODAT' || step.family === 'UTILTS' ? 'pending' : 'not_required',
      utiltsErrStatus: step.family === 'UTILTS' ? 'pending' : 'not_required',
      ackOutcome: step.family === 'APERAK' || step.family === 'CONTRL' || step.family === 'UTILTS_ERR' ? (step.outcome ?? 'positive') : null,
      syntaxCheckStatus: step.family === 'CONTRL' ? (step.outcome === 'negative' ? 'failed' : 'ok') : null,
      functionalCheckStatus: step.family === 'APERAK' || step.family === 'UTILTS_ERR' ? (step.outcome === 'negative' ? 'failed' : 'ok') : null,
      messageCreatedAt: new Date().toISOString(),
    },
  }
}