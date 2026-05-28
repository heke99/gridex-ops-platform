// lib/ediel/rulebook/testRunner.ts

import { supabaseService } from '@/lib/supabase/service'
import { deriveRulebookAckDecision } from '@/lib/ediel/rulebook/ackRules'
import { expectedApplicationReferenceForProcess, getBusinessProcessForMessage, getRulebookMessageRule, type RulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { RULEBOOK_TEST_CASES, matchRulebookTestCase, type RulebookTestCaseDefinition } from '@/lib/ediel/rulebook/testCaseMatcher'
import { validateRawPayloadWithRulebook } from '@/lib/ediel/rulebook/validator'

export type RulebookTestRunSummary = {
  testCase: RulebookTestCaseDefinition
  status: 'passed' | 'failed' | 'manual_review'
  issues: Array<{ severity: string; code: string; title: string; description: string }>
}

export type RulebookRegressionResult = {
  testRunId: string | null
  status: 'passed' | 'failed'
  total: number
  passed: number
  failed: number
  issues: RulebookIssue[]
}

function issue(severity: RulebookIssue['severity'], code: string, title: string, description: string): RulebookIssue {
  return { severity, code, title, description }
}

function normalize(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase()
}

function expectedMatches(actual: boolean, expected: RulebookTestCaseDefinition['expectedContrl'] | RulebookTestCaseDefinition['expectedAperak']): boolean {
  if (expected === 'depends') return true
  if (expected === 'not_expected') return !actual
  if (expected === 'positive' || expected === 'negative') return actual
  return true
}

function utiltsErrMatches(actual: boolean, expected: RulebookTestCaseDefinition['expectedUtiltsErr']): boolean {
  if (expected === 'depends') return true
  if (expected === 'expected') return actual
  return !actual
}

export async function createRulebookTestRun(params: {
  companyId?: string | null
  actorProfileId?: string | null
  testCaseCode: string
  createdBy: string
  environment?: 'test' | 'production'
  status?: 'draft' | 'running' | 'passed' | 'failed' | 'cancelled'
  title?: string | null
  notes?: Record<string, unknown>
}): Promise<string | null> {
  const testCase = RULEBOOK_TEST_CASES.find((item) => item.testCaseCode === params.testCaseCode)
  if (!testCase) return null

  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .insert({
      company_id: params.companyId ?? null,
      actor_profile_id: params.actorProfileId ?? null,
      environment: params.environment ?? 'test',
      test_suite: testCase.suite.includes('UTILTS') ? 'UTILTS' : testCase.suite.includes('AI') ? 'AI_LIST' : testCase.suite.includes('NBS') ? 'NBS_XML' : 'PRODAT',
      role_code: testCase.actorRole === 'energy_service_company' ? 'esco' : testCase.actorRole === 'grid_owner' ? 'grid_owner' : 'supplier',
      test_case_code: testCase.testCaseCode,
      status: params.status ?? 'draft',
      title: params.title ?? testCase.name,
      approval_version: 'rulebook-2026A',
      started_at: (params.status ?? 'draft') === 'running' ? new Date().toISOString() : null,
      notes: JSON.stringify({
        createdBy: params.createdBy,
        environment: params.environment ?? 'test',
        actorProfileId: params.actorProfileId ?? null,
        expectedContrl: testCase.expectedContrl,
        expectedAperak: testCase.expectedAperak,
        expectedUtiltsErr: testCase.expectedUtiltsErr,
        rulebook: true,
        ...(params.notes ?? {}),
      }),
      created_by: params.createdBy,
      updated_by: params.createdBy,
    })
    .select('id')
    .single()

  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
}

export function runRulebookValidationForPayload(rawPayload: string): RulebookTestRunSummary[] {
  const result = validateRawPayloadWithRulebook(rawPayload)
  const candidates = matchRulebookTestCase(rawPayload)
  const fallbackCandidates = candidates.length > 0 ? candidates : RULEBOOK_TEST_CASES.filter((testCase) => {
    if (testCase.family !== result.parsed.family) return false
    if (testCase.messageCode !== result.parsed.messageCode) return false
    return true
  })

  const status = result.status === 'failed' ? 'failed' : result.status === 'warning' ? 'manual_review' : 'passed'
  return fallbackCandidates.map((testCase) => ({
    testCase,
    status,
    issues: result.issues,
  }))
}

export async function createRulebookPayloadValidationRun(params: {
  rawPayload: string
  createdBy: string
  companyId?: string | null
  title?: string | null
}): Promise<{ testRunId: string | null; artifactId: string | null; summaries: RulebookTestRunSummary[] }> {
  const parsed = parseRulebookMessage(params.rawPayload)
  const validation = validateRawPayloadWithRulebook(params.rawPayload)
  const summaries = runRulebookValidationForPayload(params.rawPayload)
  const primary = summaries[0]?.testCase
  const status = validation.status === 'failed' ? 'failed' : validation.status === 'warning' ? 'running' : 'passed'

  const { data: run, error: runError } = await supabaseService
    .from('ediel_test_runs')
    .insert({
      company_id: params.companyId ?? null,
      test_suite: parsed.family === 'UTILTS' ? 'UTILTS' : parsed.family === 'AI_LIST' ? 'AI_LIST' : parsed.family === 'BI_LIST' ? 'AI_LIST' : parsed.family === 'PRODAT' ? 'PRODAT' : 'OTHER',
      role_code: primary?.actorRole === 'energy_service_company' ? 'esco' : primary?.actorRole === 'grid_owner' ? 'grid_owner' : 'supplier',
      test_case_code: primary?.testCaseCode ?? 'RULEBOOK_PARSE',
      title: params.title ?? `Rulebook parser ${parsed.family}/${parsed.messageCode ?? '—'}`,
      status,
      approval_version: 'rulebook-2026A',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      failure_reason: validation.status === 'failed' ? validation.issues.map((item) => item.title).join(', ') : null,
      notes: JSON.stringify({
        rulebookParser: true,
        matchedCases: summaries.map((item) => item.testCase.testCaseCode),
        parsed,
      }),
      created_by: params.createdBy,
      updated_by: params.createdBy,
    })
    .select('id')
    .single()

  if (runError) throw runError
  const testRunId = typeof run?.id === 'string' ? run.id : null

  const { data: artifact, error: artifactError } = await supabaseService
    .from('ediel_test_artifacts')
    .insert({
      test_run_id: testRunId,
      artifact_type: 'parser_validation',
      title: params.title ?? `Parser/validering ${parsed.family}/${parsed.messageCode ?? '—'}`,
      raw_payload: params.rawPayload,
      parsed_payload: parsed,
      validation_report: {
        status: validation.status,
        issues: validation.issues,
        summaries,
      },
    })
    .select('id')
    .single()

  if (artifactError) throw artifactError

  return {
    testRunId,
    artifactId: typeof artifact?.id === 'string' ? artifact.id : null,
    summaries,
  }
}

export function validateRulebookTestCaseDefinition(testCase: RulebookTestCaseDefinition): RulebookIssue[] {
  const issues: RulebookIssue[] = []
  const rule = getRulebookMessageRule({ family: testCase.family, code: testCase.messageCode })
  const process = getBusinessProcessForMessage({ family: testCase.family, code: testCase.messageCode })
  const expectedAppRef = expectedApplicationReferenceForProcess(process)
  const ackDecision = deriveRulebookAckDecision({
    family: testCase.family,
    code: testCase.messageCode,
    utiltsFunctionalError: testCase.expectedUtiltsErr === 'expected',
  })

  if (!rule) {
    issues.push(issue('error', 'rulebook_regression_missing_message_rule', 'Meddelanderegel saknas', `${testCase.family}/${testCase.messageCode} saknar rulebook-regel.`))
    return issues
  }

  if (testCase.family === 'PRODAT') {
    if (['Z13', 'Z14', 'Z15', 'Z18'].includes(testCase.messageCode) && process !== 'metering_access') {
      issues.push(issue('error', 'rulebook_regression_permission_wrong_process', 'ESCO-flöde har fel process', `${testCase.messageCode} måste ligga i metering_access.`))
    }
    if (['Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10'].includes(testCase.messageCode) && process !== 'supplier_switch') {
      issues.push(issue('error', 'rulebook_regression_supplier_wrong_process', 'Leverantörsflöde har fel process', `${testCase.messageCode} måste ligga i supplier_switch.`))
    }
    if (expectedAppRef && rule.defaultApplicationReference !== expectedAppRef) {
      issues.push(issue('error', 'rulebook_regression_wrong_appref', 'Fel Application Reference i regel', `${testCase.messageCode} ska använda ${expectedAppRef}, inte ${rule.defaultApplicationReference ?? '—'}.`))
    }
  }

  if (!expectedMatches(ackDecision.requiresContrl, testCase.expectedContrl)) {
    issues.push(issue('error', 'rulebook_regression_contrl_mismatch', 'CONTRL-regel matchar inte testfall', `${testCase.testCaseCode} förväntar ${testCase.expectedContrl}, men regelmotor ger ${ackDecision.contrlStatus}.`))
  }

  if (!expectedMatches(ackDecision.requiresAperak, testCase.expectedAperak)) {
    issues.push(issue('error', 'rulebook_regression_aperak_mismatch', 'APERAK-regel matchar inte testfall', `${testCase.testCaseCode} förväntar ${testCase.expectedAperak}, men regelmotor ger ${ackDecision.aperakStatus}.`))
  }

  if (!utiltsErrMatches(ackDecision.utiltsErrStatus === 'pending', testCase.expectedUtiltsErr)) {
    issues.push(issue('error', 'rulebook_regression_utilts_err_mismatch', 'UTILTS_ERR-regel matchar inte testfall', `${testCase.testCaseCode} förväntar ${testCase.expectedUtiltsErr}, men regelmotor ger ${ackDecision.utiltsErrStatus}.`))
  }

  return issues
}

export async function runRulebookRegressionSuite(params: {
  actorUserId: string
  ruleVersionId?: string | null
}): Promise<RulebookRegressionResult> {
  const caseResults = RULEBOOK_TEST_CASES.map((testCase) => {
    const issues = validateRulebookTestCaseDefinition(testCase)
    return { testCase, issues, status: issues.some((item) => item.severity === 'error') ? 'failed' as const : 'passed' as const }
  })
  const allIssues = caseResults.flatMap((item) => item.issues)
  const failed = caseResults.filter((item) => item.status === 'failed').length
  const passed = caseResults.length - failed
  const status = failed > 0 ? 'failed' : 'passed'

  const { data: run, error: runError } = await supabaseService
    .from('ediel_test_runs')
    .insert({
      test_suite: 'OTHER',
      role_code: 'supplier',
      test_case_code: 'RULEBOOK_REGRESSION',
      title: 'Rulebook regression före regelaktivering',
      status,
      approval_version: 'rulebook-2026A',
      rule_version_id: params.ruleVersionId ?? null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      failure_reason: failed > 0 ? `${failed} testfall misslyckades` : null,
      notes: JSON.stringify({
        rulebookRegression: true,
        total: caseResults.length,
        passed,
        failed,
        ruleVersionId: params.ruleVersionId ?? null,
        issues: allIssues,
      }),
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
      timeline: caseResults.map((item, index) => ({
        step: index + 1,
        testCaseCode: item.testCase.testCaseCode,
        status: item.status,
        issues: item.issues,
      })),
    })
    .select('id')
    .single()

  if (runError) throw runError
  const testRunId = typeof run?.id === 'string' ? run.id : null

  if (testRunId) {
    const stepRows = caseResults.map((item, index) => ({
      test_run_id: testRunId,
      step_no: index + 1,
      name: `${item.testCase.testCaseCode} · ${item.testCase.name}`,
      status: item.status,
      expected_family: item.testCase.family,
      expected_code: item.testCase.messageCode,
      expected_direction: item.testCase.direction,
      expected_ack: JSON.stringify({
        contrl: item.testCase.expectedContrl,
        aperak: item.testCase.expectedAperak,
        utiltsErr: item.testCase.expectedUtiltsErr,
      }),
      validation_report: { issues: item.issues },
    }))

    const { error: stepError } = await supabaseService
      .from('ediel_test_run_steps')
      .insert(stepRows)

    if (stepError) throw stepError

    const { error: artifactError } = await supabaseService
      .from('ediel_test_artifacts')
      .insert({
        test_run_id: testRunId,
        artifact_type: 'regression_report',
        title: 'Rulebook regression report',
        parsed_payload: { cases: caseResults.map((item) => item.testCase) },
        validation_report: {
          status,
          total: caseResults.length,
          passed,
          failed,
          issues: allIssues,
        },
      })

    if (artifactError) throw artifactError
  }

  return {
    testRunId,
    status,
    total: caseResults.length,
    passed,
    failed,
    issues: allIssues,
  }
}

export async function importRulebookTestDataSet(params: {
  actorUserId: string
  datasetKey: string
  name: string
  sourceFileName?: string | null
  sourceType?: string | null
  rawText: string
}): Promise<string | null> {
  const lines = params.rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const rows = lines.map((line, index) => ({ lineNo: index + 1, raw: line, cells: line.split(/[;,\t]/).map((cell) => cell.trim()) }))
  const datasetKey = params.datasetKey.trim().length > 0 ? params.datasetKey.trim() : `dataset-${Date.now()}`

  const { data, error } = await supabaseService
    .from('ediel_test_data_sets')
    .upsert({
      dataset_key: datasetKey,
      name: params.name,
      source_file_name: params.sourceFileName ?? null,
      source_type: params.sourceType ?? 'manual_import',
      status: 'active',
      metadata: {
        importedBy: params.actorUserId,
        importedAt: new Date().toISOString(),
        rowCount: rows.length,
        preview: rows.slice(0, 25),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'dataset_key' })
    .select('id')
    .single()

  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
}
