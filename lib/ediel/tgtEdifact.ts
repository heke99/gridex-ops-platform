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
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  GRIDEX_EDIEL_ID,
} from '@/lib/ediel/fileEngine'
import {
  getEdielTgtTestCaseByCode,
  type EdielTgtExpectedStep,
} from '@/lib/ediel/tgtRegistry'
import { getEdielTgtTestDataForCase } from '@/lib/ediel/tgtTestData'

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

type TgtPortalCustomerData = {
  source: 'ediel_portal' | 'embedded_excel'
  testCustomerLabel: string
  meteringPointId: string
  agreementStartDateTime: string
  annualEnergyUnit: string
  meteringMethod: string
  priority?: string | null
  reportingFrequency?: string | null
  meterNumber?: string | null
  customerId: string
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

const PORTAL_TEST_DATA: Record<string, TgtPortalCustomerData> = {
  'PRODAT/supplier/1.2.1': {
    source: 'ediel_portal',
    testCustomerLabel: 'Testkund S1 / 1.2.1 Z03L extra information, ombud',
    meteringPointId: '735999888000000017',
    agreementStartDateTime: '202605150000',
    annualEnergyUnit: 'KWH',
    meteringMethod: 'Z01',
    customerId: '194507018820',
    customerName: 'MARGIT PAULSSON',
    customerAddress: 'STORA VÄGEN 25',
    customerPostalCode: '62020',
    customerCity: 'KLINTEHAMN',
    customerCountry: 'SE',
    birthDate: '19450501',
    billingRecipientId: '10011',
    billingRecipientName: 'CONNY PAULSSON',
    billingRecipientAddress: 'ÅGATAN 145',
    billingRecipientPostalCode: '11543',
    billingRecipientCity: 'STOCKHOLM',
    billingRecipientCountry: 'SE',
    siteAddress: 'VÄDERMYREN 1:22',
    sitePostalCode: '62020',
    siteCity: 'KLINTEHAMN',
    siteCountry: 'SE',
    gridAreaId: 'TES',
    powerOfAttorneyReference: 'AVTAL01',
    balanceResponsibleId: '91109',
    registers: [
      {
        label: 'register_1',
        annualEnergyKwh: '5800',
        meterConstant: '1',
        meterDigits: '6',
        meterTimeInterval: '201',
      },
    ],
  },
  'PRODAT/supplier/1.2.5': {
    source: 'ediel_portal',
    testCustomerLabel: 'Testkund S1 / 1.2.5 Z04D mottagningspliktig mikroproduktion',
    meteringPointId: '735999888000000017',
    agreementStartDateTime: '202605150000',
    annualEnergyUnit: 'KWH',
    meteringMethod: 'Z01',
    priority: 'A',
    reportingFrequency: 'M',
    meterNumber: 'M12345',
    customerId: '194507018820',
    customerName: 'MARGIT PAULSSON',
    customerAddress: 'STORA VÄGEN 25',
    customerPostalCode: '62020',
    customerCity: 'KLINTEHAMN',
    customerCountry: 'SE',
    birthDate: '19450501',
    billingRecipientId: '10011',
    billingRecipientName: 'CONNY PAULSSON',
    billingRecipientAddress: 'ÅGATAN 145',
    billingRecipientPostalCode: '11543',
    billingRecipientCity: 'STOCKHOLM',
    billingRecipientCountry: 'SE',
    siteAddress: 'VÄDERMYREN 1:22',
    sitePostalCode: '62020',
    siteCity: 'KLINTEHAMN',
    siteCountry: 'SE',
    productCode: 'L917',
    settlementMethod: 'Z31',
    gridAreaId: 'TES',
    balanceResponsibleId: '91109',
    installationStatus: 'Z12',
    tariffCode: '25A',
    registers: [
      {
        label: 'register_1',
        annualEnergyKwh: '5800',
        meterConstant: '1',
        meterDigits: '6',
        meterTimeInterval: '201',
        resolution: '1',
      },
      {
        label: 'register_2',
        annualEnergyKwh: '2800',
        meterConstant: '1',
        meterDigits: '6',
        meterTimeInterval: '202',
        resolution: '1',
      },
    ],
  },
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
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

  return {
    interchangeRef: `GX${safeCase}${stepNo}${compact}`.slice(0, 35),
    messageRef: `M${safeCase}${stepNo}${compact}`.slice(0, 14),
    transactionRef: `TGT-${testCaseCode}-S${stepNo}`,
    externalRef: `GRIDEX-${testCaseCode}-S${stepNo}-${compact}`,
    originalInterchangeRef: `PORTAL-${testCaseCode}-S${Math.max(1, stepNo - 1)}`.slice(0, 35),
    originalMessageRef: `P${safeCase}${Math.max(1, stepNo - 1)}${compact}`.slice(0, 14),
    createdDate: `${String(y).slice(2)}${m}${d}`,
    createdTime: `${hh}${mm}`,
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
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
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

function portalKey(params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode'>): string {
  return `${params.testSuite}/${params.roleCode}/${params.testCaseCode}`
}

function findTestValue(
  params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode'>,
  selectors: readonly string[]
): string | null {
  const data = getEdielTgtTestDataForCase(params.testSuite, params.roleCode, params.testCaseCode)
  if (!data) return null
  const normalizedSelectors = selectors.map((selector) => selector.toLowerCase())

  for (const group of data.groups) {
    for (const field of group.fields) {
      const haystack = `${field.fieldCode} ${field.fieldName}`.toLowerCase()
      if (!normalizedSelectors.some((selector) => haystack.includes(selector))) continue
      for (const value of Object.values(field.values)) {
        const trimmed = typeof value === 'string' ? value.trim() : ''
        if (trimmed.length > 0) return trimmed
      }
    }
  }

  return null
}

function getPortalData(params: Pick<EdielTgtDraftBuildParams, 'testSuite' | 'roleCode' | 'testCaseCode'>): TgtPortalCustomerData {
  const hardcoded = PORTAL_TEST_DATA[portalKey(params)]
  if (hardcoded) return hardcoded

  const meteringPointId = sanitizeCode(
    findTestValue(params, ['209 anläggningsid', '209 anlaggningsid', 'metering point', 'mätpunkt']) ??
      findTestValue(params, ['anläggningsid', 'anlaggningsid']),
    '735999100000000001',
    35
  )
  const startDateRaw = firstToken(findTestValue(params, ['210 avtal', 'startdatum', 'leveransstart']))
  const annualEnergyRaw = firstToken(findTestValue(params, ['213 uppskattad årsenergi']))

  return {
    source: 'embedded_excel',
    testCustomerLabel: `TGT ${params.testSuite} ${params.testCaseCode}`,
    meteringPointId,
    agreementStartDateTime: startDateRaw && /^\d{8,12}$/.test(startDateRaw) ? startDateRaw : '',
    annualEnergyUnit: 'KWH',
    meteringMethod: sanitizeCode(findTestValue(params, ['217 mätmetod', '217 matmetod']), 'Z01', 12),
    customerId: sanitizeCode(findTestValue(params, ['227 kund-id', 'personnummer', 'kundidentitet']), '197001010000', 35),
    customerName: sanitize(findTestValue(params, ['228 namn-elanvändare', 'namn', 'kundnamn', 'customer']), 'TEST CUSTOMER'),
    customerAddress: sanitize(findTestValue(params, ['229 adress-elanvändare']), '', 70) || null,
    customerPostalCode: sanitizeCode(findTestValue(params, ['231 postnr-elanvändare']), '', 12) || null,
    customerCity: sanitize(findTestValue(params, ['232 postort-elanvändare']), '', 35) || null,
    customerCountry: sanitizeCode(findTestValue(params, ['316 land-elanvändare']), 'SE', 3),
    siteAddress: sanitize(findTestValue(params, ['234 adress-anläggning', '234 address-anläggning']), '', 70) || null,
    sitePostalCode: sanitizeCode(findTestValue(params, ['235 postnr-anläggning']), '', 12) || null,
    siteCity: sanitize(findTestValue(params, ['236 postort-anläggning']), '', 35) || null,
    siteCountry: sanitizeCode(findTestValue(params, ['237 land-anläggning']), 'SE', 3),
    billingRecipientId: sanitizeCode(findTestValue(params, ['250 fakturamottagare']), '', 35) || null,
    billingRecipientName: sanitize(findTestValue(params, ['251 namn-fakturamottagare']), '', 70) || null,
    billingRecipientAddress: sanitize(findTestValue(params, ['252 adress-fakturamottagare', '252 address-fakturamottagare']), '', 70) || null,
    billingRecipientPostalCode: sanitizeCode(findTestValue(params, ['253 postnr-fakturamottagare', '253 postnr-fakturamottgare']), '', 12) || null,
    billingRecipientCity: sanitize(findTestValue(params, ['317 postort-fakturamottagare']), '', 35) || null,
    billingRecipientCountry: sanitizeCode(findTestValue(params, ['318 land-fakturamottagare']), 'SE', 3),
    birthDate: sanitizeCode(findTestValue(params, ['249 födelsesdatum', '249 födelsedatum']), '', 8) || null,
    gridAreaId: sanitizeCode(findTestValue(params, ['260 nätområdesid', '260 natomradesid']), 'TES', 12),
    powerOfAttorneyReference: sanitizeCode(findTestValue(params, ['261 referens']), '', 35) || null,
    balanceResponsibleId: sanitizeCode(findTestValue(params, ['262 balansansvarig']), '', 35) || null,
    registers: [
      {
        label: 'register_1',
        annualEnergyKwh: annualEnergyRaw && /^\d+$/.test(annualEnergyRaw) ? annualEnergyRaw : '0',
        meterConstant: sanitizeCode(findTestValue(params, ['214 konstant']), '1', 12),
        meterDigits: sanitizeCode(findTestValue(params, ['218 antal siffror']), '6', 12),
        meterTimeInterval: sanitizeCode(findTestValue(params, ['259 mätare, tidsintervall', '259 matare']), '101', 12),
      },
    ],
  }
}

function date102FromPortalDate(value: string | null | undefined, fallback: string): string {
  const token = firstToken(value)
  if (token && /^\d{8,12}$/.test(token)) return token.slice(0, 8)
  return fallback
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

  return `UNB+UNOC:3+${sender}+${receiver}+${params.refs.createdDate}:${params.refs.createdTime}+${params.refs.interchangeRef}+++++${params.applicationReference}+1`
}

function buildUnh(refs: DraftReferences, family: EdielMessageFamily, version: string): string {
  if (family === 'APERAK') return `UNH+${refs.messageRef}+APERAK:D:96A:UN:E2SE3B`
  if (family === 'CONTRL') return `UNH+${refs.messageRef}+CONTRL:D:96A:UN:D96A`
  if (family === 'UTILTS_ERR') return `UNH+${refs.messageRef}+APERAK:D:96A:UN:E5SE5A`
  if (family === 'UTILTS') return `UNH+${refs.messageRef}+UTILTS:D:02B:UN:${version}`
  return `UNH+${refs.messageRef}+PRODAT:D:97A:UN:${version}`
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

function buildTgtProdatTransactionType(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep): string {
  if (params.testCaseCode === '1.2.2') return step.code === 'Z03' ? 'Z03LK' : 'Z04LK'
  if (params.testCaseCode === '1.2.5') return step.code === 'Z04' ? 'Z04D' : `${step.code}D`
  return step.code === 'Z03' ? 'Z03L' : `${step.code}L`
}

function pushOptionalSegment(segments: string[], condition: string | null | undefined, segment: string) {
  if (condition && condition.trim().length > 0) segments.push(segment)
}

function buildPortalProdatSegments(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): {
  bodySegments: string[]
  portalData: TgtPortalCustomerData
} {
  const portalData = getPortalData(params)
  const transactionType = buildTgtProdatTransactionType(params, step)
  const startDate = date102FromPortalDate(portalData.agreementStartDateTime, refs.createdLongDate)
  const meteringPointId = step.outcome === 'negative' ? '999999999999999999' : sanitizeCode(portalData.meteringPointId, 'UNKNOWN', 35)
  const customerName = edifactEscape(sanitize(portalData.customerName, 'TEST CUSTOMER'))
  const billingName = portalData.billingRecipientName ? edifactEscape(sanitize(portalData.billingRecipientName)) : null
  const bodySegments: string[] = [
    `BGM+${step.code}::260+${refs.externalRef}+9`,
    `DTM+137:${refs.createdLongDate}:102`,
    `DTM+7:${startDate}:102`,
    `RFF+TN:${refs.transactionRef}`,
    `RFF+ACE:${refs.transactionRef}`,
    `RFF+Z13:${transactionType}`,
    `NAD+MS+${GRIDEX_EDIEL_ID}::9++GRIDEX`,
    `NAD+MR+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}::9++EDIELPORTALEN`,
    `NAD+UD+${sanitizeCode(portalData.customerId, 'UNKNOWN', 35)}::260++${customerName}`,
  ]

  pushOptionalSegment(bodySegments, portalData.birthDate, `DTM+329:${sanitizeCode(portalData.birthDate, '19000101', 8)}:102`)
  pushOptionalSegment(bodySegments, portalData.customerAddress, `ADR+${edifactEscape(sanitize(portalData.customerAddress))}+${sanitizeCode(portalData.customerPostalCode, '', 12)}+${edifactEscape(sanitize(portalData.customerCity))}+${sanitizeCode(portalData.customerCountry, 'SE', 3)}`)
  bodySegments.push(`LOC+172+${meteringPointId}::9`)
  bodySegments.push(`LOC+239+${sanitizeCode(portalData.gridAreaId, 'TES', 12)}:SVK:260`)
  pushOptionalSegment(bodySegments, portalData.siteAddress, `ADR+${edifactEscape(sanitize(portalData.siteAddress))}+${sanitizeCode(portalData.sitePostalCode, '', 12)}+${edifactEscape(sanitize(portalData.siteCity))}+${sanitizeCode(portalData.siteCountry, 'SE', 3)}`)
  pushOptionalSegment(bodySegments, portalData.powerOfAttorneyReference, `RFF+AHZ:${sanitizeCode(portalData.powerOfAttorneyReference, 'AVTAL01', 35)}`)
  pushOptionalSegment(bodySegments, portalData.balanceResponsibleId, `NAD+DDQ+${sanitizeCode(portalData.balanceResponsibleId, '', 35)}::9++BALANCE RESPONSIBLE`)
  pushOptionalSegment(bodySegments, portalData.meteringMethod, `CCI+++217::260`)
  pushOptionalSegment(bodySegments, portalData.meteringMethod, `CAV+${sanitizeCode(portalData.meteringMethod, 'Z01', 12)}::260`)
  pushOptionalSegment(bodySegments, portalData.priority, `FTX+AAI+++220=${sanitize(portalData.priority, '', 12)}`)
  pushOptionalSegment(bodySegments, portalData.reportingFrequency, `FTX+AAI+++222=${sanitize(portalData.reportingFrequency, '', 12)}`)
  pushOptionalSegment(bodySegments, portalData.meterNumber, `RFF+MG:${sanitizeCode(portalData.meterNumber, '', 35)}`)
  pushOptionalSegment(bodySegments, portalData.productCode, `PIA+5+${sanitizeCode(portalData.productCode, '', 35)}:SA`)
  pushOptionalSegment(bodySegments, portalData.settlementMethod, `FTX+AAI+++254=${sanitizeCode(portalData.settlementMethod, '', 12)}`)
  pushOptionalSegment(bodySegments, portalData.installationStatus, `STS+7++${sanitizeCode(portalData.installationStatus, '', 12)}::260`)
  pushOptionalSegment(bodySegments, portalData.tariffCode, `FTX+AAI+++307=${sanitizeCode(portalData.tariffCode, '', 20)}`)

  if (billingName) {
    bodySegments.push(`NAD+IV+${sanitizeCode(portalData.billingRecipientId, 'UNKNOWN', 35)}::260++${billingName}`)
    pushOptionalSegment(bodySegments, portalData.billingRecipientAddress, `ADR+${edifactEscape(sanitize(portalData.billingRecipientAddress))}+${sanitizeCode(portalData.billingRecipientPostalCode, '', 12)}+${edifactEscape(sanitize(portalData.billingRecipientCity))}+${sanitizeCode(portalData.billingRecipientCountry, 'SE', 3)}`)
  }

  for (const register of portalData.registers) {
    bodySegments.push(`QTY+213:${sanitizeCode(register.annualEnergyKwh, '0', 18)}:${sanitizeCode(portalData.annualEnergyUnit, 'KWH', 8)}`)
    bodySegments.push(`MEA+AAE+214+${sanitizeCode(register.meterConstant, '1', 12)}`)
    bodySegments.push(`FTX+AAI+++218=${sanitizeCode(register.meterDigits, '6', 12)};259=${sanitizeCode(register.meterTimeInterval, '101', 12)}${register.resolution ? `;508B=${sanitizeCode(register.resolution, '1', 12)}` : ''}`)
  }

  bodySegments.push(`FTX+AAI+++TGT ${params.testCaseCode} ${transactionType} ${portalData.testCustomerLabel}`)

  return { bodySegments, portalData }
}

function buildProdatDraft(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const { bodySegments } = buildPortalProdatSegments(params, step, refs)

  return buildInterchange({
    refs,
    senderEdielId: GRIDEX_EDIEL_ID,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
    applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
    family: 'PRODAT',
    version: '26A',
    bodySegments,
  })
}

function buildAckDraft(step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const family = step.family === 'UTILTS_ERR' ? 'UTILTS_ERR' : step.family
  const outcome = step.outcome ?? 'positive'
  const isContrl = family === 'CONTRL'
  const isNegative = outcome === 'negative'
  const applicationReference = family === 'APERAK' || family === 'UTILTS_ERR'
    ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE
    : 'CONTRL'

  const bodySegments = isContrl
    ? [
        isNegative
          ? `UCI+7+${refs.originalInterchangeRef}+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}+${GRIDEX_EDIEL_ID}+7`
          : `UCI+7+${refs.originalInterchangeRef}+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}+${GRIDEX_EDIEL_ID}+4`,
      ]
    : isNegative
      ? negativeAperakSegments(refs)
      : positiveAperakSegments(refs)

  return buildInterchange({
    refs,
    senderEdielId: GRIDEX_EDIEL_ID,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    receiverSubAddress: family === 'APERAK' || family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
    applicationReference,
    family,
    version: family === 'CONTRL' ? 'D96A' : family === 'UTILTS_ERR' ? 'E5SE5A' : 'E2SE3B',
    bodySegments,
  })
}

function buildUtiltsDraft(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const meteringPointId = sanitizeCode(findTestValue(params, ['anläggningsid', 'metering point', 'mätpunkt', 'anlaggningsid']), '735999100000000001', 35)
  return buildInterchange({
    refs,
    senderEdielId: GRIDEX_EDIEL_ID,
    receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
    applicationReference: '23-DDQ-UTILTS',
    family: 'UTILTS',
    version: 'E5SE5A',
    bodySegments: [
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

function validatePortalDataCoverage(
  issues: EdielTgtDraftValidationIssue[],
  rawPayload: string,
  step: EdielTgtExpectedStep,
  portalData: TgtPortalCustomerData | null
) {
  if (step.family !== 'PRODAT' || !portalData) return

  const requiredValues = [
    ['metering_point_id', portalData.meteringPointId, 'Anläggnings-id saknas i payload.'],
    ['customer_id', portalData.customerId, 'Kund-id saknas i payload.'],
    ['customer_name', sanitize(portalData.customerName), 'Kundnamn saknas i payload.'],
    ['grid_area_id', portalData.gridAreaId, 'Nätområde saknas i payload.'],
    ['metering_method', portalData.meteringMethod, 'Mätmetod saknas i payload.'],
  ] as const

  for (const [code, value, description] of requiredValues) {
    if (!value || !rawPayload.toUpperCase().includes(sanitizeCode(value, value).toUpperCase())) {
      pushIssue(issues, 'error', `missing_${code}`, 'Portaltestdata saknas', description)
    }
  }

  if (portalData.registers.length > 1 && !rawPayload.includes(portalData.registers[1]?.meterTimeInterval ?? '')) {
    pushIssue(issues, 'error', 'missing_second_register', 'Saknar andra registret', 'Z04D-testet kräver två register: 201 och 202.')
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
  if ((step.family === 'PRODAT' || step.family === 'APERAK') && !normalized.includes(EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS)) {
    pushIssue(issues, 'warning', 'missing_prodat_subaddress', 'Kontrollera PRODAT-subadress', `PRODAT TGT ska adresseras mot subadress ${EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}.`)
  }
  if (step.family === 'APERAK' && step.outcome === 'positive' && !normalized.includes('ERC+100')) {
    pushIssue(issues, 'warning', 'aperak_positive_code', 'Kontrollera positiv APERAK', 'Positiv APERAK i TGT brukar använda ERC 100 och OK-text.')
  }
  if ((step.family === 'APERAK' || step.family === 'UTILTS_ERR') && step.outcome === 'negative' && normalized.includes('ERC+100')) {
    pushIssue(issues, 'error', 'aperak_negative_conflict', 'Negativ kvittens ser positiv ut', 'Negativ APERAK/UTILTS-ERR ska inte använda ERC 100 som positiv kvittens.')
  }
  if (step.family === 'CONTRL' && step.outcome === 'negative' && !normalized.includes('+7')) {
    pushIssue(issues, 'warning', 'contrl_negative_check', 'Kontrollera negativ CONTRL', 'Negativ CONTRL ska tydligt markera avvisad syntax i UCI/aktionskod.')
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
        receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
        receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
        applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
        family: 'PRODAT',
        version: '26A',
        bodySegments: portalBuild?.bodySegments ?? [],
      })
    : step.family === 'UTILTS'
      ? buildUtiltsDraft(params, step, refs)
      : buildAckDraft(step, refs)

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
      senderSubAddress: null,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      receiverSubAddress: step.family === 'PRODAT' || step.family === 'APERAK' || step.family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
      receiverEmail: '91100@ediel.se',
      subject: `Gridex TGT ${params.testCaseCode} steg ${params.stepNo} ${messageFamily}/${step.code}`,
      fileName,
      mimeType: 'application/EDIFACT',
      interchangeReference: refs.interchangeRef,
      externalReference: refs.externalRef,
      transactionReference: refs.transactionRef,
      applicationReference: step.family === 'PRODAT' || step.family === 'APERAK' || step.family === 'UTILTS_ERR' ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE : null,
      rawPayload,
      parsedPayload: {
        source: 'tgt_draft_generator_portal_ready_v2',
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
        source: 'tgt_draft_generator_portal_ready_v2',
        readyForEdielPortal: !hasErrors,
        issues: validationIssues,
        portalDataCoverage: portalBuild?.portalData
          ? {
              testCustomerLabel: portalBuild.portalData.testCustomerLabel,
              meteringPointId: portalBuild.portalData.meteringPointId,
              customerId: portalBuild.portalData.customerId,
              customerName: portalBuild.portalData.customerName,
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
      syntaxCheckStatus: step.family === 'CONTRL' ? (step.outcome === 'negative' ? 'rejected' : 'accepted') : null,
      functionalCheckStatus: step.family === 'APERAK' || step.family === 'UTILTS_ERR' ? (step.outcome === 'negative' ? 'rejected' : 'accepted') : null,
      messageCreatedAt: new Date().toISOString(),
    },
  }
}
