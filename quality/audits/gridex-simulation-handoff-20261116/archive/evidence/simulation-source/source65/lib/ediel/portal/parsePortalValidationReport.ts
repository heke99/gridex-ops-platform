export type ParsedPortalValidationStep = {
  testCaseCode: string | null
  step: string | null
  expectedAckType: 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | null
  expectedOutcome: 'positive' | 'negative' | null
  expectedErc: string | null
  expectedFtx: string | null
  actualAckType: 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | null
  actualOutcome: 'positive' | 'negative' | null
  actualErc: string | null
  actualFtx: string | null
  diff: string | null
  status: 'passed' | 'failed' | 'warning' | 'unknown'
  raw: string
}

export type ParsedPortalValidationReport = {
  testCaseCode: string | null
  steps: ParsedPortalValidationStep[]
  hasMismatch: boolean
  hasPortalExpectedActualMismatch: boolean
  rawReport: string
}

function normalize(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeUpper(value: unknown): string {
  return normalize(value).toUpperCase()
}

function ackType(text: string): ParsedPortalValidationStep['expectedAckType'] {
  const upper = text.toUpperCase()
  if (upper.includes('UTILTS_ERR') || upper.includes('UTILTS-ERR')) return 'UTILTS_ERR'
  if (upper.includes('APERAK')) return 'APERAK'
  if (upper.includes('CONTRL')) return 'CONTRL'
  return null
}

function outcome(text: string): 'positive' | 'negative' | null {
  const upper = text.toUpperCase()
  if (upper.includes('NEGATIVE') || upper.includes('NEGATIV') || /ERC\+(40|41|42)/.test(upper) || /A902[^0-9]*(40|41|42)/.test(upper)) return 'negative'
  if (upper.includes('POSITIVE') || upper.includes('POSITIV') || /ERC\+100/.test(upper) || /A902[^0-9]*100/.test(upper)) return 'positive'
  return null
}

function firstMatch(text: string, regexes: RegExp[]): string | null {
  for (const regex of regexes) {
    const match = text.match(regex)
    if (match?.[1]) return match[1].trim()
  }
  return null
}

function status(text: string): ParsedPortalValidationStep['status'] {
  const upper = text.toUpperCase()
  if (upper.includes('PASSED') || upper.includes('GODKÄND') || upper.includes('GODKANT')) return 'passed'
  if (upper.includes('FAILED') || upper.includes('MISSLYCK') || upper.includes('FEL')) return 'failed'
  if (upper.includes('WARNING') || upper.includes('VARNING')) return 'warning'
  return 'unknown'
}

function splitSteps(raw: string): string[] {
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) return []
  const byMarkdownTable = text.split(/\n(?=\s*\d+\s*[|\t])/).map((part) => part.trim()).filter(Boolean)
  if (byMarkdownTable.length > 1) return byMarkdownTable
  const byStep = text.split(/\n(?=\s*(?:Steg|Step)\s*\d+)/i).map((part) => part.trim()).filter(Boolean)
  return byStep.length > 1 ? byStep : [text]
}

export function parsePortalValidationReport(rawReport: string): ParsedPortalValidationReport {
  const raw = normalize(rawReport)
  const testCaseCode = firstMatch(raw, [/(?:Testfall|Test case|Case)\s*[:#-]?\s*([A-Z]{0,3}\d+(?:\.\d+)*[A-Z]?)/i, /\b(E\d+|UE\d+|U\d+\.\d+\.\d+[a-z]?)\b/i])
  const steps = splitSteps(raw).map((chunk): ParsedPortalValidationStep => {
    const expectedPart = firstMatch(chunk, [/(?:Förväntat|Expected)([\s\S]*?)(?:Faktiskt|Actual|Payload|Status|$)/i]) ?? chunk
    const actualPart = firstMatch(chunk, [/(?:Faktiskt|Actual)([\s\S]*?)(?:Payload|Status|Diff|$)/i]) ?? chunk
    const diff = firstMatch(chunk, [/(?:diff|skillnad)\s*[:\-]?\s*([^\n]+)/i])
    return {
      testCaseCode,
      step: firstMatch(chunk, [/^\s*(?:Steg|Step)?\s*(\d+)/i]),
      expectedAckType: ackType(expectedPart),
      expectedOutcome: outcome(expectedPart),
      expectedErc: firstMatch(expectedPart, [/ERC\+(\d+)/i, /A902[^0-9]*(\d{2,3})/i]),
      expectedFtx: firstMatch(expectedPart, [/FTX\+AAO\+\+([^+\n]+)/i, /A904[^0-9A-Za-z]*([0-9A-Za-z]+)/i]),
      actualAckType: ackType(actualPart),
      actualOutcome: outcome(actualPart),
      actualErc: firstMatch(actualPart, [/ERC\+(\d+)/i, /A902[^0-9]*(\d{2,3})/i]),
      actualFtx: firstMatch(actualPart, [/FTX\+AAO\+\+([^+\n]+)/i, /A904[^0-9A-Za-z]*([0-9A-Za-z]+)/i]),
      diff,
      status: status(chunk),
      raw: chunk,
    }
  })

  const hasPortalExpectedActualMismatch = steps.some((step) => {
    if (step.status === 'passed') return false
    if (step.expectedOutcome && step.actualOutcome && step.expectedOutcome !== step.actualOutcome) return true
    if (step.expectedErc && step.actualErc && step.expectedErc !== step.actualErc) return true
    return Boolean(step.diff)
  })

  return {
    testCaseCode,
    steps,
    hasMismatch: steps.some((step) => step.status === 'failed' || step.diff),
    hasPortalExpectedActualMismatch,
    rawReport: raw,
  }
}

export function portalValidationReportStorageRows(params: {
  rawReport: string
  edielMessageId?: string | null
  testRunId?: string | null
  companyId?: string | null
}) {
  const parsed = parsePortalValidationReport(params.rawReport)
  return parsed.steps.map((step) => ({
    company_id: params.companyId ?? null,
    ediel_message_id: params.edielMessageId ?? null,
    test_run_id: params.testRunId ?? null,
    test_case_code: step.testCaseCode ?? parsed.testCaseCode,
    step: step.step,
    expected_ack_type: step.expectedAckType,
    expected_outcome: step.expectedOutcome,
    expected_erc: step.expectedErc,
    expected_ftx: step.expectedFtx,
    actual_ack_type: step.actualAckType,
    actual_outcome: step.actualOutcome,
    actual_erc: step.actualErc,
    actual_ftx: step.actualFtx,
    diff: step.diff,
    status: step.status,
    raw_report: step.raw,
    payload: { parser: 'parsePortalValidationReport', reportTestCaseCode: parsed.testCaseCode },
  }))
}
