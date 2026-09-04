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
import { reconcileLegacyFacilityRequestLinks } from '@/lib/website/legacyFacilityRequestReconciliation'
import { processPendingExactAddressResolutions } from '@/lib/energy/pendingExactAddressResolution'

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

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  try {
    const requestedLimit = limit(request.nextUrl.searchParams.get('limit'))
    // Runtime validation of the automation actor config. A broken config must
    // be loudly visible on every cron run, but must not stop unrelated job
    // processing — jobs that need the actor fail fast with a typed
    // missing_automation_user configuration blocker instead of retrying.
    const automationUserConfig = await validateAutomationUserConfig()
    if (!automationUserConfig.ok) {
      console.error('[customer-operations-cron] automation user configuration invalid', {
        issue: automationUserConfig.issue,
        message: automationUserConfig.message,
      })
    }

    // Resolve exact address dependencies BEFORE continuation jobs run. The
    // resolver is dormant until Lantmäteriet credentials exist. Once enabled,
    // it stores only address/geodata evidence, maps the exact SWEREF99 point to
    // the existing SVK polygon master, and wakes the SAME idempotent customer
    // job when the canonical grid owner is verified. Postal candidates never
    // become canonical through this path.
    const exactAddressResolution = await processPendingExactAddressResolutions({
      limit: Math.min(requestedLimit, 5),
    })

    // Legacy rows may already have a real, sent grid-owner information request
    // but lack the website-application back-link. Correlate only an exact,
    // unique company + customer + site match. This step never creates or sends
    // an external request; ambiguous cases remain review-only.
    const legacyFacilityRequestReconciliation = await reconcileLegacyFacilityRequestLinks({
      limit: Math.min(requestedLimit * 2, 100),
    })

    const customerApplicationReconciliation = await reconcileCustomerApplicationContinuationJobs({
      limit: Math.min(requestedLimit * 2, 100),
    })
    const customerOperations = await processCustomerOperationJobs({
      workerId: `customer-operations-cron:${new Date().toISOString()}`,
      limit: requestedLimit,
    })
    // PRODAT Z01 has two independent 30-minute watches from the actual
    // message_sent_at: technical CONTRL and business Z02/negative APERAK.
    // The watchdog only escalates; it never creates or resends a Z01.
    const z01ResponseSla = await runZ01ResponseSlaWatchdog({
      limit: Math.min(requestedLimit * 2, 100),
    })
    const facilityLookupDispatch = await processReadyFacilityLookupEdifactDispatches({
      limit: Math.min(requestedLimit, 25),
    })
    // Resume validated intents that never reached the outbox (render crashed,
    // route became ready later, interrupted run). Idempotent + tenant-safe.
    const resumedIntents = await resumeStuckEdielIntents({
      limit: Math.min(requestedLimit, 25),
    })
    // Persist POA expiry: previously only evaluated at read time, leaving rows
    // 'signed' forever in the admin UI and audit trail.
    const poaExpiry = await expireOverduePowersOfAttorney({ limit: 100 })

    // Becoming the active electricity supplier is a market-state transition,
    // not an ACK transition. Run only with a verified automation actor; the
    // atomic RPC re-checks tenant, inbound Z04 and Stockholm effective date.
    const supplierSwitchActivations = automationUserConfig.ok && automationUserConfig.userId
      ? await processReadySupplierSwitchActivations({
          limit: Math.min(requestedLimit, 50),
          actorUserId: automationUserConfig.userId,
        })
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

    return NextResponse.json({
      ok: true,
      result: {
        exactAddressResolution,
        legacyFacilityRequestReconciliation,
        customerApplicationReconciliation,
        customerOperations,
        z01ResponseSla,
        facilityLookupDispatch,
        resumedIntents,
        poaExpiry,
        supplierSwitchActivations,
        automationUserConfig: {
          ok: automationUserConfig.ok,
          issue: automationUserConfig.issue,
        },
      },
    })
  } catch (error) {
    const traceId = randomUUID()
    console.error('[customer-operations-cron] failed', { traceId, error })
    return NextResponse.json(
      { ok: false, error: 'Kundautomation kunde inte köras just nu.', code: 'customer_operation_processing_failed', trace_id: traceId },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) { return run(request) }
export async function POST(request: NextRequest) { return run(request) }
