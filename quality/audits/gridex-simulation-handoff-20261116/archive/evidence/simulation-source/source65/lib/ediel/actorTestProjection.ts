import { supabaseService } from '@/lib/supabase/service'

export type CanonicalActorTestProjectionStatus = 'running' | 'failed' | 'blocked'

export type CanonicalActorTestProjectionInput = {
  actorUserId: string
  companyId: string
  testCaseCode: string
  testName?: string | null
  testId?: string | null
  packageKey?: string | null
  messageFamily?: string | null
  messageCode?: string | null
  direction?: string | null
  status: CanonicalActorTestProjectionStatus
  testRunId?: string | null
  failureReason?: string | null
  portalStatus?: string | null
  rawPayload?: string | null
  evidence?: Record<string, unknown> | null
  idempotencyKey: string
}

/**
 * Writes a non-authoritative actor-test projection through the canonical DB
 * command. Passed/manual-verified results are deliberately excluded: those
 * states may only be produced by the canonical evidence/attestation engine.
 */
export async function projectCanonicalActorTestState(
  input: CanonicalActorTestProjectionInput,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseService.rpc(
    'canonical_project_actor_test_result_state',
    {
      p_command: {
        actor_user_id: input.actorUserId,
        company_id: input.companyId,
        test_case_code: input.testCaseCode,
        test_name: input.testName ?? null,
        test_id: input.testId ?? null,
        package_key: input.packageKey ?? null,
        message_family: input.messageFamily ?? null,
        message_code: input.messageCode ?? null,
        direction: input.direction ?? null,
        status: input.status,
        test_run_id: input.testRunId ?? null,
        failure_reason: input.failureReason ?? null,
        portal_status: input.portalStatus ?? null,
        raw_payload: input.rawPayload ?? null,
        evidence: input.evidence ?? {},
        idempotency_key: input.idempotencyKey,
      },
    },
  )

  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('canonical_actor_test_projection_invalid_result')
  }

  return data as Record<string, unknown>
}
