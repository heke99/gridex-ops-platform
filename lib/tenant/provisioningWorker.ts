import { deliverCompanyInvitationIntent } from '@/lib/auth/companyInvitationFlow'
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
  const { error } = await supabaseService.rpc('canonical_complete_company_provisioning_job', {
    p_job_id: input.job.id,
    p_lease_token: input.job.lease_token,
    p_succeeded: input.succeeded,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_error_details: {},
  })
  if (error) throw error
}

async function processClaimedJob(job: ClaimedProvisioningJob) {
  if (job.job_key !== 'auth_invite') {
    await complete({
      job,
      succeeded: false,
      errorCode: 'unsupported_provisioning_job',
      errorMessage: `Provisioning job type ${job.job_key} is not supported.`,
    })
    return 'failed' as const
  }

  const { data, error } = await supabaseService
    .from('company_invitations')
    .select('id,company_id,email,full_name,membership_role,role_key,status,token,invited_by,invited_user_id,metadata')
    .eq('company_id', job.company_id)
    .eq('idempotency_key', job.idempotency_key)
    .maybeSingle()
  if (error) throw error
  const invitation = data as InvitationRow | null
  if (!invitation) {
    await complete({
      job,
      succeeded: false,
      errorCode: 'invitation_intent_missing',
      errorMessage: 'The durable invitation intent is missing.',
    })
    return 'failed' as const
  }

  const providerStatus = typeof invitation.metadata?.provider_delivery_status === 'string'
    ? invitation.metadata.provider_delivery_status
    : null
  if (invitation.status !== 'pending' || (providerStatus === 'sent' && invitation.invited_user_id)) {
    await complete({ job, succeeded: true })
    return 'completed' as const
  }
  if (!invitation.token) {
    await complete({
      job,
      succeeded: false,
      errorCode: 'invitation_token_missing',
      errorMessage: 'The durable invitation intent has no delivery token.',
    })
    return 'failed' as const
  }

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
    })
    await complete({ job, succeeded: true })
    return 'completed' as const
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await complete({
      job,
      succeeded: false,
      errorCode: 'auth_invite_delivery_failed',
      errorMessage: message,
    })
    return 'failed' as const
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
    completed: outcomes.filter((outcome) => outcome === 'completed').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
  }
}
