// lib/ediel/prodat/permissionEngine.ts

import { parseEdifactMessageFacts, type EdifactSegment } from '@/lib/ediel/core/edifactSegments'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import { supabaseService } from '@/lib/supabase/service'


export type ProdatPermissionContext = {
  hasMatchingPriorPermissionFlow: boolean | null
  matchReason: string | null
}

export type ProdatPermissionDecisionIssue = {
  ruleKey: string
  ercCode: string
  fieldCode: string
  text: string
  lineItemReference: string | null
  meteringPointId: string | null
  actualValue: string | null
  expectedValue: string | null
}

export type ProdatPermissionValidationResult = {
  handled: boolean
  outcome: 'positive' | 'negative'
  issues: ProdatPermissionDecisionIssue[]
  applicationErrors: EdielAperakApplicationError[]
  matchedRuleKeys: string[]
  selectedTgtCaseCode: string | null
}

export type ProdatPermissionValidationIssue = {
  ruleKey: string
  severity: 'error' | 'warning' | 'info'
  fieldPath: string | null
  fieldValue: string | null
  expectedValue: string | null
  meteringPointId: string | null
  transactionReference: string | null
  sourceOrder: number
  fallbackText: string
}

type PermissionLineFacts = {
  meteringPointId: string | null
  lineReference: string | null
  customerId: string | null
  agreementReference: string | null
  permissionStatus: string | null
  permissionEndReason: string | null
  rawSegments: string[]
}

type PermissionMessageFacts = {
  messageCode: string
  messageReference: string | null
  interchangeReference: string | null
  globalReferences: Record<string, string[]>
  lines: PermissionLineFacts[]
}

type PermissionMatchResult = {
  matched: boolean
  expectedMessageId: string | null
  expectedReference: string | null
  expectedMeteringPointId: string | null
  expectedCustomerId: string | null
  expectedAgreementReference: string | null
  reason: string
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z]+/g, '')
    .toUpperCase()
}

function sameValue(actual: string | null | undefined, expected: string | null | undefined): boolean {
  const normalizedExpected = normalize(expected)
  if (!normalizedExpected) return true
  return normalize(actual) === normalizedExpected
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function firstComponent(value: string | null | undefined): string | null {
  const first = String(value ?? '').split(':')[0]?.trim() ?? ''
  return first.length > 0 ? first : null
}

function referencesByQualifier(segments: readonly EdifactSegment[]): Record<string, string[]> {
  const refs: Record<string, string[]> = {}

  for (const segment of segments) {
    if (segment.tag !== 'RFF') continue
    const composite = segment.elements[1] ?? ''
    const qualifier = composite.split(':')[0]?.trim().toUpperCase() ?? ''
    const value = composite.split(':')[1]?.trim() ?? ''
    if (!qualifier || !value) continue
    refs[qualifier] = [...(refs[qualifier] ?? []), value]
  }

  return refs
}

function cciCavValue(segments: readonly EdifactSegment[], cciCode: string): string | null {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment?.raw !== `CCI++${cciCode}`) continue

    const next = segments[index + 1]
    if (!next || next.tag !== 'CAV') return null

    const cleaned = next.raw.replace(/^CAV\+/i, '').trim()
    if (!cleaned) return null
    const parts = cleaned.split(':').map((part) => part.trim()).filter(Boolean)
    return parts[parts.length - 1] ?? null
  }

  return null
}

function partyIdFromNad(segments: readonly EdifactSegment[], qualifier: string): string | null {
  const segment = segments.find((item) => item.raw.startsWith(`NAD+${qualifier}+`))
  return firstComponent(segment?.elements[2])
}

function agreementReferenceFromSegments(segments: readonly EdifactSegment[]): string | null {
  const refs = referencesByQualifier(segments)
  return refs.ANJ?.[0] ?? refs.ACW?.[0] ?? null
}


function permissionMessageCode(message: EdielMessageRow): string {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return String(facts.messageCode ?? message.message_code ?? '').toUpperCase()
}

function readPermissionMessageFacts(message: EdielMessageRow): PermissionMessageFacts {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const globalSegments = facts.segments.filter((segment) => {
    if (segment.tag !== 'RFF') return false
    const firstLine = facts.lineItems[0]
    return !firstLine || segment.index < firstLine.segments[0]?.index
  })
  const globalReferences = referencesByQualifier(globalSegments)

  return {
    messageCode: String(facts.messageCode ?? message.message_code ?? '').toUpperCase(),
    messageReference: facts.documentReference ?? message.external_reference ?? null,
    interchangeReference: facts.interchangeReference ?? message.interchange_reference ?? null,
    globalReferences,
    lines: facts.lineItems.map((line) => ({
      meteringPointId: line.itemId ?? null,
      lineReference: line.rffLi ?? null,
      customerId: partyIdFromNad(line.segments, 'UD') ?? partyIdFromNad(line.segments, 'IV'),
      agreementReference: agreementReferenceFromSegments(line.segments),
      permissionStatus: cciCavValue(line.segments, 'Z23'),
      permissionEndReason: cciCavValue(line.segments, 'Z25') ?? cciCavValue(line.segments, 'Z26'),
      rawSegments: line.segments.map((segment) => segment.raw),
    })),
  }
}

function candidateReferences(message: EdielMessageRow, facts: PermissionMessageFacts): string[] {
  return unique([
    message.external_reference,
    message.transaction_reference,
    message.original_transaction_id,
    message.correlation_reference,
    message.interchange_reference,
    facts.messageReference,
    facts.interchangeReference,
    ...Object.values(facts.globalReferences).flat(),
    ...facts.lines.flatMap((line) => [line.lineReference, line.agreementReference]),
  ])
}

function issue(input: Omit<ProdatPermissionValidationIssue, 'severity'> & { severity?: ProdatPermissionValidationIssue['severity'] }): ProdatPermissionValidationIssue {
  return {
    severity: input.severity ?? 'error',
    ruleKey: input.ruleKey,
    fieldPath: input.fieldPath,
    fieldValue: input.fieldValue,
    expectedValue: input.expectedValue,
    meteringPointId: input.meteringPointId,
    transactionReference: input.transactionReference,
    sourceOrder: input.sourceOrder,
    fallbackText: input.fallbackText,
  }
}

async function loadOutboundPermissionRequestCandidates(params: {
  sourceMessage: EdielMessageRow
  expectedOutboundCode: 'Z13' | 'Z18'
}): Promise<EdielMessageRow[]> {
  const query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('direction', 'outbound')
    .eq('message_family', 'PRODAT')
    .eq('message_code', params.expectedOutboundCode)
    .eq('environment', params.sourceMessage.environment)
    .not('status', 'in', '(cancelled,failed,error,rejected)')
    .order('created_at', { ascending: false })
    .limit(100)

  if (params.sourceMessage.receiver_ediel_id) {
    query.eq('sender_ediel_id', params.sourceMessage.receiver_ediel_id)
  }
  if (params.sourceMessage.sender_ediel_id) {
    query.eq('receiver_ediel_id', params.sourceMessage.sender_ediel_id)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as EdielMessageRow[]
}

function scoreCandidate(params: {
  inbound: PermissionMessageFacts
  inboundLine: PermissionLineFacts
  inboundReferences: string[]
  candidate: EdielMessageRow
}): PermissionMatchResult {
  const candidateFacts = readPermissionMessageFacts(params.candidate)
  const candidateReferencesForMessage = new Set(candidateReferences(params.candidate, candidateFacts).map(normalize))
  const inboundRefs = params.inboundReferences.map(normalize).filter(Boolean)
  const referenceMatched = inboundRefs.some((ref) => candidateReferencesForMessage.has(ref))

  const candidateLines = candidateFacts.lines.length > 0 ? candidateFacts.lines : [{
    meteringPointId: params.candidate.metering_point_id,
    lineReference: params.candidate.transaction_reference,
    customerId: params.candidate.customer_id,
    agreementReference: null,
    permissionStatus: null,
    permissionEndReason: null,
    rawSegments: [],
  }]

  for (const candidateLine of candidateLines) {
    const objectMatched = sameValue(params.inboundLine.meteringPointId, candidateLine.meteringPointId)
    const customerMatched = sameValue(params.inboundLine.customerId, candidateLine.customerId)
    const agreementMatched = sameValue(params.inboundLine.agreementReference, candidateLine.agreementReference)

    if (referenceMatched || (objectMatched && customerMatched && agreementMatched)) {
      const missingHardMatch =
        !sameValue(params.inboundLine.meteringPointId, candidateLine.meteringPointId) ||
        !sameValue(params.inboundLine.customerId, candidateLine.customerId)

      return {
        matched: !missingHardMatch,
        expectedMessageId: params.candidate.id,
        expectedReference: candidateFacts.messageReference ?? params.candidate.external_reference,
        expectedMeteringPointId: candidateLine.meteringPointId,
        expectedCustomerId: candidateLine.customerId,
        expectedAgreementReference: candidateLine.agreementReference,
        reason: missingHardMatch ? 'reference_found_but_identity_mismatch' : 'matched_pending_permission_request',
      }
    }
  }

  return {
    matched: false,
    expectedMessageId: null,
    expectedReference: null,
    expectedMeteringPointId: null,
    expectedCustomerId: null,
    expectedAgreementReference: null,
    reason: 'no_match',
  }
}

function bestMatch(params: {
  inbound: PermissionMessageFacts
  inboundLine: PermissionLineFacts
  inboundReferences: string[]
  candidates: EdielMessageRow[]
}): PermissionMatchResult {
  let identityMismatch: PermissionMatchResult | null = null

  for (const candidate of params.candidates) {
    const result = scoreCandidate({ ...params, candidate })
    if (result.matched) return result
    if (result.reason === 'reference_found_but_identity_mismatch' && !identityMismatch) {
      identityMismatch = result
    }
  }

  return identityMismatch ?? {
    matched: false,
    expectedMessageId: null,
    expectedReference: null,
    expectedMeteringPointId: null,
    expectedCustomerId: null,
    expectedAgreementReference: null,
    reason: 'no_active_permission_request_match',
  }
}

export async function resolveProdatPermissionAperakValidationIssues(params: {
  message: EdielMessageRow
}): Promise<ProdatPermissionValidationIssue[]> {
  const family = String(params.message.message_family ?? '').toUpperCase()
  const code = permissionMessageCode(params.message)
  const direction = String(params.message.direction ?? '').toLowerCase()

  if (family !== 'PRODAT' || direction !== 'inbound') return []
  if (code !== 'Z14' && code !== 'Z15') return []

  const inboundFacts = readPermissionMessageFacts(params.message)
  const inboundLines = inboundFacts.lines.length > 0 ? inboundFacts.lines : [{
    meteringPointId: params.message.metering_point_id,
    lineReference: params.message.transaction_reference,
    customerId: params.message.customer_id,
    agreementReference: null,
    permissionStatus: null,
    permissionEndReason: null,
    rawSegments: [],
  }]
  const expectedOutboundCode = code === 'Z14' ? 'Z13' : 'Z18'
  const candidates = await loadOutboundPermissionRequestCandidates({
    sourceMessage: params.message,
    expectedOutboundCode,
  })

  const issues: ProdatPermissionValidationIssue[] = []
  const inboundReferences = candidateReferences(params.message, inboundFacts)
  let sourceOrder = 0

  for (const line of inboundLines) {
    const match = bestMatch({ inbound: inboundFacts, inboundLine: line, inboundReferences, candidates })

    if (match.matched) continue

    if (match.reason === 'reference_found_but_identity_mismatch') {
      if (match.expectedMeteringPointId && !sameValue(line.meteringPointId, match.expectedMeteringPointId)) {
        issues.push(issue({
          ruleKey: 'metering_point_id_mismatch',
          fieldPath: 'PRODAT/PERMISSION/Z07',
          fieldValue: line.meteringPointId,
          expectedValue: match.expectedMeteringPointId,
          meteringPointId: line.meteringPointId,
          transactionReference: line.lineReference ?? inboundFacts.messageReference,
          sourceOrder: sourceOrder++,
          fallbackText: `Felaktigt anläggningsid ${line.meteringPointId ?? ''}`.trim(),
        }))
      }
      if (match.expectedCustomerId && !sameValue(line.customerId, match.expectedCustomerId)) {
        issues.push(issue({
          ruleKey: 'invoice_receiver_invalid',
          fieldPath: 'PRODAT/PERMISSION/NAD+UD',
          fieldValue: line.customerId,
          expectedValue: match.expectedCustomerId,
          meteringPointId: line.meteringPointId,
          transactionReference: line.lineReference ?? inboundFacts.messageReference,
          sourceOrder: sourceOrder++,
          fallbackText: 'Felaktigt kund-id',
        }))
      }
      continue
    }

    issues.push(issue({
      ruleKey: 'facility_not_identified',
      fieldPath: 'PRODAT/PERMISSION/REQUEST_MATCH',
      fieldValue: line.meteringPointId ?? inboundFacts.messageReference,
      expectedValue: expectedOutboundCode,
      meteringPointId: line.meteringPointId,
      transactionReference: line.lineReference ?? inboundFacts.messageReference,
      sourceOrder: sourceOrder++,
      fallbackText: 'The object could not be identified',
    }))
  }

  return issues
}


function normalizedTgtCaseCode(testData: EdielTgtCaseTestData | null | undefined): string | null {
  const code = String(testData?.testCaseCode ?? '').trim().toUpperCase()
  return code.length > 0 ? code : null
}

function firstPermissionLine(facts: PermissionMessageFacts): PermissionLineFacts {
  return facts.lines[0] ?? {
    meteringPointId: null,
    lineReference: null,
    customerId: null,
    agreementReference: null,
    permissionStatus: null,
    permissionEndReason: null,
    rawSegments: [],
  }
}

function permissionDecisionIssue(params: {
  ruleKey: string
  ercCode: string
  fieldCode: string
  text: string
  line: PermissionLineFacts
  actualValue?: string | null
  expectedValue?: string | null
}): ProdatPermissionDecisionIssue {
  return {
    ruleKey: params.ruleKey,
    ercCode: params.ercCode,
    fieldCode: params.fieldCode,
    text: params.text,
    lineItemReference: params.line.lineReference,
    meteringPointId: params.line.meteringPointId,
    actualValue: params.actualValue ?? null,
    expectedValue: params.expectedValue ?? null,
  }
}

function buildPermissionValidationResult(params: {
  handled: boolean
  selectedTgtCaseCode: string | null
  issues: ProdatPermissionDecisionIssue[]
}): ProdatPermissionValidationResult {
  const applicationErrors: EdielAperakApplicationError[] = params.issues.map((item) => ({
    ercCode: item.ercCode,
    fieldCode: item.fieldCode,
    text: item.text,
    referenceQualifier: item.meteringPointId ? 'Z07' : null,
    referenceNumber: item.meteringPointId,
    lineItemReference: item.lineItemReference,
  }))

  return {
    handled: params.handled,
    outcome: applicationErrors.length > 0 ? 'negative' : 'positive',
    issues: params.issues,
    applicationErrors,
    matchedRuleKeys: params.issues.map((item) => item.ruleKey),
    selectedTgtCaseCode: params.selectedTgtCaseCode,
  }
}

function validatePermissionZ14(params: {
  message: EdielMessageRow
  testData?: EdielTgtCaseTestData | null
  context?: ProdatPermissionContext | null
}): ProdatPermissionValidationResult {
  const facts = readPermissionMessageFacts(params.message)
  const line = firstPermissionLine(facts)
  const testCaseCode = normalizedTgtCaseCode(params.testData)
  const status = normalize(line.permissionStatus)
  const issues: ProdatPermissionDecisionIssue[] = []

  if (params.context?.hasMatchingPriorPermissionFlow === false) {
    issues.push(permissionDecisionIssue({
      ruleKey: 'permission_flow_not_found',
      ercCode: '40',
      fieldCode: '105',
      text: 'The object could not be identified',
      line,
      actualValue: line.meteringPointId ?? line.lineReference,
      expectedValue: 'matching Z13 permission request',
    }))
  }

  if (status && !['A13', 'A74', 'A75', 'Z96'].includes(status)) {
    issues.push(permissionDecisionIssue({
      ruleKey: 'permission_status_invalid',
      ercCode: '41',
      fieldCode: '322',
      text: `Felaktigt tillståndets status ${status}`,
      line,
      actualValue: status,
      expectedValue: 'A13/A74/A75/Z96',
    }))
  }

  return buildPermissionValidationResult({ handled: true, selectedTgtCaseCode: testCaseCode, issues })
}

function validatePermissionZ15(params: {
  message: EdielMessageRow
  testData?: EdielTgtCaseTestData | null
  context?: ProdatPermissionContext | null
}): ProdatPermissionValidationResult {
  const facts = readPermissionMessageFacts(params.message)
  const line = firstPermissionLine(facts)
  const testCaseCode = normalizedTgtCaseCode(params.testData)
  const status = normalize(line.permissionStatus)
  const endReason = normalize(line.permissionEndReason)
  const issues: ProdatPermissionDecisionIssue[] = []

  if (status && status !== 'A75') {
    issues.push(permissionDecisionIssue({
      ruleKey: 'permission_status_invalid',
      ercCode: '42',
      fieldCode: '322',
      text: `Felaktigt tillståndets status ${status}`,
      line,
      actualValue: status,
      expectedValue: 'A75',
    }))
  }

  if (endReason && !['B79', 'B80'].includes(endReason)) {
    issues.push(permissionDecisionIssue({
      ruleKey: 'permission_end_reason_invalid',
      ercCode: '42',
      fieldCode: '324',
      text: `Felaktig orsak till tillståndets upphörande ${endReason}`,
      line,
      actualValue: endReason,
      expectedValue: 'B79/B80',
    }))
  }

  if (issues.length === 0 && params.context?.hasMatchingPriorPermissionFlow === false) {
    issues.push(permissionDecisionIssue({
      ruleKey: 'permission_flow_not_found',
      ercCode: '40',
      fieldCode: '105',
      text: 'The object could not be identified',
      line,
      actualValue: line.meteringPointId ?? line.lineReference,
      expectedValue: 'active permission or matching Z18 request',
    }))
  }

  return buildPermissionValidationResult({ handled: true, selectedTgtCaseCode: testCaseCode, issues })
}

export function validateProdatPermissionMessage(params: {
  message: EdielMessageRow
  testData?: EdielTgtCaseTestData | null
  context?: ProdatPermissionContext | null
}): ProdatPermissionValidationResult {
  const family = String(params.message.message_family ?? '').toUpperCase()
  const direction = String(params.message.direction ?? '').toLowerCase()
  const code = permissionMessageCode(params.message)
  const selectedTgtCaseCode = normalizedTgtCaseCode(params.testData)

  if (family !== 'PRODAT' || direction !== 'inbound') {
    return buildPermissionValidationResult({ handled: false, selectedTgtCaseCode, issues: [] })
  }

  if (code === 'Z14') return validatePermissionZ14(params)
  if (code === 'Z15') return validatePermissionZ15(params)

  if (code === 'Z13' || code === 'Z18') {
    return buildPermissionValidationResult({ handled: true, selectedTgtCaseCode, issues: [] })
  }

  return buildPermissionValidationResult({ handled: false, selectedTgtCaseCode, issues: [] })
}
