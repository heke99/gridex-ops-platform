import { advanceSupplyMarketDeadlines } from '@/lib/ediel/flows/supplyMarketTransition'
import { advancePermissionMarketDeadlines } from '@/lib/ediel/permissions/permissionMarketTransition'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processCustomerOperationJobs } from '@/lib/customer-operations/automation'
import { validateAutomationUserConfig } from '@/lib/customer-operations/automationConfig'
import { processReadyFacilityLookupEdifactDispatches } from '@/lib/customer-operations/facilityLookupEdifactDispatch'
import { resumeStuckEdielIntents } from '@/lib/ediel/intent/resumeStuckIntents'
import { runZ01ResponseSlaWatchdog } from '@/lib/ediel/operations/z01ResponseSlaWatchdog'
import { expireOverduePowersOfAttorney } from '@/lib/operations/powerOfAttorneyExpiry'
import { processReadySupplierSwitchActivations } from '@/lib/operations/supplierSwitchActivationSweep'
import { reconcileCustomerApplicationContinuationJobs } from '@/lib/website/customerApplicationReconciliation'
import { processPendingContractConfirmations } from '@/lib/customer-contracts/onlineSigning'
import { reconcileLegacyFacilityRequestLinks } from '@/lib/website/legacyFacilityRequestReconciliation'
import { processPendingExactAddressResolutions } from '@/lib/energy/pendingExactAddressResolution'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
import { sweepEdielBusinessExpectations } from '@/lib/ediel/operations/businessExpectationSweep'
import { runManualGridOwnerFollowUpWatchdog } from '@/lib/customer-operations/manualGridOwnerFollowUps'
import { isUndeployedSchemaError } from '@/lib/customer-operations/optionalCronStep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clean(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function authorized(request: NextRequest) {
  const expected = [process.env.CUSTOMER_OPERATION_CRON_SECRET, process.env.CRON_SECRET]
    .map(clean)
    .filter((value): value is string => Boolean(value))
  if (expected.length === 0) return false

  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? clean(authorization.slice('bearer '.length))
    : clean(request.headers.get('x-cron-secret'))
  return Boolean(token && expected.some((secret) => {
    const left = Buffer.from(token)
    const right = Buffer.from(secret)
    return left.length === right.length && timingSafeEqual(left, right)
  }))
}

function limit(value: string | null) {
  const parsed = Number(value ?? 20)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 100) : 20
}

type CronStepFailure = { failed: true; code: 'customer_operation_step_failed'; trace_id: string }
type CronStepSkipped = { skippedReason: 'schema_not_deployed' }

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  const requestedLimit = limit(request.nextUrl.searchParams.get('limit'))
  const failedSteps: Array<{ step: string; trace_id: string }> = []

  // Every step is isolated: one throwing step is reported and the remaining
  // steps (POA expiry, Z01 SLA, switch activation...) still run.
  // A step whose database objects are not deployed yet is skipped and
  // reported, not counted as a failure.
  async function step<T>(name: string, fn: () => Promise<T>): Promise<T | CronStepFailure | CronStepSkipped> {
    try {
      return await fn()
    } catch (error) {
      if (isUndeployedSchemaError(error)) {
        console.warn('[customer-operations-cron] step skipped: schema not deployed', {
          step: name,
          code: (error as { code?: string }).code,
        })
        return { skippedReason: 'schema_not_deployed' }
      }
      const traceId = randomUUID()
      console.error('[customer-operations-cron] step failed', { step: name, traceId, error })
      failedSteps.push({ step: name, trace_id: traceId })
      return { failed: true, code: 'customer_operation_step_failed', trace_id: traceId }
    }
  }

  // Runtime validation of the automation actor config. A broken config must
  // be loudly visible on every cron run, but must not stop unrelated job
  // processing — jobs that need the actor fail fast with a typed
  // missing_automation_user configuration blocker instead of retrying.
  const validatedConfig = await step('automationUserConfig', () => validateAutomationUserConfig())
  const automationUserConfig = 'failed' in validatedConfig || 'skippedReason' in validatedConfig
    ? { ok: false as const, issue: 'validation_failed', message: null, userId: null }
    : validatedConfig
  if (!automationUserConfig.ok) {
    console.error('[customer-operations-cron] automation user configuration invalid', {
      issue: automationUserConfig.issue,
      message: automationUserConfig.message,
    })
  }
  const actorUserId = automationUserConfig.ok && automationUserConfig.userId ? automationUserConfig.userId : null

  // Resolve geographic grid-owner dependencies BEFORE continuation jobs run.
  // OPS tries Papilite postcode centroid first; SVK geometry remains the
  // authority. GeoTorget/Lantmäteriet is only an exact-address fallback when
  // Papilite/SVK confidence is insufficient.
  const exactAddressResolution = await step('exactAddressResolution', () => processPendingExactAddressResolutions({
    limit: Math.min(requestedLimit, 5),
  }))

  // Legacy rows may already have a real, sent grid-owner information request
  // but lack the website-application back-link. Correlate only an exact,
  // unique company + customer + site match. This step never creates or sends
  // an external request; ambiguous cases remain review-only.
  const legacyFacilityRequestReconciliation = await step('legacyFacilityRequestReconciliation', () => reconcileLegacyFacilityRequestLinks({
    limit: Math.min(requestedLimit * 2, 100),
  }))

  const customerApplicationReconciliation = await step('customerApplicationReconciliation', () => reconcileCustomerApplicationContinuationJobs({
    limit: Math.min(requestedLimit * 2, 100),
  }))
  // Signed contracts whose confirmation mail could not be queued at signing
  // time (F27). Retries never sign again; idempotency keys are stable.
  const contractConfirmations = await step('contractConfirmations', () => processPendingContractConfirmations(
    Math.min(requestedLimit, 50),
  ))
  const customerOperations = await step('customerOperations', () => processCustomerOperationJobs({
    workerId: `customer-operations-cron:${new Date().toISOString()}`,
    limit: requestedLimit,
  }))
  // PRODAT Z01 has two independent 30-minute watches from the actual
  // message_sent_at: technical CONTRL and business Z02/negative APERAK.
  // The watchdog only escalates; it never creates or resends a Z01.
  const z01ResponseSla = await step('z01ResponseSla', () => runZ01ResponseSlaWatchdog({
    limit: Math.min(requestedLimit * 2, 100),
  }))
  const inboundAckSla = actorUserId
    ? await step('inboundAckSla', () => checkAckDeadlines({ actorUserId, limit: Math.min(requestedLimit * 2, 100) }))
    : { warning: 0, critical: 0, expired: 0, updated: 0, configurationBlocked: true }
  const permissionMarketDeadlines = actorUserId
    ? await step('permissionMarketDeadlines', () => advancePermissionMarketDeadlines({ actorUserId, limit: Math.min(requestedLimit, 100) }))
    : { updated: 0, configurationBlocked: true }
  const supplyMarketDeadlines = actorUserId
    ? await step('supplyMarketDeadlines', () => advanceSupplyMarketDeadlines({ actorUserId, limit: Math.min(requestedLimit, 100) }))
    : { updated: 0, configurationBlocked: true }
  const businessExpectations = actorUserId
    ? await step('businessExpectations', () => sweepEdielBusinessExpectations({ actorUserId, limit: Math.min(requestedLimit * 2, 100) }))
    : { scopes: 0, observed: 0, configurationBlocked: true }
  const facilityLookupDispatch = await step('facilityLookupDispatch', () => processReadyFacilityLookupEdifactDispatches({
    limit: Math.min(requestedLimit, 25),
  }))
  // Resume validated intents that never reached the outbox (render crashed,
  // route became ready later, interrupted run). Idempotent + tenant-safe.
  const resumedIntents = await step('resumedIntents', () => resumeStuckEdielIntents({
    limit: Math.min(requestedLimit, 25),
  }))
  // Persist POA expiry: previously only evaluated at read time, leaving rows
  // 'signed' forever in the admin UI and audit trail.
  const poaExpiry = await step('poaExpiry', () => expireOverduePowersOfAttorney({ limit: 100 }))

  // Manual grid-owner requests waiting for an answer: reminder after 5 and
  // escalation after 10 Swedish business days (bounded batch, POA re-checked).
  const manualGridOwnerFollowUps = await step('manualGridOwnerFollowUps', () => runManualGridOwnerFollowUpWatchdog({
    limit: Math.min(requestedLimit, 25),
  }))

  // Becoming the active electricity supplier is a market-state transition,
  // not an ACK transition. Run only with a verified automation actor; the
  // atomic RPC re-checks tenant, inbound Z04 and Stockholm effective date.
  const supplierSwitchActivations = actorUserId
    ? await step('supplierSwitchActivations', () => processReadySupplierSwitchActivations({
        limit: Math.min(requestedLimit, 50),
        actorUserId,
      }))
    : {
        marketDate: null,
        scanned: 0,
        ready: 0,
        activated: 0,
        alreadyCompleted: 0,
        waiting: 0,
        blocked: 0,
        failed: 0,
        failures: [],
        configurationBlocked: true,
      }

  const result = {
    exactAddressResolution,
    legacyFacilityRequestReconciliation,
    customerApplicationReconciliation,
    contractConfirmations,
    customerOperations,
    z01ResponseSla,
    inboundAckSla,
    permissionMarketDeadlines,
    supplyMarketDeadlines,
    businessExpectations,
    facilityLookupDispatch,
    resumedIntents,
    poaExpiry,
    manualGridOwnerFollowUps,
    supplierSwitchActivations,
    automationUserConfig: {
      ok: automationUserConfig.ok,
      issue: automationUserConfig.issue,
    },
  }

  if (failedSteps.length > 0) {
    // All steps were attempted; report which ones failed.
    return NextResponse.json(
      {
        ok: false,
        error: 'Kundautomation kunde inte köras fullständigt.',
        code: 'customer_operation_processing_failed',
        trace_id: failedSteps[0].trace_id,
        failed_steps: failedSteps,
        result,
      },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true, result })
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
