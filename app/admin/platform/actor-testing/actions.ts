'use server'

import { revalidatePath } from 'next/cache'
import { isPlatformAdminContext, requireAdminActionAccess, requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { createEdielTestRun, updateEdielTestRunStatus } from '@/lib/ediel/db'
import {
  buildActorTestResultEvidence,
  getActorTestingSummary,
  getActorTestCase,
  mapTestStatusToRunStatus,
  userCanManageActorTestingForCompany,
  type ActorTestStatus,
} from '@/lib/ediel/actorTesting'
import { logTenantGovernanceEvent } from '@/lib/tenant/governance'

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
  const allowed = await userCanManageActorTestingForCompany(admin.userId, companyId, isPlatformAdminContext(admin))

  if (!allowed) {
    throw new Error('Du saknar behörighet att hantera aktörstester för detta bolag.')
  }

  return admin
}

function revalidateActorTestingViews(companyId: string) {
  revalidatePath('/admin/platform/actor-testing')
  revalidatePath(`/admin/platform/actor-testing/${companyId}`)
  revalidatePath('/admin/platform/go-live')
  revalidatePath(`/admin/platform/go-live/${companyId}`)
  revalidatePath('/admin/whitelabel/actor-testing')
  revalidatePath('/admin/whitelabel/go-live')
  revalidatePath('/admin/company-actor-status')
}

export async function startActorTestAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const testKey = readRequiredString(formData, 'test_key').toUpperCase()
  const testCase = getActorTestCase(testKey)
  if (!testCase) throw new Error('Okänt aktörstest.')

  const admin = await requireActorTestingWriteAccess(companyId)
  const now = new Date().toISOString()

  const run = await createEdielTestRun({
    actorUserId: admin.userId,
    companyId,
    approvalVersion: 'AGT-2026A',
    roleCode: 'supplier',
    testSuite: testCase.suite,
    testCaseCode: testCase.key,
    title: testCase.label,
    status: 'running',
    startedAt: now,
    notes: JSON.stringify({
      actorTestingModule: true,
      testId: testCase.testId,
      messageFamily: testCase.messageFamily,
      messageCode: testCase.messageCode,
      direction: testCase.direction,
    }),
  })

  const { error } = await supabaseService.from('actor_test_results').upsert(
    {
      company_id: companyId,
      test_key: testCase.key,
      test_name: testCase.label,
      test_id: testCase.testId,
      package_key: testCase.packageKey,
      message_family: testCase.messageFamily,
      message_code: testCase.messageCode,
      direction: testCase.direction,
      status: 'running',
      latest_run_at: now,
      failure_reason: null,
      portal_status: null,
      ediel_test_run_id: run.id,
      evidence: buildActorTestResultEvidence({
        testCase,
        status: 'running',
        actorUserId: admin.userId,
      }),
      created_by: admin.userId,
      updated_by: admin.userId,
      updated_at: now,
    },
    { onConflict: 'company_id,test_key' }
  )

  if (error) throw error

  await logTenantGovernanceEvent({
    action: 'SUPERADMIN_COMPANY_REACTIVATED',
    actorUserId: admin.userId,
    companyId,
    reason: `Aktörstest startat: ${testCase.label}`,
    metadata: {
      actorTesting: true,
      action: 'ACTOR_TEST_STARTED',
      testKey: testCase.key,
      testId: testCase.testId,
      edielTestRunId: run.id,
    },
  })

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

export async function prepareProductionAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const admin = await requireActorTestingWriteAccess(companyId)
  const summary = await getActorTestingSummary(companyId)
  if (!summary) throw new Error('Bolaget hittades inte.')

  const status = summary.goLiveBlockers.length === 0 ? 'production_prepared' : 'blocked'
  const reason = summary.goLiveBlockers.join(' · ') || null

  const { error } = await supabaseService
    .from('companies')
    .update({
      production_status: status,
      live_blocked_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', companyId)

  if (error) throw error

  try {
    const { error: reviewError } = await supabaseService.from('company_go_live_reviews').insert({
      company_id: companyId,
      status,
      blocker_summary: summary.goLiveBlockers,
      reviewed_by: admin.userId,
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
      blockers: summary.goLiveBlockers,
    },
  })

  revalidateActorTestingViews(companyId)
}

export async function activateLiveEdielAction(formData: FormData) {
  const companyId = readRequiredString(formData, 'company_id')
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const admin = await requirePlatformAdminActionAccess()

  if (confirmation !== 'Jag bekräftar') {
    throw new Error('Skriv exakt “Jag bekräftar” för att aktivera live Ediel.')
  }

  const summary = await getActorTestingSummary(companyId)
  if (!summary) throw new Error('Bolaget hittades inte.')

  if (summary.goLiveBlockers.length > 0) {
    const reason = summary.goLiveBlockers.join(' · ')
    await supabaseService
      .from('companies')
      .update({ production_status: 'blocked', live_ediel_enabled: false, live_blocked_reason: reason, updated_at: new Date().toISOString() })
      .eq('id', companyId)
    revalidateActorTestingViews(companyId)
    throw new Error(`Live är blockerat: ${reason}`)
  }

  const now = new Date().toISOString()
  const { error } = await supabaseService
    .from('companies')
    .update({
      operating_environment: 'production',
      production_status: 'live',
      live_ediel_enabled: true,
      live_approved_by: admin.userId,
      live_approved_at: now,
      live_blocked_reason: null,
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
    },
  })

  revalidateActorTestingViews(companyId)
}
