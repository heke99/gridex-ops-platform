'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { isPlatformAdminContext, requireAdminActionAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'
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

function normalizeResultStatus(value: string): ActorTestStatus {
  if (value === 'passed' || value === 'failed' || value === 'blocked' || value === 'manual_verified') return value
  return 'running'
}

async function requireActorTestingWriteAccess(companyId: string) {
  const admin = await requireAdminActionAccess({ anyOf: ['tenants.write', 'whitelabel.write'] })
  const isPlatformAdmin = isPlatformAdminContext(admin)

  if (!isPlatformAdmin && !admin.permissions.includes('whitelabel.write')) {
    throw new Error('Endast plattformsadmin eller white-label-admin kan hantera aktörstester för andra bolag.')
  }

  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, isPlatformAdmin)

  if (!allowed) {
    throw new Error('Du saknar behörighet att hantera aktörstester för detta bolag.')
  }

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
  try {
    await supabaseService.from('ediel_go_live_events').insert({
      company_id: input.companyId,
      event_type: input.eventType,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus ?? null,
      reason: input.reason ?? null,
      actor_user_id: input.actorUserId,
      readiness_check_id: input.readinessCheckId ?? null,
      metadata: input.metadata ?? {},
    })
  } catch (error) {
    console.warn('Could not store go-live event', error)
  }
}

async function upsertProductionSendLock(input: {
  companyId: string
  locked: boolean
  reason: string | null
  actorUserId: string
}) {
  const now = new Date().toISOString()
  try {
    const { error } = await supabaseService.from('ediel_send_locks').upsert({
      company_id: input.companyId,
      environment: 'production',
      locked: input.locked,
      locked_reason: input.reason,
      locked_by: input.locked ? input.actorUserId : null,
      locked_at: input.locked ? now : null,
      unlocked_by: input.locked ? null : input.actorUserId,
      unlocked_at: input.locked ? null : now,
      updated_at: now,
    }, { onConflict: 'company_id,environment' })
    if (error) console.warn('Could not upsert production send lock', error)
  } catch (error) {
    console.warn('Could not upsert production send lock', error)
  }
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
      action: 'SUPERADMIN_COMPANY_REACTIVATED',
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
      action: 'SUPERADMIN_COMPANY_PAUSED',
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

  const admin = await requireActorTestingWriteAccess(companyId)
  const now = new Date().toISOString()
  const failureReason = String(formData.get('failure_reason') ?? '').trim() || null
  const portalStatus = String(formData.get('portal_status') ?? '').trim() || null
  const rawPayload = String(formData.get('raw_payload') ?? '').trim() || null
  const runId = String(formData.get('ediel_test_run_id') ?? '').trim() || null

  if ((status === 'failed' || status === 'blocked') && !failureReason) {
    throw new Error('Felorsak krävs när testet nekas eller blockeras.')
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
    passed_at: status === 'passed' || status === 'manual_verified' ? now : null,
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
      testRunId: runId,
      status: mapTestStatusToRunStatus(status),
      failureReason,
      completedAt: status === 'running' ? null : now,
    }).catch(() => null)
  }

  await logTenantGovernanceEvent({
    action: status === 'passed' || status === 'manual_verified' ? 'SUPERADMIN_COMPANY_REACTIVATED' : 'SUPERADMIN_COMPANY_PAUSED',
    actorUserId: admin.userId,
    companyId,
    reason: `${testCase.label}: ${status}`,
    metadata: {
      actorTesting: true,
      action: 'ACTOR_TEST_RESULT_UPDATED',
      testKey: testCase.key,
      testId: testCase.testId,
      status,
      portalStatus,
      failureReason,
    },
  })

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
    action: 'SUPERADMIN_COMPANY_REACTIVATED',
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

function normalizeActorNotes(input: string | null | undefined, brpEdielId: string | null): string | null {
  const cleanBrp = brpEdielId?.trim() || null
  let base: Record<string, unknown> = {}

  if (input?.trim()) {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      } else {
        base = { legacyNotes: input }
      }
    } catch {
      base = { legacyNotes: input }
    }
  }

  if (cleanBrp) {
    base.balanceResponsibleEdielId = cleanBrp.toUpperCase()
    base.brpEdielId = cleanBrp.toUpperCase()
  }

  base.updatedAt = new Date().toISOString()
  return Object.keys(base).length > 0 ? JSON.stringify(base) : null
}

async function syncActorProfileRuntime(input: {
  companyId: string
  actorUserId: string
  environment: 'test' | 'production'
  actorName: string
  actorRole: string | null
  actorEdielId: string | null
  senderSubAddress: string | null
  applicationReference: string | null
  mailbox: string | null
  brpName: string | null
  brpEdielId: string | null
  brpStatus: string | null
  esettStatus: string | null
  smtpFromEmail: string | null
}) {
  const now = new Date().toISOString()
  const allowedActorRoles = new Set(['supplier', 'grid_owner', 'balance_responsible', 'service_provider'])
  const requestedActorRole = input.actorRole?.trim() || 'supplier'
  const actorRole = allowedActorRoles.has(requestedActorRole) ? requestedActorRole : 'supplier'
  const actorEdielId = input.actorEdielId?.trim() || null

  if (!actorEdielId) return

  const { data: existing, error: existingError } = await supabaseService
    .from('ediel_actor_settings')
    .select('id,notes')
    .eq('company_id', input.companyId)
    .eq('environment', input.environment)
    .eq('actor_role', actorRole)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingError) throw existingError

  const payload = {
    company_id: input.companyId,
    actor_name: input.actorName,
    sender_name: input.actorName,
    actor_role: actorRole,
    actor_ediel_id: actorEdielId,
    environment: input.environment,
    is_active: true,
    sender_sub_address: input.senderSubAddress,
    default_application_reference: input.applicationReference,
    mailbox: input.mailbox,
    default_charset: 'UNOC',
    default_timezone: 1,
    default_test_flag: input.environment === 'production' ? 0 : 1,
    smtp_from_email: input.smtpFromEmail,
    smtp_reply_to_email: input.smtpFromEmail,
    brp_name: input.brpName,
    brp_ediel_id: input.brpEdielId?.toUpperCase() ?? null,
    brp_status: input.brpStatus ?? 'missing',
    esett_status: input.esettStatus ?? 'missing',
    notes: normalizeActorNotes((existing as { notes?: string | null } | null)?.notes ?? null, input.brpEdielId),
    updated_by: input.actorUserId,
    updated_at: now,
  }

  if (existing?.id) {
    const { error } = await supabaseService
      .from('ediel_actor_settings')
      .update(payload)
      .eq('id', existing.id)
      .eq('company_id', input.companyId)
    if (error) throw error
    return
  }

  const { error } = await supabaseService
    .from('ediel_actor_settings')
    .insert({
      ...payload,
      created_by: input.actorUserId,
      created_at: now,
    })

  if (error) throw error
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
}

export async function saveActorProfileAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requireActorTestingWriteAccess(companyId)

  const read = (key: string) => {
    const value = String(formData.get(key) ?? '').trim()
    return value.length > 0 ? value : null
  }

  const { error } = await supabaseService
    .from('companies')
    .update({
      org_number: read('org_number'),
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
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId)

  if (error) throw error

  const companyName = read('company_name') ?? 'Aktör'
  const brpName = read('brp_name')
  const brpEdielId = read('brp_ediel_id')
  const brpStatus = read('brp_status') ?? 'missing'
  const esettStatus = read('esett_status') ?? 'missing'
  const smtpFromEmail = read('smtp_from_email') ?? 'ediel@gridex.se'

  await Promise.all([
    syncActorProfileRuntime({
      companyId,
      actorUserId: admin.userId,
      environment: 'test',
      actorName: companyName,
      actorRole: read('actor_role'),
      actorEdielId: read('test_ediel_id') ?? read('ediel_id'),
      senderSubAddress: read('test_sender_sub_address'),
      applicationReference: read('test_application_reference'),
      mailbox: read('test_mailbox'),
      brpName,
      brpEdielId,
      brpStatus,
      esettStatus,
      smtpFromEmail,
    }),
    syncActorProfileRuntime({
      companyId,
      actorUserId: admin.userId,
      environment: 'production',
      actorName: companyName,
      actorRole: read('actor_role'),
      actorEdielId: read('production_ediel_id') ?? read('ediel_id'),
      senderSubAddress: read('production_sender_sub_address'),
      applicationReference: read('production_application_reference'),
      mailbox: read('production_mailbox'),
      brpName,
      brpEdielId,
      brpStatus,
      esettStatus,
      smtpFromEmail,
    }),
  ])

  await logTenantGovernanceEvent({
    action: 'SUPERADMIN_COMPANY_REACTIVATED',
    actorUserId: admin.userId,
    companyId,
    reason: 'Aktörsprofil och Ediel-runtime uppdaterades inför aktörstest/produktion.',
    metadata: {
      actorTesting: true,
      action: 'ACTOR_PROFILE_AND_RUNTIME_UPDATED',
      brpEdielId,
    },
  })

  revalidateActorTestingViews(companyId)
}

export async function prepareProductionAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requireActorTestingWriteAccess(companyId)
  const returnPath = readReturnPath(formData, companyId)
  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })

  const status = readiness.blockingIssues.length === 0 ? 'production_prepared' : 'blocked'
  const reason = readiness.blockingIssues.map((issue) => issue.message).join(' · ') || null

  const { error } = await supabaseService
    .from('companies')
    .update({
      production_status: status,
      ediel_production_status: status,
      live_blocked_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId)

  if (error) throw error

  try {
    const { error: reviewError } = await supabaseService.from('company_go_live_reviews').insert({
      company_id: companyId,
      status,
      blocker_summary: readiness.blockingIssues,
      reviewed_by: admin.userId,
      metadata: { readinessCheckId: readiness.latestCheck.id, score: readiness.score },
    })
    if (reviewError) {
      console.warn('Could not store go-live preparation review', reviewError)
    }
  } catch (reviewError) {
    console.warn('Could not store go-live preparation review', reviewError)
  }

  await logTenantGovernanceEvent({
    action: 'SUPERADMIN_COMPANY_REACTIVATED',
    actorUserId: admin.userId,
    companyId,
    reason: status === 'production_prepared' ? 'Produktionsförberedelse markerad.' : 'Produktionsförberedelse blockerad.',
    metadata: {
      actorTesting: true,
      action: 'PRODUCTION_PREPARATION_REVIEWED',
      productionStatus: status,
      blockers: readiness.blockingIssues,
      readinessCheckId: readiness.latestCheck.id,
    },
  })

  await insertGoLiveEvent({
    companyId,
    eventType: 'readiness_check_run',
    fromStatus: readiness.summary.productionStatus,
    toStatus: status,
    reason,
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    metadata: { readiness },
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(
    companyId,
    status === 'production_prepared' ? 'prepared' : 'blocked',
    status === 'production_prepared' ? 'Produktionsförberedelse klar. Slutlig live-aktivering kräver separat bekräftelse.' : `Produktionsförberedelsen är blockerad: ${reason ?? 'Kontrollera blockerlistan.'}`,
    returnPath
  )
}

export async function activateLiveEdielAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requirePlatformAdminActionAccess()
  const returnPath = readReturnPath(formData, companyId)

  if (confirmation !== 'ACTIVATE PRODUCTION') {
    goLiveRedirect(companyId, 'error', 'Skriv “ACTIVATE PRODUCTION” för att aktivera production Ediel.', returnPath)
  }

  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })

  if (readiness.blockingIssues.length > 0) {
    const reason = readiness.blockingIssues.map((issue) => issue.message).join(' · ')
    const now = new Date().toISOString()
    await supabaseService
      .from('companies')
      .update({
        production_status: 'blocked',
        ediel_production_status: 'blocked',
        live_ediel_enabled: false,
        ediel_production_enabled: false,
        live_blocked_reason: reason,
        updated_at: now,
      })
      .eq('id', companyId)

    try {
      await supabaseService.from('company_go_live_reviews').insert({
        company_id: companyId,
        status: 'blocked',
        blocker_summary: readiness.blockingIssues,
        reviewed_by: admin.userId,
        metadata: { source: 'activateLiveEdielAction', blockedAt: now, readinessCheckId: readiness.latestCheck.id },
      })
    } catch (reviewError) {
      console.warn('Could not store blocked live activation review', reviewError)
    }

    revalidateActorTestingViews(companyId)
    goLiveRedirect(companyId, 'blocked', `Live är blockerat: ${reason}`, returnPath)
  }

  const now = new Date().toISOString()
  const previousStatus = readiness.summary.productionStatus
  const { error } = await supabaseService
    .from('companies')
    .update({
      operating_environment: 'production',
      production_status: 'live',
      live_ediel_enabled: true,
      live_approved_by: admin.userId,
      live_approved_at: now,
      live_blocked_reason: null,
      ediel_production_status: 'live',
      ediel_production_enabled: true,
      ediel_production_enabled_by: admin.userId,
      ediel_production_enabled_at: now,
      ediel_production_paused_at: null,
      ediel_production_paused_by: null,
      ediel_production_pause_reason: null,
      ediel_primary_production_route_profile_id: readiness.summary.activeProductionRouteProfileId,
      updated_at: now,
    })
    .eq('id', companyId)

  if (error) throw error

  try {
    const { error: reviewError } = await supabaseService.from('company_go_live_reviews').insert({
      company_id: companyId,
      status: 'live',
      blocker_summary: [],
      reviewed_by: admin.userId,
      approved_by: admin.userId,
      approved_at: now,
      metadata: { readinessCheckId: readiness.latestCheck.id, score: readiness.score },
    })
    if (reviewError) {
      console.warn('Could not store live activation review', reviewError)
    }
  } catch (reviewError) {
    console.warn('Could not store live activation review', reviewError)
  }

  await logTenantGovernanceEvent({
    action: 'SUPERADMIN_COMPANY_REACTIVATED',
    actorUserId: admin.userId,
    companyId,
    reason: 'Live Ediel aktiverad av superadmin.',
    metadata: {
      actorTesting: true,
      action: 'LIVE_EDIEL_ACTIVATED',
      approvedAt: now,
      readinessCheckId: readiness.latestCheck.id,
    },
  })

  await upsertProductionSendLock({ companyId, locked: false, reason: null, actorUserId: admin.userId })
  await insertGoLiveEvent({
    companyId,
    eventType: 'production_activated',
    fromStatus: previousStatus,
    toStatus: 'live',
    reason: 'Production Ediel aktiverad av superadmin.',
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    metadata: {
      readinessSnapshot: readiness,
      routeProfileId: readiness.summary.activeProductionRouteProfileId,
      environment: 'production',
    },
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
  const admin = await requirePlatformAdminActionAccess()
  const returnPath = readReturnPath(formData, companyId)
  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })
  const now = new Date().toISOString()

  const { error } = await supabaseService
    .from('companies')
    .update({
      production_status: 'paused',
      ediel_production_status: 'paused',
      ediel_production_enabled: false,
      live_ediel_enabled: false,
      live_blocked_reason: reason,
      ediel_production_paused_at: now,
      ediel_production_paused_by: admin.userId,
      ediel_production_pause_reason: reason,
      updated_at: now,
    })
    .eq('id', companyId)
  if (error) throw error

  await upsertProductionSendLock({ companyId, locked: true, reason, actorUserId: admin.userId })
  await insertGoLiveEvent({
    companyId,
    eventType: 'production_paused',
    fromStatus: readiness.summary.productionStatus,
    toStatus: 'paused',
    reason,
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    metadata: { inboundReceivingRemainsActive: true },
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'blocked', 'Production sending pausades. Inbound kan fortfarande tas emot och loggas.', returnPath)
}

export async function resumeProductionEdielAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requirePlatformAdminActionAccess()
  const returnPath = readReturnPath(formData, companyId)
  if (confirmation !== 'RESUME PRODUCTION') {
    goLiveRedirect(companyId, 'error', 'Skriv “RESUME PRODUCTION” för att återuppta production sending.', returnPath)
  }

  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true, ignorePaused: true })
  if (readiness.blockingIssues.length > 0) {
    goLiveRedirect(companyId, 'blocked', `Production kan inte återupptas: ${readiness.blockingIssues.map((issue) => issue.message).join(' · ')}`, returnPath)
  }

  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('companies')
    .update({
      production_status: 'live',
      ediel_production_status: 'live',
      ediel_production_enabled: true,
      live_ediel_enabled: true,
      live_blocked_reason: null,
      ediel_production_enabled_by: admin.userId,
      ediel_production_enabled_at: now,
      ediel_production_paused_at: null,
      ediel_production_paused_by: null,
      ediel_production_pause_reason: null,
      updated_at: now,
    })
    .eq('id', companyId)
  if (error) throw error

  await upsertProductionSendLock({ companyId, locked: false, reason: null, actorUserId: admin.userId })
  await insertGoLiveEvent({
    companyId,
    eventType: 'production_resumed',
    fromStatus: readiness.summary.productionStatus,
    toStatus: 'live',
    reason: 'Production sending återupptogs efter readiness check.',
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    metadata: { readinessSnapshot: readiness },
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'live', 'Production sending återupptogs.', returnPath)
}

export async function approveFirstLiveSendAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requirePlatformAdminActionAccess()
  const returnPath = readReturnPath(formData, companyId)
  if (confirmation !== 'APPROVE FIRST LIVE SEND') {
    goLiveRedirect(companyId, 'error', 'Skriv “APPROVE FIRST LIVE SEND” för att godkänna första live-send.', returnPath)
  }

  const readiness = await getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })
  if (!['ready', 'warning', 'live'].includes(readiness.status) || readiness.blockingIssues.length > 0) {
    goLiveRedirect(companyId, 'blocked', 'Första live-send kan inte godkännas innan readiness saknar blockerare.', returnPath)
  }

  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('companies')
    .update({
      ediel_first_live_send_approved_at: now,
      ediel_first_live_send_approved_by: admin.userId,
      updated_at: now,
    })
    .eq('id', companyId)
  if (error) throw error

  await insertGoLiveEvent({
    companyId,
    eventType: 'first_live_send_approved',
    fromStatus: readiness.summary.productionStatus,
    toStatus: readiness.summary.productionStatus,
    reason: 'Första production outbound-send godkänd av superadmin.',
    actorUserId: admin.userId,
    readinessCheckId: readiness.latestCheck.id,
    metadata: {
      edielId: readiness.summary.edielId,
      routeProfileId: readiness.summary.activeProductionRouteProfileId,
      mailboxId: readiness.summary.productionMailboxId,
    },
  })

  revalidateActorTestingViews(companyId)
  goLiveRedirect(companyId, 'prepared', 'Första live-send är godkänd.', returnPath)
}
