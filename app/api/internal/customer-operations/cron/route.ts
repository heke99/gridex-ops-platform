import { randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processCustomerOperationJobs } from '@/lib/customer-operations/automation'
import { validateAutomationUserConfig } from '@/lib/customer-operations/automationConfig'
import { processReadyFacilityLookupEdifactDispatches } from '@/lib/customer-operations/facilityLookupEdifactDispatch'
import { resumeStuckEdielIntents } from '@/lib/ediel/intent/resumeStuckIntents'
import { expireOverduePowersOfAttorney } from '@/lib/operations/powerOfAttorneyExpiry'
import { reconcileCustomerApplicationContinuationJobs } from '@/lib/website/customerApplicationReconciliation'
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

    // Resolve geographic grid-owner dependencies BEFORE continuation jobs run.
    // Unique SVK postcode-polygon matches (>65%) can canonicalize without
    // Lantmäteriet. Exact-address precision is only a fallback when postcode
    // evidence is insufficient; Papilite never becomes grid-owner authority.
    const exactAddressResolution = await processPendingExactAddressResolutions({
      limit: Math.min(requestedLimit, 5),
    })

    const customerApplicationReconciliation = await reconcileCustomerApplicationContinuationJobs({
      limit: Math.min(requestedLimit * 2, 100),
    })
    const customerOperations = await processCustomerOperationJobs({
      workerId: `customer-operations-cron:${new Date().toISOString()}`,
      limit: requestedLimit,
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
    return NextResponse.json({
      ok: true,
      result: {
        exactAddressResolution,
        customerApplicationReconciliation,
        customerOperations,
        facilityLookupDispatch,
        resumedIntents,
        poaExpiry,
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
