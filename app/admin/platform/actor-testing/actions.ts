'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isPlatformAdminContext, requireAdminActionAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import {
  requireEdielProductionActivateActionAccess,
  requireEdielTestAttestActionAccess,
  requireEdielWriteActionAccess,
  requireEdielProductionPauseActionAccess,
  requireEdielProfileWriteActionAccess,
} from '@/lib/ediel/actionAccess'
import { supabaseService } from '@/lib/supabase/service'
import { updateEdielTestRunStatus } from '@/lib/ediel/db'
import {
  buildActorTestResultEvidence,
  getActorTestCase,
  mapTestStatusToRunStatus,
  userCanManageActorTestingForCompany,
  type ActorTestStatus,
} from '@/lib/ediel/actorTesting'
import { logTenantGovernanceEvent } from '@/lib/tenant/governance'
import { runActorTestAutomation, syncAllActorTestsForCompany } from '@/lib/ediel/actorTestingEngine'
import {
  getCompanyProductionReadiness,
  runProductionDryRun,
} from '@/lib/ediel/productionReadiness'

function readRequiredString(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? '').trim()
  if (!value) throw new Error(`${key} saknas.`)
  return value
}


function readIdempotencyKey(formData: FormData, fallback: string): string {
  const supplied = String(formData.get('idempotency_key') ?? '').trim()
  return supplied || fallback
}

async function assertActorTestingCompanyAccess(
  admin: Awaited<ReturnType<typeof requireAdminActionAccess>>,
  companyId: string
) {
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, isPlatformAdmin)
  if (!allowed) throw new Error('Du saknar behörighet att hantera Ediel för detta bolag.')
}
function normalizeResultStatus(value: string): ActorTestStatus {
  if (value === 'passed') throw new Error('passed kan endast sättas av den maskinella evidensmotorn.')
  if (value === 'failed' || value === 'blocked' || value === 'manual_verified') return value
  return 'running'
}

async function requireActorTestingWriteAccess(companyId: string) {
  const admin = await requireEdielWriteActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)
  return admin
}

function revalidateActorTestingViews(companyId: string) {
  revalidatePath('/admin/platform/actor-testing')
  revalidatePath(`/admin/platform/actor-testing/${companyId}`)
  revalidatePath('/admin/platform/go-live')
  revalidatePath('/admin/platform/work-queue')
  revalidatePath('/admin/platform/usage')
  revalidatePath(`/admin/platform/go-live/${companyId}`)
  revalidatePath('/admin/whitelabel/actor-testing')
  revalidatePath('/admin/whitelabel/go-live')
  revalidatePath('/admin/company-actor-status')
}

async function insertGoLiveEvent(input: {
  companyId: string
  eventType: string
  fromStatus?: string | null
  toStatus?: string | null
  reason?: string | null
  actorUserId: string
  readinessCheckId?: string | null
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseService.from('ediel_go_live_events').insert({
    company_id: input.companyId,
    event_type: input.eventType,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    reason: input.reason ?? null,
    actor_user_id: input.actorUserId,
    readiness_check_id: input.readinessCheckId ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) throw error
}

type CanonicalProductionTarget = 'prepared' | 'live' | 'paused' | 'blocked' | 'retired'

async function transitionCanonicalEdielProduction(input: {
  companyId: string
  targetState: CanonicalProductionTarget
  actorUserId: string
  reason: string
  readinessCheckId?: string | null
  dryRunId?: string | null
  configurationSnapshotId?: string | null
  expectedStateVersion?: number | null
  idempotencyKey: string
}) {
  const { data, error } = await supabaseService.rpc('canonical_transition_ediel_production', {
    p_company_id: input.companyId,
    p_target_state: input.targetState,
    p_expected_state_version: input.expectedStateVersion ?? null,
    p_configuration_snapshot_id: input.configurationSnapshotId ?? null,
    p_readiness_check_id: input.readinessCheckId ?? null,
    p_dry_run_id: input.dryRunId ?? null,
    p_reason: input.reason,
    p_actor_user_id: input.actorUserId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return data
}

async function approveCanonicalFirstLiveSend(input: {
  companyId: string
  actorUserId: string
  readinessCheckId?: string | null
  idempotencyKey: string
}) {
  const { data, error } = await supabaseService.rpc('canonical_approve_first_live_send', {
    p_company_id: input.companyId,
    p_readiness_check_id: input.readinessCheckId ?? null,
    p_actor_user_id: input.actorUserId,
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw error
  return data
}

export async function startActorTestAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const testKey = readRequiredString(formData, 'test_key').toUpperCase()
  const testCase = getActorTestCase(testKey)
  if (!testCase) throw new Error('Okänt aktörstest.')

  const admin = await requireActorTestingWriteAccess(companyId)

  try {
    const result = await runActorTestAutomation({
      actorUserId: admin.userId,
      companyId,
      testKey: testCase.key,
      autoSend: false,
    })

    await logTenantGovernanceEvent({
      action: 'EDIEL_TEST_ATTEMPT_COMPLETED',
      actorUserId: admin.userId,
      companyId,
      reason: `Automatiserat aktörstest kördes: ${testCase.label}`,
      metadata: {
        actorTesting: true,
        action: 'ACTOR_TEST_PREPARED_WITHOUT_SEND',
        testKey: testCase.key,
        testId: testCase.testId,
        edielTestRunId: result.testRun.id,
        outboundMessageId: result.outboundMessage?.id ?? null,
        createdAckMessageIds: result.createdAckMessages.map((message) => message.id),
        syncedStatus: result.syncedStatus,
        note: result.note,
        sendPolicy: 'manual_review_required_before_send',
      },
    })
  } catch (error) {
    const now = new Date().toISOString()
    const message = error instanceof Error ? error.message : 'Aktörstestet kunde inte köras automatiskt.'

    const { error: resultError } = await supabaseService.from('actor_test_results').upsert(
      {
        company_id: companyId,
        test_key: testCase.key,
        test_name: testCase.label,
        test_id: testCase.testId,
        package_key: testCase.packageKey,
        message_family: testCase.messageFamily,
        message_code: testCase.messageCode,
        direction: testCase.direction,
        status: 'blocked',
        latest_run_at: now,
        failure_reason: message,
        portal_status: 'Automatiserad körning stoppades före komplett beviskedja.',
        evidence: buildActorTestResultEvidence({
          testCase,
          status: 'blocked',
          portalStatus: 'Automatiserad körning stoppades före komplett beviskedja.',
          failureReason: message,
          actorUserId: admin.userId,
        }),
        created_by: admin.userId,
        updated_by: admin.userId,
        updated_at: now,
      },
      { onConflict: 'company_id,test_key' }
    )

    if (resultError) throw resultError

    await logTenantGovernanceEvent({
      action: 'EDIEL_TEST_ATTEMPT_COMPLETED',
      actorUserId: admin.userId,
      companyId,
      reason: `Automatiserat aktörstest blockerades: ${testCase.label}`,
      metadata: {
        actorTesting: true,
        action: 'ACTOR_TEST_AUTOMATION_BLOCKED',
        testKey: testCase.key,
        testId: testCase.testId,
        failureReason: message,
      },
    })

    revalidateActorTestingViews(companyId)
    throw error
  }

  revalidateActorTestingViews(companyId)
}

export async function saveActorTestResultAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const testKey = readRequiredString(formData, 'test_key').toUpperCase()
  const status = normalizeResultStatus(readRequiredString(formData, 'status'))
  const testCase = getActorTestCase(testKey)
  if (!testCase) throw new Error('Okänt aktörstest.')

  const admin = status === 'manual_verified'
    ? await requireEdielTestAttestActionAccess()
    : await requireActorTestingWriteAccess(companyId)
  if (status === 'manual_verified') await assertActorTestingCompanyAccess(admin, companyId)

  const now = new Date().toISOString()
  const failureReason = String(formData.get('failure_reason') ?? '').trim() || null
  const portalStatus = String(formData.get('portal_status') ?? '').trim() || null
  const rawPayload = String(formData.get('raw_payload') ?? '').trim() || null
  const evidenceReference = String(formData.get('evidence_reference') ?? '').trim() || null
  const runId = String(formData.get('ediel_test_run_id') ?? '').trim() || null

  if ((status === 'failed' || status === 'blocked' || status === 'manual_verified') && !failureReason) {
    throw new Error('Orsak krävs för misslyckat, blockerat eller manuellt verifierat test.')
  }
  if (status === 'manual_verified' && (!evidenceReference || !runId)) {
    throw new Error('Extern evidensreferens och tenantägt test-run krävs för manuell attestering.')
  }

  if (status === 'manual_verified') {
    const { error } = await supabaseService.rpc('canonical_request_actor_test_attestation', {
      p_command: {
        company_id: companyId,
        test_run_id: runId,
        test_case_code: testCase.key,
        reason: failureReason,
        evidence_reference: evidenceReference,
        actor_user_id: admin.userId,
        idempotency_key: readIdempotencyKey(formData, `manual-attestation-request:${companyId}:${runId}:${testCase.key}:${evidenceReference}`),
      },
    })
    if (error) throw error
    revalidateActorTestingViews(companyId)
    return
  }

  const payload = {
    company_id: companyId,
    test_key: testCase.key,
    test_name: testCase.label,
    test_id: testCase.testId,
    package_key: testCase.packageKey,
    message_family: testCase.messageFamily,
    message_code: testCase.messageCode,
    direction: testCase.direction,
    status,
    latest_run_at: now,
    passed_at: null,
    failure_reason: failureReason,
    portal_status: portalStatus,
    raw_payload: rawPayload,
    ediel_test_run_id: runId,
    evidence: buildActorTestResultEvidence({
      testCase,
      status,
      portalStatus,
      rawPayload,
      failureReason,
      actorUserId: admin.userId,
    }),
    updated_by: admin.userId,
    updated_at: now,
  }

  const { error } = await supabaseService
    .from('actor_test_results')
    .upsert(payload, { onConflict: 'company_id,test_key' })
  if (error) throw error

  if (runId) {
    await updateEdielTestRunStatus({
      actorUserId: admin.userId,
      companyId,
      testRunId: runId,
      status: mapTestStatusToRunStatus(status),
      failureReason,
      completedAt: status === 'running' ? null : now,
    })
  }

  revalidateActorTestingViews(companyId)
}

export async function approveActorTestAttestationAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const attestationId = readRequiredString(formData, 'attestation_id')
  const decisionReason = readRequiredString(formData, 'decision_reason')
  const admin = await requireEdielTestAttestActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)

  const { error } = await supabaseService.rpc('canonical_approve_actor_test_attestation', {
    p_command: {
      company_id: companyId,
      attestation_id: attestationId,
      decision_reason: decisionReason,
      actor_user_id: admin.userId,
      idempotency_key: readIdempotencyKey(formData, `manual-attestation-approve:${companyId}:${attestationId}`),
    },
  })
  if (error) throw error
  revalidateActorTestingViews(companyId)
}


export async function syncActorTestsAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requireActorTestingWriteAccess(companyId)

  const synced = await syncAllActorTestsForCompany({
    actorUserId: admin.userId,
    companyId,
    autoRespond: true,
    autoSend: false,
  })

  await logTenantGovernanceEvent({
    action: 'EDIEL_TEST_RESULTS_SYNCED',
    actorUserId: admin.userId,
    companyId,
    reason: 'Aktörstestresultat synkades från verkliga Ediel-meddelanden.',
    metadata: {
      actorTesting: true,
      action: 'ACTOR_TESTS_SYNCED_FROM_EDIEL_MESSAGES',
      synced,
    },
  })

  revalidateActorTestingViews(companyId)
}

function readReturnPath(formData: FormData, companyId: string): string {
  const requested = String(formData.get('redirect_to') ?? '').trim()
  if (requested.startsWith('/admin/platform/go-live/') || requested.startsWith('/admin/platform/actor-testing/') || requested.startsWith('/admin/whitelabel/actor-testing/') || requested === '/admin/company-actor-status') {
    return requested
  }

  return `/admin/platform/go-live/${companyId}`
}

function goLiveRedirect(companyId: string, status: 'blocked' | 'error' | 'prepared' | 'live', message: string, returnPath?: string): never {
  const params = new URLSearchParams({ status, message })
  const target = returnPath && returnPath.trim().startsWith('/admin/') ? returnPath.trim() : `/admin/platform/go-live/${companyId}`
  redirect(`${target}?${params.toString()}`)
  throw new Error('redirect_failed')
}

export async function saveActorProfileAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requireEdielProfileWriteActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)

  const read = (key: string) => {
    const value = String(formData.get(key) ?? '').trim()
    return value.length > 0 ? value : null
  }

  const command = {
    company_id: companyId,
    company_name: read('company_name'),
    organization_number: read('org_number'),
    market_role: read('market_role'),
    actor_role: read('actor_role'),
    ediel_id: read('ediel_id'),
    test_ediel_id: read('test_ediel_id'),
    production_ediel_id: read('production_ediel_id'),
    test_sender_sub_address: read('test_sender_sub_address'),
    production_sender_sub_address: read('production_sender_sub_address'),
    test_mailbox: read('test_mailbox'),
    production_mailbox: read('production_mailbox'),
    test_application_reference: read('test_application_reference'),
    production_application_reference: read('production_application_reference'),
    test_counterparty_ediel_id: read('test_counterparty_ediel_id'),
    production_counterparty_ediel_id: read('production_counterparty_ediel_id'),
    brp_name: read('brp_name'),
    brp_ediel_id: read('brp_ediel_id'),
    brp_status: read('brp_status') ?? 'missing',
    esett_status: read('esett_status') ?? 'missing',
    technical_contact_name: read('technical_contact_name'),
    technical_contact_email: read('technical_contact_email'),
    support_email: read('support_email'),
    billing_contact_email: read('billing_contact_email'),
    smtp_from_email: read('smtp_from_email') ?? 'ediel@gridex.se',
    actor_user_id: admin.userId,
    idempotency_key: readIdempotencyKey(formData, `actor-profile:${companyId}:${read('actor_role') ?? 'none'}:${read('production_ediel_id') ?? 'none'}`),
  }

  const { error } = await supabaseService.rpc('canonical_save_ediel_actor_profile', { p_command: command })
  if (error) throw error

  revalidateActorTestingViews(companyId)
}

export async function prepareProductionAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requireEdielProductionActivateActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)
  const returnPath = readReturnPath(formData, companyId)
  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })

  const prepared = readiness.blockingIssues.length === 0
  const targetState: CanonicalProductionTarget = prepared ? 'prepared' : 'blocked'
  const reason = readiness.blockingIssues.map((issue) => issue.message).join(' · ') || 'Produktionsförberedelse verifierad.'

  await transitionCanonicalEdielProduction({
    companyId,
    targetState,
    actorUserId: admin.userId,
    reason,
    readinessCheckId: readiness.latestCheck.id,
    dryRunId: readiness.latestDryRun.id,
    configurationSnapshotId: readiness.configurationSnapshot.id,
    idempotencyKey: readIdempotencyKey(formData, `production-prepare:${companyId}:${readiness.latestCheck.id ?? 'none'}`),
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(
    companyId,
    prepared ? 'prepared' : 'blocked',
    prepared
      ? 'Produktionsförberedelse klar. Slutlig live-aktivering kräver separat bekräftelse.'
      : `Produktionsförberedelsen är blockerad: ${reason}`,
    returnPath
  )
}

export async function activateLiveEdielAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requireEdielProductionActivateActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)
  const returnPath = readReturnPath(formData, companyId)

  if (confirmation !== 'ACTIVATE PRODUCTION') {
    goLiveRedirect(companyId, 'error', 'Skriv “ACTIVATE PRODUCTION” för att aktivera production Ediel.', returnPath)
  }

  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })
  if (readiness.blockingIssues.length > 0) {
    const reason = readiness.blockingIssues.map((issue) => issue.message).join(' · ')
    await transitionCanonicalEdielProduction({
      companyId,
      targetState: 'blocked',
      actorUserId: admin.userId,
      reason,
      readinessCheckId: readiness.latestCheck.id,
      dryRunId: readiness.latestDryRun.id,
      configurationSnapshotId: readiness.configurationSnapshot.id,
      idempotencyKey: readIdempotencyKey(formData, `production-blocked:${companyId}:${readiness.latestCheck.id ?? 'none'}`),
    })
    revalidateActorTestingViews(companyId)
    goLiveRedirect(companyId, 'blocked', `Live är blockerat: ${reason}`, returnPath)
  }

  if (!['allowed', 'warning'].includes(readiness.latestDryRun.status ?? '')) {
    goLiveRedirect(companyId, 'blocked', 'Live är blockerat: kör production dry run utan blockerare innan aktivering.', returnPath)
  }

  await transitionCanonicalEdielProduction({
    companyId,
    targetState: 'live',
    actorUserId: admin.userId,
    reason: 'Production Ediel aktiverad efter aktuell readiness och dry run.',
    readinessCheckId: readiness.latestCheck.id,
    dryRunId: readiness.latestDryRun.id,
    configurationSnapshotId: readiness.configurationSnapshot.id,
    idempotencyKey: readIdempotencyKey(formData, `production-live:${companyId}:${readiness.latestDryRun.id ?? 'none'}`),
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'live', 'Live Ediel aktiverades.', returnPath)
}

export async function runProductionReadinessAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requirePlatformAdminActionAccess()
  const returnPath = readReturnPath(formData, companyId)
  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })

  await insertGoLiveEvent({
    companyId,
    eventType: 'readiness_check_run',
    fromStatus: readiness.summary.productionStatus,
    toStatus: readiness.status,
    reason: readiness.blockingIssues.length > 0 ? readiness.blockingIssues.map((issue) => issue.message).join(' · ') : 'Readiness check passerade utan blockerare.',
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    metadata: { readiness },
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, readiness.blockingIssues.length > 0 ? 'blocked' : 'prepared', readiness.blockingIssues.length > 0 ? 'Readiness check hittade blockerare.' : 'Readiness check är klar utan blockerare.', returnPath)
}

export async function runProductionDryRunAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requirePlatformAdminActionAccess()
  const returnPath = readReturnPath(formData, companyId)
  const result = await runProductionDryRun(companyId, admin.userId)
  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, result.success ? 'prepared' : 'blocked', result.success ? 'Production dry run kördes utan blockerande fel. Inget skick gjordes.' : 'Production dry run blockerades. Inget skick gjordes.', returnPath)
}

export async function pauseProductionEdielAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const reason = readRequiredString(formData, 'reason')
  const admin = await requireEdielProductionPauseActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)
  const returnPath = readReturnPath(formData, companyId)
  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })

  await transitionCanonicalEdielProduction({
    companyId,
    targetState: 'paused',
    actorUserId: admin.userId,
    reason,
    readinessCheckId: readiness.latestCheck.id,
    dryRunId: readiness.latestDryRun.id,
    configurationSnapshotId: readiness.configurationSnapshot.id,
    idempotencyKey: readIdempotencyKey(formData, `production-pause:${companyId}:${reason}`),
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'blocked', 'Production sending pausades. Inbound kan fortfarande tas emot och loggas.', returnPath)
}

export async function resumeProductionEdielAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requireEdielProductionActivateActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)
  const returnPath = readReturnPath(formData, companyId)
  if (confirmation !== 'RESUME PRODUCTION') {
    goLiveRedirect(companyId, 'error', 'Skriv “RESUME PRODUCTION” för att återuppta production sending.', returnPath)
  }

  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })
  if (readiness.blockingIssues.length > 0) {
    goLiveRedirect(companyId, 'blocked', `Production kan inte återupptas: ${readiness.blockingIssues.map((issue) => issue.message).join(' · ')}`, returnPath)
  }

  await transitionCanonicalEdielProduction({
    companyId,
    targetState: 'live',
    actorUserId: admin.userId,
    reason: 'Production sending återupptogs efter aktuell readiness-kontroll.',
    readinessCheckId: readiness.latestCheck.id,
    dryRunId: readiness.latestDryRun.id,
    configurationSnapshotId: readiness.configurationSnapshot.id,
    idempotencyKey: readIdempotencyKey(formData, `production-resume:${companyId}:${readiness.latestCheck.id ?? 'none'}`),
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'live', 'Production sending återupptogs.', returnPath)
}

export async function approveFirstLiveSendAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requireEdielProductionActivateActionAccess()
  await assertActorTestingCompanyAccess(admin, companyId)
  const returnPath = readReturnPath(formData, companyId)
  if (confirmation !== 'APPROVE FIRST LIVE SEND') {
    goLiveRedirect(companyId, 'error', 'Skriv “APPROVE FIRST LIVE SEND” för att godkänna första live-send.', returnPath)
  }

  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })
  if (!['ready', 'warning', 'live'].includes(readiness.status) || readiness.blockingIssues.length > 0) {
    goLiveRedirect(companyId, 'blocked', 'Första live-send kan inte godkännas innan readiness saknar blockerare.', returnPath)
  }

  await approveCanonicalFirstLiveSend({
    companyId,
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    idempotencyKey: readIdempotencyKey(formData, `first-live-send:${companyId}:${readiness.latestCheck.id ?? 'none'}`),
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'prepared', 'Första live-send är godkänd.', returnPath)
}
