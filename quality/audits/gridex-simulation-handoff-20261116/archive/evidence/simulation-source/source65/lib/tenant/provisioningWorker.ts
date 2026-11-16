import { deliverCompanyInvitationIntent } from '@/lib/auth/companyInvitationFlow'
import { getCompanyProductionReadiness } from '@/lib/ediel/productionReadiness'
import { supabaseService } from '@/lib/supabase/service'

type ClaimedProvisioningJob = {
  id: string
  company_id: string
  job_key: string
  idempotency_key: string
  attempt_count: number
  max_attempts: number
  lease_token: string
}

type InvitationRow = {
  id: string
  company_id: string
  email: string
  full_name: string | null
  membership_role: string | null
  role_key: string | null
  status: string
  token: string | null
  invited_by: string | null
  invited_user_id: string | null
  metadata: Record<string, unknown> | null
}

async function complete(input: {
  job: ClaimedProvisioningJob
  succeeded: boolean
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const { data, error } = await supabaseService.rpc('canonical_complete_company_provisioning_job', {
    p_job_id: input.job.id,
    p_lease_token: input.job.lease_token,
    p_succeeded: input.succeeded,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_error_details: {},
  })
  if (error) throw error
  return data as { status?: string } | null
}

async function processEdielReadinessRevalidation(job: ClaimedProvisioningJob) {
  try {
    // System revalidation is deliberately readiness-only. The readiness evaluator
    // persists evidence for the current immutable snapshot but does not create a
    // dry-run and does not transition production back to live.
    const readiness = await getCompanyProductionReadiness(job.company_id, {
      checkedBy: null,
      persist: true,
    })

    // A newer snapshot may have superseded this queued job before it was claimed.
    // In that case the evaluation above is already bound to the current snapshot;
    // the newer snapshot also has its own idempotent job, so this job can complete
    // without ever reviving stale evidence.
    await complete({ job, succeeded: true })
    return {
      outcome: 'completed' as const,
      readinessStatus: readiness.status,
      snapshotId: readiness.configurationSnapshot.id,
      superseded: readiness.configurationSnapshot.id !== job.idempotency_key,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await complete({
      job,
      succeeded: false,
      errorCode: 'ediel_readiness_revalidation_failed',
      errorMessage: message,
    })
    return {
      outcome: 'failed' as const,
      readinessStatus: null,
      snapshotId: null,
      superseded: false,
    }
  }
}

const manualConfigurationJobs = new Map<string, string>([
  ['legal_profile', 'Complete and review the company legal profile in canonical tenant settings.'],
  ['email_configuration', 'Configure verified sender/provider settings; this job sends no email.'],
  ['capability_review', 'Review tenant capabilities through canonical configuration; no capability is activated here.'],
  ['onboarding_tasks', 'Complete the underlying onboarding tasks; this handoff does not approve readiness.'],
  ['admin_access', 'Activate access only through verified Auth invitation acceptance and canonical role policy.'],
  ['ediel_configuration', 'Configure verified identities, routes and certificates; no dry-run or go-live is performed here.'],
])

async function processClaimedJob(job: ClaimedProvisioningJob, targeted?: {
  expectedInvitationId: string
  beforeDelivery: () => Promise<void>
  stopOnDeliveryFailure: true
}) {
  const manualAction = manualConfigurationJobs.get(job.job_key)
  if (manualAction) {
    const result = await complete({ job, succeeded: false,
      errorCode: 'manual_configuration_required', errorMessage: manualAction })
    if (result?.status !== 'awaiting_configuration') {
      throw new Error('provisioning_manual_handoff_not_persisted')
    }
    return { outcome: 'manual_action_required' as const }
  }

  if (job.job_key === 'ediel_readiness_revalidate') {
    return processEdielReadinessRevalidation(job)
  }

  if (job.job_key !== 'auth_invite') {
    await complete({
      job,
      succeeded: false,
      errorCode: 'unsupported_provisioning_job',
      errorMessage: `Provisioning job type ${job.job_key} is not supported.`,
    })
    return { outcome: 'failed' as const }
  }

  const { data, error } = await supabaseService
    .from('company_invitations')
    .select('id,company_id,email,full_name,membership_role,role_key,status,token,invited_by,invited_user_id,metadata')
    .eq('company_id', job.company_id)
    .eq('idempotency_key', job.idempotency_key)
    .maybeSingle()
  if (error) {
    if (targeted) throw error
    await complete({
      job,
      succeeded: false,
      errorCode: 'invitation_intent_lookup_failed',
      errorMessage: error.message,
    })
    return { outcome: 'failed' as const }
  }
  const invitation = data as InvitationRow | null
  if (!invitation) {
    if (targeted) throw new Error('targeted_invitation_intent_missing')
    await complete({
      job,
      succeeded: false,
      errorCode: 'invitation_intent_missing',
      errorMessage: 'The durable invitation intent is missing.',
    })
    return { outcome: 'failed' as const }
  }

  if (targeted && invitation.id !== targeted.expectedInvitationId) {
    throw new Error('targeted_invitation_lookup_identity_mismatch')
  }

  const providerStatus = typeof invitation.metadata?.provider_delivery_status === 'string'
    ? invitation.metadata.provider_delivery_status
    : null
  if (invitation.status !== 'pending' || (providerStatus === 'sent' && invitation.invited_user_id)) {
    if (targeted) throw new Error('targeted_invitation_intent_not_pending_or_already_sent')
    await complete({ job, succeeded: true })
    return { outcome: 'completed' as const }
  }
  if (!invitation.token) {
    if (targeted) throw new Error('targeted_invitation_token_missing')
    await complete({
      job,
      succeeded: false,
      errorCode: 'invitation_token_missing',
      errorMessage: 'The durable invitation intent has no delivery token.',
    })
    return { outcome: 'failed' as const }
  }

  // Targeted lease rejection is a STOP, outside the legacy retry catch.
  if (targeted) await targeted.beforeDelivery()

  try {
    await deliverCompanyInvitationIntent({
      invitationId: invitation.id,
      companyId: invitation.company_id,
      email: invitation.email,
      fullName: invitation.full_name,
      token: invitation.token,
      actorUserId: invitation.invited_by,
      source: 'tenant_provisioning_worker',
      membershipRole: invitation.membership_role ?? 'member',
      roleKey: invitation.role_key ?? 'member',
      sendEmail: true,
      provisioningJobId: job.id,
      provisioningLeaseToken: job.lease_token,
    })
    await complete({ job, succeeded: true })
    return { outcome: 'completed' as const }
  } catch (error) {
    // Provider outcome can be ambiguous: never schedule an automatic remail.
    if (targeted?.stopOnDeliveryFailure) throw error
    const message = error instanceof Error ? error.message : String(error)
    await complete({
      job,
      succeeded: false,
      errorCode: 'auth_invite_delivery_failed',
      errorMessage: message,
    })
    return { outcome: 'failed' as const }
  }
}

export async function processCompanyProvisioningJobs(input: {
  workerId: string
  limit?: number
  leaseSeconds?: number
}) {
  const { data, error } = await supabaseService.rpc('canonical_claim_company_provisioning_jobs', {
    p_worker_id: input.workerId,
    p_limit: Math.min(Math.max(input.limit ?? 20, 1), 100),
    p_lease_seconds: Math.min(Math.max(input.leaseSeconds ?? 300, 30), 3600),
  })
  if (error) throw error

  const jobs = (data ?? []) as unknown as ClaimedProvisioningJob[]
  const outcomes = await Promise.all(jobs.map((job) => processClaimedJob(job)))
  return {
    claimed: jobs.length,
    completed: outcomes.filter((item) => item.outcome === 'completed').length,
    failed: outcomes.filter((item) => item.outcome === 'failed').length,
    manualActionRequired: outcomes.filter((item) => item.outcome === 'manual_action_required').length,
  }
}

/** Trusted operational worker port. No global housekeeping or batch fallback. */
export async function processCompanyInvitationDeliveryJob(input: {
  companyId: string
  jobId: string
  invitationId: string
  workerId: string
}) {
  const { data, error } = await supabaseService.rpc('canonical_claim_invitation_delivery_job', {
    p_company_id: input.companyId, p_job_id: input.jobId,
    p_invitation_id: input.invitationId, p_worker_id: input.workerId,
  })
  if (error) throw error
  const result = data as unknown as { outcome?: string; job?: ClaimedProvisioningJob }
  if (result?.outcome === 'already_completed') return { outcome: 'already_completed' as const }
  if (result?.outcome === 'already_sent_no_claim') return { outcome: 'already_sent_no_claim' as const }
  const job = result?.job
  if (result?.outcome !== 'claimed' || !job || job.id !== input.jobId ||
      job.company_id !== input.companyId || job.job_key !== 'auth_invite' || !job.lease_token) {
    throw new Error('targeted_invitation_claim_identity_mismatch')
  }
  return processClaimedJob(job, {
    expectedInvitationId: input.invitationId,
    stopOnDeliveryFailure: true,
    beforeDelivery: async () => {
      const validated = await supabaseService.rpc('canonical_validate_invitation_delivery_lease', {
        p_company_id: input.companyId, p_job_id: input.jobId,
        p_invitation_id: input.invitationId, p_worker_id: input.workerId,
        p_lease_token: job.lease_token,
      })
      if (validated.error) throw validated.error
      const proof = validated.data as unknown as { valid?: boolean; job_id?: string; invitation_id?: string }
      if (proof?.valid !== true || proof.job_id !== input.jobId || proof.invitation_id !== input.invitationId) {
        throw new Error('targeted_invitation_lease_validation_mismatch')
      }
    },
  })
}
