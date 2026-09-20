import {selectedProdatAckFromPayload,assertSelectedProdatAckReady} from '@/lib/ediel/prodat/prodatIncomingSelectedAck'
import {permissionAckFieldsFromPayload,assertPermissionAckFieldsReady} from '@/lib/ediel/prodat/prodatPermissionAckFields'
import { readProdatParty } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatReferenceEntries, prodatReferenceValue } from '@/lib/ediel/prodat/prodatReferenceFields'
import { prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
// lib/ediel/prodat/permissionEngine.ts

import { parseEdifactMessageFacts, type EdifactSegment } from '@/lib/ediel/core/edifactSegments'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielAperakApplicationError } from '@/lib/ediel/ack'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import { supabaseService } from '@/lib/supabase/service'


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
  selectedFieldAssessment?: ReturnType<typeof selectedProdatAckFromPayload>
  fieldAssessment?: ReturnType<typeof permissionAckFieldsFromPayload>
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

function samePartyValue(actual: string | null | undefined, expected: string | null | undefined): boolean {
  // Preserve the existing optional-match contract, but never fold case or
  // punctuation in a supplied distributor-assigned customer identity.
  const target = String(expected ?? '').trim()
  return !target || String(actual ?? '').trim() === target
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}


function referencesByQualifier(segments: readonly EdifactSegment[], una: EdifactServiceStringAdvice): Record<string, string[]> {
  const refs: Record<string, string[]> = {}
  for (const { qualifier, value } of prodatReferenceEntries(segments, una)) {
    refs[qualifier] = [...(refs[qualifier] ?? []), value]
  }
  return refs
}


function permissionMessageCode(message: EdielMessageRow): string {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const hasWire = Boolean(message.raw_payload?.trim())
  return String(hasWire ? facts.messageCode ?? '' : message.message_code ?? '').toUpperCase()
}

function readPermissionMessageFacts(message: EdielMessageRow): PermissionMessageFacts {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  const una = parseUna(message.raw_payload)
  const hasWire = Boolean(message.raw_payload?.trim())
  const firstLineIndex = facts.segments.findIndex(segment => segment.tag === 'LIN')
  const globalSegments = firstLineIndex < 0 ? facts.segments : facts.segments.slice(0, firstLineIndex)
  const globalReferences = referencesByQualifier(globalSegments, una)

  return {
    messageCode: String(hasWire ? facts.messageCode ?? '' : message.message_code ?? '').toUpperCase(),
    messageReference: hasWire ? facts.documentReference : message.external_reference ?? null,
    interchangeReference: facts.interchangeReference ?? message.interchange_reference ?? null,
    globalReferences,
    lines: facts.lineItems.map((line) => ({
      meteringPointId: line.itemId ?? null,
      lineReference: line.rffLi ?? null,
      customerId: readProdatParty('UD', line.segments, una).identityValid ? readProdatParty('UD', line.segments, una).id : null,
      agreementReference: prodatReferenceValue('261', line.segments, una),
      permissionStatus: prodatCharacteristicValue('322', line.segments, parseUna(message.raw_payload)),
      permissionEndReason: prodatCharacteristicValue('324', line.segments, parseUna(message.raw_payload)),
      rawSegments: line.segments.map((segment) => segment.raw),
    })),
  }
}

function candidateReferences(message: EdielMessageRow, facts: PermissionMessageFacts): string[] {
  return unique([
    facts.messageReference,
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
  const companyId = params.sourceMessage.company_id?.trim()
  if (!companyId) throw new Error('prodat_permission_company_scope_required')
  const query = supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('company_id', companyId)
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
  // A privileged reader must never correlate a party identity across tenants.
  return ((data ?? []) as EdielMessageRow[]).filter(candidate => candidate.company_id === companyId)
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

  const candidateHasWire = Boolean(params.candidate.raw_payload?.trim())
  const candidateLines = candidateFacts.lines.length > 0 ? candidateFacts.lines : candidateHasWire ? [] : [{
    meteringPointId: params.candidate.metering_point_id,
    lineReference: params.candidate.transaction_reference,
    customerId: params.candidate.customer_id,
    agreementReference: null,
    permissionStatus: null,
    permissionEndReason: null,
    rawSegments: [],
  }]

  for (const candidateLine of candidateLines) {
    // Missing/malformed wire NAD must not turn into the legacy optional-match
    // wildcard. Structured-only legacy input retains its previous contract.
    if (candidateHasWire && !candidateLine.customerId) continue
    const objectMatched = sameValue(params.inboundLine.meteringPointId, candidateLine.meteringPointId)
    const customerMatched = samePartyValue(params.inboundLine.customerId, candidateLine.customerId)
    const agreementMatched = sameValue(params.inboundLine.agreementReference, candidateLine.agreementReference)

    if (referenceMatched || (objectMatched && customerMatched && agreementMatched)) {
      const missingHardMatch =
        !sameValue(params.inboundLine.meteringPointId, candidateLine.meteringPointId) ||
        !samePartyValue(params.inboundLine.customerId, candidateLine.customerId)

      return {
        matched: !missingHardMatch,
        expectedMessageId: params.candidate.id,
        expectedReference: candidateFacts.messageReference,
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
      if (match.expectedCustomerId && !samePartyValue(line.customerId, match.expectedCustomerId)) {
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

export function validateProdatPermissionMessage(params: {
  message: EdielMessageRow
  testData?: EdielTgtCaseTestData | null
}): ProdatPermissionValidationResult {
  const family = String(params.message.message_family ?? '').toUpperCase()
  const direction = String(params.message.direction ?? '').toLowerCase()
  const selectedTgtCaseCode = normalizedTgtCaseCode(params.testData)
  if (family !== 'PRODAT' || direction !== 'inbound') return buildPermissionValidationResult({handled:false,selectedTgtCaseCode,issues:[]})
  const selected=selectedProdatAckFromPayload(params.message.raw_payload)
  const assessment=permissionAckFieldsFromPayload(params.message.raw_payload)
  try { assertSelectedProdatAckReady(selected) } catch(error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {permissionFieldAssessment:assessment})
  }
  try { assertPermissionAckFieldsReady(assessment) } catch(error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {selectedFieldAssessment:selected})
  }
  const code=assessment.code
  const issues:ProdatPermissionDecisionIssue[]=[...assessment.applicationErrors,...selected.applicationErrors].map(error=>({
    ruleKey:['322','324'].includes(error.fieldCode??'')?`permission_${error.fieldCode === '322' ? 'status' : 'end_reason'}_${error.ercCode === '41' ? 'missing' : 'invalid'}`:`selected_${error.fieldCode}_${error.ercCode}`,
    ercCode:error.ercCode,fieldCode:error.fieldCode!,text:error.text ?? '',
    lineItemReference:error.lineItemReference??null,meteringPointId:error.referenceNumber??null,
    actualValue:error.prodatFieldDiagnostic?.kind==='field'?error.prodatFieldDiagnostic.failureEvidence?.map(e=>e.content).join(' / ')??null:null,expectedValue:null,
  }))
  const result=buildPermissionValidationResult({handled:['Z13','Z14','Z15','Z18'].includes(code),selectedTgtCaseCode,issues})
  result.applicationErrors=[...assessment.applicationErrors,...selected.applicationErrors]
  if(selected.applicationErrors.length)result.outcome='negative'
  return {...result,fieldAssessment:assessment,selectedFieldAssessment:selected}
}
