import { supabaseService } from '@/lib/supabase/service'
import { activeRulebookRules, defaultApplicationReferenceForProcess, getRulebookRule } from '@/lib/ediel/rulebook/rulebook'
import { listRulebookTestCases, type RulebookTestCase } from '@/lib/ediel/rulebook/testCaseMatcher'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

export type RulebookRegressionScope =
  | 'all'
  | 'prodat_supplier'
  | 'prodat_energy_service_company'
  | 'utilts_supplier'
  | 'utilts_energy_service_company'
  | 'ack'
  | 'ai_list'

export type RulebookRegressionResult = {
  passed: boolean
  total: number
  failed: number
  runId: string | null
  issues: Array<{ testCaseCode: string; message: string }>
}

function casesForScope(scope: RulebookRegressionScope): RulebookTestCase[] {
  const all = listRulebookTestCases()
  if (scope === 'all') return all
  if (scope === 'prodat_supplier') return all.filter((item) => item.family === 'PRODAT' && item.role === 'supplier')
  if (scope === 'prodat_energy_service_company') return all.filter((item) => item.family === 'PRODAT' && item.role === 'energy_service_company')
  if (scope === 'utilts_supplier') return all.filter((item) => item.family === 'UTILTS' && item.role === 'supplier')
  if (scope === 'utilts_energy_service_company') return all.filter((item) => item.family === 'UTILTS' && item.role === 'energy_service_company')
  if (scope === 'ack') return all.filter((item) => ['CONTRL', 'APERAK', 'UTILTS_ERR'].includes(item.family) || item.expectedContrl !== 'not_required')
  if (scope === 'ai_list') return all.filter((item) => item.family === 'AI_LIST' || item.suite.includes('AI'))
  return all
}

async function safeInsert(table: string, payload: Record<string, unknown>) {
  const { data, error } = await supabaseService.from(table).insert(payload).select('*').maybeSingle()
  if (error) {
    return null
  }
  return data as Record<string, unknown> | null
}

export async function runRulebookRegression(input: {
  actorUserId: string
  ruleVersionId?: string | null
  scope?: RulebookRegressionScope
}): Promise<RulebookRegressionResult> {
  const scope = input.scope ?? 'all'
  const now = new Date().toISOString()
  const run = await safeInsert('ediel_test_runs', {
    test_suite: 'RULEBOOK_REGRESSION',
    role_code: 'system',
    test_case_code: input.ruleVersionId ? `RULE_VERSION_${input.ruleVersionId}` : `RULEBOOK_${scope.toUpperCase()}`,
    title: `Rulebook regression ${scope}`,
    status: 'running',
    started_at: now,
    notes: JSON.stringify({ scope, ruleVersionId: input.ruleVersionId ?? null }),
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  })

  const testCases = casesForScope(scope)
  const issues: Array<{ testCaseCode: string; message: string }> = []

  for (const [index, testCase] of testCases.entries()) {
    const rule = getRulebookRule(testCase.family, testCase.code)
    const applicationReference = defaultApplicationReferenceForProcess(testCase.processGroup as never, testCase.family)
    const validation = validateRulebookMessage({
      family: testCase.family,
      code: testCase.code,
      processGroup: testCase.processGroup,
      applicationReference,
      mode: 'test',
    })
    const ruleMissing = !rule && !testCase.testCaseCode.startsWith('RULE-')
    const failed = validation.blocking || ruleMissing
    if (failed) {
      issues.push({
        testCaseCode: testCase.testCaseCode,
        message: ruleMissing ? 'Rulebook-regel saknas.' : validation.issues.map((issue) => `${issue.code}: ${issue.description}`).join(' | '),
      })
    }

    if (run?.id) {
      await safeInsert('ediel_test_run_steps', {
        test_run_id: run.id,
        step_no: index + 1,
        title: testCase.title,
        status: failed ? 'failed' : 'passed',
        expected_family: testCase.family,
        expected_code: testCase.code,
        actual_family: testCase.family,
        actual_code: testCase.code,
        validation_report: {
          processGroup: testCase.processGroup,
          applicationReference,
          issues: validation.issues,
        },
        created_at: now,
        updated_at: now,
      })
    }
  }

  const passed = issues.length === 0
  if (run?.id) {
    await supabaseService
      .from('ediel_test_runs')
      .update({
        status: passed ? 'passed' : 'failed',
        completed_at: new Date().toISOString(),
        failure_reason: passed ? null : issues.map((issue) => `${issue.testCaseCode}: ${issue.message}`).slice(0, 10).join('\n'),
        notes: JSON.stringify({ scope, ruleVersionId: input.ruleVersionId ?? null, ruleCount: activeRulebookRules().length, issues }),
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id)

    if (input.ruleVersionId) {
      await supabaseService
        .from('ediel_rule_versions')
        .update({
          last_regression_run_id: run.id,
          last_regression_status: passed ? 'passed' : 'failed',
          last_regression_at: new Date().toISOString(),
          updated_by: input.actorUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.ruleVersionId)
    }
  }

  return { passed, total: testCases.length, failed: issues.length, runId: typeof run?.id === 'string' ? run.id : null, issues }
}

export async function attachRulebookArtifact(input: {
  actorUserId?: string | null
  testRunId?: string | null
  edielMessageId?: string | null
  artifactType: string
  title: string
  payload: Record<string, unknown>
}) {
  await safeInsert('ediel_test_artifacts', {
    test_run_id: input.testRunId ?? null,
    ediel_message_id: input.edielMessageId ?? null,
    artifact_type: input.artifactType,
    title: input.title,
    payload: input.payload,
    parsed_payload: input.payload.parsed ?? input.payload,
    validation_report: input.payload.validation ?? input.payload,
    created_by: input.actorUserId ?? null,
  })
}
