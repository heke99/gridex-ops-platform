import { describe, expect, it } from 'vitest'
import type { EdielMessageRow, EdielTestRunRow } from '@/lib/ediel/types'
import {
  evaluateEdielTgtRun, getEdielTgtNextAction, getEdielTgtTestCaseByCode,
  getEdielTgtCoverageSummary, getEdielTgtTestCases, getFileEngineTestcaseTemplates,
  matchesExpectedStep, messageOutcome, pickBestStepCandidate, stepIssues, stepStatusRank,
} from '@/lib/ediel/testing/tgtRegistry.part-4'
import type { EdielTgtExpectedStep } from '@/lib/ediel/testing/tgtRegistry'

const run = { id: 'register-run', company_id: 'company-a', test_suite: 'PRODAT', role_code: 'supplier',
  test_case_code: '1.2.5', created_at: '2026-09-01T00:00:00Z' } as EdielTestRunRow
const definition = getEdielTgtTestCaseByCode('PRODAT', 'supplier', '1.2.5')!
const row = (step: EdielTgtExpectedStep, overrides: Partial<EdielMessageRow> = {}): EdielMessageRow => ({
  id: `message-${step.stepNo}`, company_id: run.company_id, direction: step.direction,
  message_family: step.family, message_code: step.code, ack_outcome: step.outcome ?? null,
  environment: 'test', test_flag: 1, status: step.actor === 'gridex' ? 'sent' : 'received',
  created_at: `2026-09-18T00:00:0${step.stepNo}Z`, ...overrides,
} as EdielMessageRow)

// These tests exercise the real run state machine around the two-register Z04D
// flow. They prove workflow transitions, not portal certification or wire validity.
describe('actual TGT workflow surrounding PRODAT register exchange', () => {
  it('resolves trimmed case codes only within the selected role and suite', () => {
    expect(getEdielTgtTestCaseByCode('PRODAT', 'supplier', ' 1.2.5 ')).toBe(definition)
    expect(getEdielTgtTestCaseByCode('PRODAT', 'esco', '1.2.5')).toBeNull()
    expect(getEdielTgtTestCaseByCode('UTILTS', 'supplier', '1.2.5')).toBeNull()
    const copy = getEdielTgtTestCases(); copy.pop()
    expect(getEdielTgtTestCases().length).toBe(copy.length + 1)
    expect(getFileEngineTestcaseTemplates()).toContainEqual(expect.objectContaining({ code: '1.2.5', suite: 'PRODAT' }))
  })
  it('keeps an unmapped run blocked rather than presenting empty steps as complete', () => {
    const result = evaluateEdielTgtRun({ ...run, test_case_code: 'unmapped' }, [])
    expect(result).toMatchObject({ definition: null, computedStatus: 'not_mapped', passedSteps: 0 })
    expect(getEdielTgtNextAction(result)).toMatchObject({ kind: 'not_mapped', canGenerateDraft: false, stepNo: null })
  })
  it('starts by creating Z03 and waits for a real portal response after it is sent', () => {
    const empty = evaluateEdielTgtRun(run, [])
    expect(empty.computedStatus).toBe('not_started')
    expect(getEdielTgtNextAction(empty)).toMatchObject({ kind: 'create_file', stepNo: 1, canGenerateDraft: true })
    const started = evaluateEdielTgtRun(run, [row(definition.expectedSteps[0])])
    expect(started).toMatchObject({ computedStatus: 'in_progress', passedSteps: 1 })
    expect(getEdielTgtNextAction(started)).toMatchObject({ kind: 'import_portal_file', stepNo: 2, canGenerateDraft: false })
  })
  it('never counts an unsent register message as a passed upload step', () => {
    const rows = definition.expectedSteps.map(step => row(step))
    rows[3] = row(definition.expectedSteps[3], { status: 'draft' })
    const result = evaluateEdielTgtRun(run, rows)
    expect(result.computedStatus).toBe('failed')
    expect(result.matches[3]).toMatchObject({ status: 'mismatch', issues: [expect.stringContaining('SMTP')] })
    expect(getEdielTgtNextAction(result)).toMatchObject({ kind: 'fix_mismatch', stepNo: 4, canGenerateDraft: true })
  })
  it('requires distinct messages for repeated acknowledgements and reports completion separately from portal approval', () => {
    const complete = definition.expectedSteps.map(step => row(step))
    const result = evaluateEdielTgtRun(run, complete)
    expect(result).toMatchObject({ computedStatus: 'passed', missingRequiredSteps: 0, passedSteps: 6 })
    expect(new Set(result.matches.map(match => match.message!.id)).size).toBe(6)
    expect(getEdielTgtNextAction(result)).toMatchObject({ kind: 'complete', description: expect.stringContaining('Edielportalens logg') })
    const oneAckMissing = evaluateEdielTgtRun(run, complete.filter(message => message.id !== 'message-5'))
    expect(oneAckMissing.missingRequiredSteps).toBe(1)
    expect(oneAckMissing.computedStatus).not.toBe('passed')
  })
  it('accepts an explicitly linked older message but excludes cancelled and unrelated evidence', () => {
    const older = row(definition.expectedSteps[0], { created_at: '2026-08-31T00:00:00Z' })
    const cancelled = row(definition.expectedSteps[3], { status: 'cancelled' })
    const unrelated = row(definition.expectedSteps[0], { id: 'unknown-family', message_family: 'UNKNOWN' as EdielMessageRow['message_family'] })
    expect(evaluateEdielTgtRun(run, [older, cancelled, unrelated]).passedSteps).toBe(0)
    const linked = evaluateEdielTgtRun(run, [older, cancelled, unrelated], { explicitMessageIds: [older.id] })
    expect(linked.passedSteps).toBe(1)
    expect(linked.matches[0].message?.id).toBe(older.id)
  })
  it('chooses sent evidence over a newer draft and the latest equal-ranked candidate without mutating inputs', () => {
    const step = definition.expectedSteps[0]
    const sent = row(step, { id: 'sent' })
    const draft = row(step, { id: 'draft', status: 'draft', created_at: '2026-09-19' })
    const latest = row(step, { id: 'latest', created_at: '2026-09-20' })
    const candidates = [draft, sent, latest]
    expect(pickBestStepCandidate(candidates, () => true)?.id).toBe('latest')
    expect(candidates).toEqual([draft, sent, latest])
    expect(pickBestStepCandidate(candidates, () => false)).toBeNull()
    expect(pickBestStepCandidate([draft, sent], message => matchesExpectedStep(message, step))).toBe(sent)
  })
  it.each([
    ['sent', 4], ['acknowledged', 4], ['validated', 4], ['failed', 3],
    ['queued', 2], ['prepared', 2], ['draft', 1], ['received', 0],
  ])('orders workflow status %s without treating ranking as success', (status, rank) => {
    expect(stepStatusRank(row(definition.expectedSteps[0], { status: status as EdielMessageRow['status'] }))).toBe(rank)
  })
  it('reports each incompatible direction, family, code and outcome', () => {
    const step = definition.expectedSteps[1]
    const bad = row(step, { direction: 'outbound', message_family: 'PRODAT', message_code: 'Z10', ack_outcome: 'negative' })
    expect(matchesExpectedStep(bad, step)).toBe(false)
    expect(stepIssues(bad, step)).toEqual(expect.arrayContaining([
      expect.stringContaining('riktning'), expect.stringContaining('familj'), expect.stringContaining('kod'), expect.stringContaining('outcome'),
    ]))
    for (const change of [{ direction: 'outbound' }, { message_family: 'PRODAT' }, { message_code: 'Z10' }, { ack_outcome: 'negative' }]) {
      expect(matchesExpectedStep(row(step, change as Partial<EdielMessageRow>), step)).toBe(false)
    }
  })
  it('honors explicit ACK outcomes before non-authoritative check summaries', () => {
    const step = definition.expectedSteps[1]
    expect(messageOutcome(row(step, { ack_outcome: 'negative', syntax_check_status: 'ok' }))).toBe('negative')
    expect(messageOutcome(row(step, { ack_outcome: null, parsed_payload: { ackOutcome: 'negative' }, syntax_check_status: 'ok' }))).toBe('negative')
    expect(messageOutcome(row(step, { ack_outcome: null, syntax_check_status: 'failed' }))).toBe('negative')
    expect(messageOutcome(row(step, { ack_outcome: null, functional_check_status: 'warning' }))).toBe('positive')
    expect(messageOutcome(row(step, { ack_outcome: null }))).toBeNull()
  })
  it('summarizes mapped and missing coverage without treating one green register run as all cases approved', () => {
    const passed = evaluateEdielTgtRun(run, definition.expectedSteps.map(step => row(step)))
    const empty = evaluateEdielTgtRun({ ...run, id: 'empty' }, [])
    const started = evaluateEdielTgtRun({ ...run, id: 'started' }, [row(definition.expectedSteps[0])])
    const unknown = evaluateEdielTgtRun({ ...run, id: 'unknown', test_case_code: 'unknown' }, [])
    expect(getEdielTgtCoverageSummary([passed, empty, started, unknown], [definition])).toMatchObject({
      totalRuns: 4, mappedRuns: 3, passedRuns: 1, failedRuns: 1, inProgressRuns: 1, notStartedRuns: 1, readyForFinalApproval: false,
    })
    expect(getEdielTgtCoverageSummary([passed], [definition]).readyForFinalApproval).toBe(true)
    expect(getEdielTgtCoverageSummary([], [definition])).toMatchObject({ coreCasesWithoutRuns: 1, readyForFinalApproval: false })
    expect(getEdielTgtCoverageSummary([passed]).readyForFinalApproval).toBe(false)
    expect(getEdielTgtCoverageSummary([], []).readyForFinalApproval).toBe(false)
  })
})
