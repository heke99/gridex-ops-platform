// lib/ediel/rulebook/testRunner.ts

import { supabaseService } from '@/lib/supabase/service'
import { RULEBOOK_TEST_CASES, type RulebookTestCaseDefinition } from '@/lib/ediel/rulebook/testCaseMatcher'
import { validateRawPayloadWithRulebook } from '@/lib/ediel/rulebook/validator'

export type RulebookTestRunSummary = {
  testCase: RulebookTestCaseDefinition
  status: 'passed' | 'failed' | 'manual_review'
  issues: Array<{ severity: string; code: string; title: string; description: string }>
}

export async function createRulebookTestRun(params: {
  companyId?: string | null
  actorProfileId?: string | null
  testCaseCode: string
  createdBy: string
  environment?: 'test' | 'production'
}): Promise<string | null> {
  const testCase = RULEBOOK_TEST_CASES.find((item) => item.testCaseCode === params.testCaseCode)
  if (!testCase) return null

  const { data, error } = await supabaseService
    .from('ediel_test_runs')
    .insert({
      company_id: params.companyId ?? null,
      test_suite: testCase.suite,
      role_code: testCase.actorRole,
      test_case_code: testCase.testCaseCode,
      status: 'draft',
      approval_version: 'rulebook-2026A',
      notes: JSON.stringify({
        createdBy: params.createdBy,
        environment: params.environment ?? 'test',
        actorProfileId: params.actorProfileId ?? null,
        expectedContrl: testCase.expectedContrl,
        expectedAperak: testCase.expectedAperak,
        expectedUtiltsErr: testCase.expectedUtiltsErr,
      }),
    })
    .select('id')
    .single()

  if (error) throw error
  return typeof data?.id === 'string' ? data.id : null
}

export function runRulebookValidationForPayload(rawPayload: string): RulebookTestRunSummary[] {
  const result = validateRawPayloadWithRulebook(rawPayload)
  const candidates = RULEBOOK_TEST_CASES.filter((testCase) => {
    if (testCase.family !== result.parsed.family) return false
    if (testCase.messageCode !== result.parsed.messageCode) return false
    return true
  })

  const status = result.status === 'failed' ? 'failed' : result.status === 'warning' ? 'manual_review' : 'passed'
  return candidates.map((testCase) => ({
    testCase,
    status,
    issues: result.issues,
  }))
}
