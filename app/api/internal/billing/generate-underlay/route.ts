import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { errorCode, internalApiError, isSchemaError } from '@/lib/http/apiError'
import { requireAdminApiAccess, requireAdminOperationalCompany } from '@/lib/admin/apiGuards'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { isValidIdempotencyKey } from '@/lib/api/idempotencyKey'
import { readUnderlayGenerationReceipt, type UnderlayGenerationIntent } from '@/lib/billing/underlayGenerationReceipt'
import { parseBillingMonth } from '@/lib/time/stockholm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isBillingPeriodLockError(message: string): boolean {
  return /Fakturaperioden .* (är locked|är exported|är closed|är låst|låst för)/i.test(message)
}

function isReceiptScopeConflict(error: unknown): boolean {
  return errorCode(error) === '22023' && (error as { message?: unknown } | null)?.message === 'billing_underlay_intent_scope_conflict'
}

async function readReceiptResponse(intent: UnderlayGenerationIntent) {
  let previous
  try {
    previous = await readUnderlayGenerationReceipt(intent)
  } catch (error) {
    if (errorCode(error) !== '23514' || (error as { message?: unknown } | null)?.message !== 'finance_copy_retention_tombstoned') throw error
    return internalApiError({
      context: 'billing-underlay-generate', error, code: 'billing_underlay_receipt_retained',
      message: 'Underlagskvittot kan inte längre visas efter gallring.', status: 410,
    })
  }
  return previous === null ? null : NextResponse.json({ data: previous })
}

type EngineState = 'not_entered' | 'pending' | 'fulfilled' | 'rejected'
let observationBootId: string | undefined

// Diagnostic metadata only. No identity, sink or listener failure may affect billing.
// An ended handler with a failed RPC does not establish the remote transaction outcome.
function observeOperation(request: Request) {
  try {
    const attemptId = randomUUID()
    const bootId = observationBootId ??= randomUUID()
    const candidate = request.headers.get('x-request-id')
    const correlationId = candidate?.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate) ? candidate : null
    const started = performance.now()
    let engineState: EngineState = 'not_entered', sequence = 0, ended = false
    let signal: AbortSignal | undefined, listener: (() => void) | undefined
    function emit(event: 'started' | 'client_disconnected' | 'terminal', status: number | null = null, thrown = false, abortWhilePending = false) {
      try {
        console.info(JSON.stringify({
          schema: 'billing_underlay_operation_v1', route: '/api/internal/billing/generate-underlay', method: 'POST',
          correlationId, attemptId, bootId, pid: process.pid, event, sequence: ++sequence,
          elapsedMs: Math.max(0, Math.floor(performance.now() - started)), engineState, status, abortWhilePending, thrown,
        }))
      } catch { /* Missing or incomplete capture is unqualified; billing still runs. */ }
    }
    function cleanup() {
      const target = signal, callback = listener
      signal = undefined; listener = undefined
      if (!target || !callback) return
      try { target.removeEventListener('abort', callback) } catch {
        // A failing instance method must not strand a native listener or change billing.
        try { EventTarget.prototype.removeEventListener.call(target, 'abort', callback) } catch { /* Unsupported target: no proof. */ }
      }
    }
    return {
      enter() {
        engineState = 'pending'
        emit('started')
        try {
          signal = request.signal
          listener = () => { if (engineState === 'pending') emit('client_disconnected', null, false, true) }
          if (signal.aborted) emit('client_disconnected') // Already aborted is not an observed pending abort.
          else signal.addEventListener('abort', listener, { once: true })
        } catch { /* Passive observation never cancels or prevents the engine call. */ }
      },
      settled(state: 'fulfilled' | 'rejected') { engineState = state },
      cleanup,
      finish(response: Response | null, thrown = false) {
        cleanup()
        if (ended) return
        ended = true
        let status: number | null = null
        try { if (response && Number.isInteger(response.status)) status = response.status } catch { /* Diagnostic field only. */ }
        emit('terminal', status, thrown)
      },
    }
  } catch { return undefined }
}

async function generate(request: Request, observation: ReturnType<typeof observeOperation>) {
  const access = await requireAdminApiAccess(['billing_underlay.export'])
  if (access.response) return access.response

  const intentKey = request.headers.has('Idempotency-Key') ? request.headers.get('Idempotency-Key') : null
  try {
    const companyId = await requireAdminOperationalCompany(access.guard)
    const input: unknown = await request.json().catch(() => null)
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const billingMonth = typeof body.billing_month === 'string' ? body.billing_month : typeof body.billingMonth === 'string' ? body.billingMonth : ''
    if (!/^\d{4}-\d{2}$/.test(billingMonth)) return NextResponse.json({ error: 'billing_month måste anges som YYYY-MM.' }, { status: 400 })
    if (intentKey !== null && !isValidIdempotencyKey(intentKey)) {
      return NextResponse.json({ error: 'Idempotency-Key har ogiltigt format.' }, { status: 400 })
    }
    try {
      parseBillingMonth(billingMonth)
    } catch {
      return NextResponse.json({ error: 'Fakturamånad är ogiltig.' }, { status: 400 })
    }
    let intent: UnderlayGenerationIntent | null = null
    if (intentKey !== null) {
      intent = { key: intentKey, companyId, actorUserId: access.guard.userId, billingMonth, scope: { customerId: null, meteringPointId: null } }
      const previous = await readReceiptResponse(intent)
      if (previous) return previous
    }

    observation?.enter()
    let result
    try {
      result = await generateBillingUnderlaysForMonth({ companyId, billingMonth, createdBy: access.guard.userId, ...(intentKey === null ? {} : { intentKey }) })
      observation?.settled('fulfilled')
    } catch (error) {
      observation?.settled('rejected')
      if (intent) {
        // A concurrent request or a lost database reply may have committed the same intent.
        let previous
        try {
          previous = await readReceiptResponse(intent)
        } catch (lookupError) {
          if (isReceiptScopeConflict(lookupError)) throw lookupError
        }
        if (previous) return previous
      }
      throw error
    } finally {
      observation?.cleanup()
    }
    return NextResponse.json({ data: result })
  } catch (error) {
    if (intentKey !== null) {
      const detail = String((error as { message?: unknown } | null)?.message ?? '')
      if (isReceiptScopeConflict(error)) {
        return internalApiError({ context: 'billing-underlay-generate', error, code: detail, message: 'Begäran gäller en annan fakturaperiod.', status: 409 })
      }
      if (detail === 'billing_underlay_intent_history_authority_required') {
        return internalApiError({ context: 'billing-underlay-generate', error, code: detail, message: 'Körningen kräver granskning av historikbegäran.', status: 409 })
      }
      if (isSchemaError(error)) {
        return internalApiError({ context: 'billing-underlay-generate', error, code: 'billing_underlay_receipt_unavailable', message: 'Underlagskvittot är inte tillgängligt just nu.', status: 503 })
      }
    }
    const internalMessage = error instanceof Error ? error.message : ''
    return internalApiError({ context: 'billing-underlay-generate', error, code: 'billing_underlay_generate_failed', message: 'Fakturaunderlaget kunde inte skapas.', status: isBillingPeriodLockError(internalMessage) ? 409 : 500 })
  }
}

export async function POST(request: Request) {
  const observation = observeOperation(request)
  try {
    // Await the original business handler, including its response/error construction.
    const response = await generate(request, observation)
    observation?.finish(response)
    return response
  } catch (error) {
    observation?.finish(null, true)
    throw error
  }
}
