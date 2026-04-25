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
  createdDate: string
  createdTime: string
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
    createdDate: `${String(y).slice(2)}${m}${d}`,
    createdTime: `${hh}${mm}`,
  }
}

function sanitize(value: string | null | undefined, fallback = 'UNKNOWN'): string {
  const trimmed = value?.trim()
  if (!trimmed) return fallback
  return trimmed
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
    .replace(/[^A-Za-z0-9 ._\-/]/g, '')
    .slice(0, 70)
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

function edifact(...segments: string[]): string {
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

function buildUnt(refs: DraftReferences, segmentCount: number): string {
  return `UNT+${segmentCount}+${refs.messageRef}`
}

function buildUnz(refs: DraftReferences): string {
  return `UNZ+1+${refs.interchangeRef}`
}

function positiveAperakText(): string[] {
  return ['BGM+313+APERAK+34', 'ERC+100', 'FTX+AAO+++OK']
}

function negativeAperakText(): string[] {
  return ['BGM+313+APERAK+40', 'ERC+105', 'FTX+AAO+++The object could not be identified']
}

function buildProdatDraft(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const meteringPointId = step.outcome === 'negative'
    ? '999999999999999999'
    : sanitize(findTestValue(params, ['anläggningsid', 'metering point', 'mätpunkt']), '735999100000000001')
  const customerName = sanitize(findTestValue(params, ['namn', 'kundnamn', 'customer']), 'TEST CUSTOMER')
  const personalNumber = sanitize(findTestValue(params, ['personnummer', 'kundidentitet', 'customer id']), '197001010000')
  const startDate = sanitize(findTestValue(params, ['startdatum', 'leveransstart', 'fråndatum']), '20260401')
  const transactionType = step.code === 'Z03' ? 'Z03L' : `${step.code}L`

  const body = [
    buildUnb({
      refs,
      senderEdielId: GRIDEX_EDIEL_ID,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      receiverSubAddress: EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
      applicationReference: EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
    }),
    buildUnh(refs, 'PRODAT', '26A'),
    `BGM+${step.code}+${refs.externalRef}+9`,
    `DTM+137:${startDate}:102`,
    `RFF+ACE:${refs.transactionRef}`,
    `RFF+Z13:${transactionType}`,
    `NAD+MS+${GRIDEX_EDIEL_ID}::9++GRIDEX`,
    `NAD+MR+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}::9++EDIELPORTALEN`,
    `NAD+UD+++${customerName}`,
    `RFF+Z01:${personalNumber}`,
    `LOC+172+${meteringPointId}`,
  ]
  body.push(buildUnt(refs, body.length + 1), buildUnz(refs))
  return edifact(...body)
}

function buildAckDraft(step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const family = step.family === 'UTILTS_ERR' ? 'UTILTS_ERR' : step.family
  const outcome = step.outcome ?? 'positive'
  const ackBody = family === 'CONTRL'
    ? [
        outcome === 'positive' ? 'UCI+7+INTERCHANGE+21660+91100+4' : 'UCI+7+INTERCHANGE+21660+91100+7',
      ]
    : outcome === 'negative'
      ? negativeAperakText()
      : positiveAperakText()

  const body = [
    buildUnb({
      refs,
      senderEdielId: GRIDEX_EDIEL_ID,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      receiverSubAddress: step.family === 'APERAK' ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
      applicationReference: step.family === 'APERAK' ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE : 'CONTRL',
    }),
    buildUnh(refs, family, family === 'CONTRL' ? 'D96A' : 'E2SE3B'),
    ...ackBody,
  ]
  body.push(buildUnt(refs, body.length + 1), buildUnz(refs))
  return edifact(...body)
}

function buildUtiltsDraft(params: EdielTgtDraftBuildParams, step: EdielTgtExpectedStep, refs: DraftReferences): string {
  const meteringPointId = sanitize(findTestValue(params, ['anläggningsid', 'metering point', 'mätpunkt']), '735999100000000001')
  const body = [
    buildUnb({
      refs,
      senderEdielId: GRIDEX_EDIEL_ID,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      applicationReference: '23-DDQ-UTILTS',
    }),
    buildUnh(refs, 'UTILTS', 'E5SE5A'),
    `BGM+${step.code}+${refs.externalRef}+9`,
    `DTM+137:${new Date().toISOString().slice(0, 10).replace(/-/g, '')}:102`,
    `RFF+ACE:${refs.transactionRef}`,
    `NAD+MS+${GRIDEX_EDIEL_ID}::9++GRIDEX`,
    `NAD+MR+${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}::9++EDIELPORTALEN`,
    `LOC+172+${meteringPointId}`,
    'QTY+220:1:KWH',
  ]
  body.push(buildUnt(refs, body.length + 1), buildUnz(refs))
  return edifact(...body)
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

export function validateEdielTgtDraft(rawPayload: string, step: EdielTgtExpectedStep): EdielTgtDraftValidationIssue[] {
  const issues: EdielTgtDraftValidationIssue[] = []
  const normalized = rawPayload.toUpperCase()

  const requiredSegments = ['UNB+', 'UNH+', 'BGM+', 'UNT+', 'UNZ+']
  for (const segment of requiredSegments) {
    if (!normalized.includes(segment)) {
      issues.push({
        severity: 'error',
        code: `missing_${segment.replace('+', '').toLowerCase()}`,
        title: `Saknar ${segment.replace('+', '')}`,
        description: `Utkastet saknar EDIFACT-segmentet ${segment.replace('+', '')}.`,
      })
    }
  }

  if (!normalized.includes(GRIDEX_EDIEL_ID)) {
    issues.push({ severity: 'error', code: 'missing_sender', title: 'Saknar Gridex Ediel-ID', description: `Utkastet ska innehålla Gridex Ediel-ID ${GRIDEX_EDIEL_ID}.` })
  }
  if (!normalized.includes(EDIEL_TGT_TESTSYSTEM_EDIEL_ID)) {
    issues.push({ severity: 'error', code: 'missing_receiver', title: 'Saknar Edielportalens test-ID', description: `Utkastet ska innehålla Edielportalens test-ID ${EDIEL_TGT_TESTSYSTEM_EDIEL_ID}.` })
  }
  if (step.family === 'PRODAT' && !normalized.includes(EDIEL_TGT_PRODAT_APPLICATION_REFERENCE)) {
    issues.push({ severity: 'error', code: 'missing_application_reference', title: 'Saknar Application Reference', description: `PRODAT TGT ska använda ${EDIEL_TGT_PRODAT_APPLICATION_REFERENCE}.` })
  }
  if (step.family === 'PRODAT' && !normalized.includes(EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS)) {
    issues.push({ severity: 'warning', code: 'missing_prodat_subaddress', title: 'Kontrollera PRODAT-subadress', description: `PRODAT TGT ska adresseras mot subadress ${EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}.` })
  }
  if (step.family === 'APERAK' && step.outcome === 'positive' && !normalized.includes('ERC+100')) {
    issues.push({ severity: 'warning', code: 'aperak_positive_code', title: 'Kontrollera positiv APERAK', description: 'Positiv APERAK i TGT brukar använda ERC 100 och OK-text.' })
  }
  if (step.family === 'APERAK' && step.outcome === 'negative' && normalized.includes('ERC+100')) {
    issues.push({ severity: 'error', code: 'aperak_negative_conflict', title: 'Negativ APERAK ser positiv ut', description: 'Negativ APERAK ska inte använda ERC 100 som positiv kvittens.' })
  }

  if (issues.length === 0) {
    issues.push({ severity: 'info', code: 'draft_ready', title: 'Utkastet är internt godkänt', description: 'Intern kontroll hittade inga blockerande fel. Edielportalen är fortfarande facit.' })
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
  const rawPayload = step.family === 'PRODAT'
    ? buildProdatDraft(params, step, refs)
    : step.family === 'UTILTS'
      ? buildUtiltsDraft(params, step, refs)
      : buildAckDraft(step, refs)

  const validationIssues = validateEdielTgtDraft(rawPayload, step)
  const hasErrors = validationIssues.some((issue) => issue.severity === 'error')
  const messageFamily = step.family as EdielMessageFamily
  const messageVersion = step.family === 'PRODAT'
    ? '26A'
    : step.family === 'UTILTS' || step.family === 'UTILTS_ERR'
      ? 'E5SE5A'
      : step.family === 'APERAK'
        ? 'E2SE3B'
        : 'D96A'

  return {
    step,
    fileName: `gridex_tgt_${params.testSuite.toLowerCase()}_${params.testCaseCode.replace(/\./g, '_')}_s${params.stepNo}_${messageFamily.toLowerCase()}_${step.code.toLowerCase()}.edi`,
    rawPayload,
    validationIssues,
    messageInput: {
      actorUserId: params.actorUserId,
      direction: step.direction,
      messageStandard: 'edifact',
      messageFamily,
      messageCode: step.code,
      messageVersion,
      environment: 'test',
      testFlag: 1,
      status: hasErrors ? 'draft' : 'prepared',
      transportType: 'manual_upload',
      mailbox: 'tgt-file-engine',
      mailboxMessageId: refs.interchangeRef,
      senderEdielId: GRIDEX_EDIEL_ID,
      senderSubAddress: null,
      receiverEdielId: EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
      receiverSubAddress: step.family === 'PRODAT' || step.family === 'APERAK' ? EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS : null,
      receiverEmail: '91100@ediel.se',
      subject: `Gridex TGT ${params.testCaseCode} steg ${params.stepNo} ${messageFamily}/${step.code}`,
      fileName: `gridex_tgt_${params.testCaseCode.replace(/\./g, '_')}_s${params.stepNo}.edi`,
      mimeType: 'application/EDIFACT',
      interchangeReference: refs.interchangeRef,
      externalReference: refs.externalRef,
      transactionReference: refs.transactionRef,
      applicationReference: step.family === 'PRODAT' || step.family === 'APERAK' ? EDIEL_TGT_PRODAT_APPLICATION_REFERENCE : null,
      rawPayload,
      parsedPayload: {
        source: 'batch_4d_tgt_draft_generator',
        testSuite: params.testSuite,
        roleCode: params.roleCode,
        testCaseCode: params.testCaseCode,
        stepNo: params.stepNo,
        expectedTitle: step.title,
        validationIssues,
      },
      validationReport: {
        source: 'batch_4d_tgt_draft_generator',
        readyForEdielPortal: !hasErrors,
        issues: validationIssues,
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
