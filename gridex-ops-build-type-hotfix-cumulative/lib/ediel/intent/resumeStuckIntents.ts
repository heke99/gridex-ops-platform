// lib/ediel/intent/resumeStuckIntents.ts
//
// Resume engine for stuck outbound intents (PART 4: "can resume stuck
// validated/not_rendered/not_queued intents"). A validated intent that never
// reached the outbox (render crashed, process interrupted, route became ready
// later) must not sit invisible forever. This sweep re-runs the sanctioned
// dispatcher idempotently so the intent either reaches the outbox or records a
// controlled blocker.

import { supabaseService } from '@/lib/supabase/service'
import { updateIntentLifecycle } from '@/lib/ediel/intent/intentEngine'
import type { EdielEnvironment } from '@/lib/ediel/types'

type StuckIntentRow = {
  id: string
  company_id: string
  environment: string | null
  business_process: string | null
  grid_owner_information_request_id: string | null
  supplier_switch_request_id: string | null
  customer_info_request_id: string | null
  communication_route_id: string | null
  operation_id: string | null
  payload: Record<string, unknown> | null
  validation_status: string | null
  render_status: string | null
  outbox_status: string | null
  created_by: string | null
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return (
    ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) ||
    /schema cache|does not exist|column .* does not exist/i.test(message)
  )
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function intentEnvironment(value: string | null): EdielEnvironment | null {
  if (value === 'test' || value === 'production') return value
  return null
}

function gridOwnerDataRequestIdFromIntent(row: StuckIntentRow): string | null {
  const payload = asRecord(row.payload)
  return (
    text(payload.grid_owner_data_request_id) ??
    text(payload.gridOwnerDataRequestId) ??
    text(payload.data_request_id) ??
    text(payload.dataRequestId) ??
    null
  )
}

async function markUnsupportedOrMalformedIntent(params: {
  row: StuckIntentRow
  actorUserId: string | null
  code: string
  message: string
}): Promise<void> {
  await updateIntentLifecycle(params.row.id, {
    validationStatus: 'blocked',
    renderStatus: 'failed',
    outboxStatus: 'failed',
    actorUserId: params.actorUserId,
    blockingReasons: [
      {
        code: params.code,
        message: params.message,
        severity: 'block',
      },
    ],
  })
}

export type ResumeStuckIntentsResult = {
  candidates: number
  resumed: number
  blocked: number
  skipped: number
  errors: string[]
}

// Finds validated outbound intents that never reached the outbox and re-runs the
// process-specific dispatcher. Facility lookup and customer masterdata are fully
// resumable now; other outbound business processes are deliberately marked with
// a controlled blocker until their render gateways are wired in.
export async function resumeStuckEdielIntents(input: {
  companyId?: string | null
  limit?: number
  actorUserId?: string | null
} = {}): Promise<ResumeStuckIntentsResult> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
  let query = supabaseService
    .from('ediel_message_intents')
    .select(
      [
        'id',
        'company_id',
        'environment',
        'business_process',
        'grid_owner_information_request_id',
        'supplier_switch_request_id',
        'customer_info_request_id',
        'communication_route_id',
        'operation_id',
        'payload',
        'validation_status',
        'render_status',
        'outbox_status',
        'created_by',
      ].join(','),
    )
    .eq('validation_status', 'validated')
    .in('render_status', ['not_rendered', 'failed'])
    .eq('outbox_status', 'not_queued')
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) {
    if (isMissingSchema(error)) {
      return { candidates: 0, resumed: 0, blocked: 0, skipped: 0, errors: ['ediel_message_intents_schema_missing'] }
    }
    throw error
  }

  const rows = ((data ?? []) as unknown) as StuckIntentRow[]

  let resumed = 0
  let blocked = 0
  let skipped = 0
  const errors: string[] = []

  const seen = new Set<string>()
  for (const row of rows) {
    const actorUserId = input.actorUserId ?? row.created_by ?? null
    const process = text(row.business_process) ?? 'unknown'
    const dedupeKey = [process, row.grid_owner_information_request_id, gridOwnerDataRequestIdFromIntent(row), row.supplier_switch_request_id, row.id]
      .filter(Boolean)
      .join(':')
    if (seen.has(dedupeKey)) {
      skipped += 1
      continue
    }
    seen.add(dedupeKey)

    try {
      if (process === 'facility_lookup') {
        const requestId = text(row.grid_owner_information_request_id)
        if (!requestId) {
          await markUnsupportedOrMalformedIntent({
            row,
            actorUserId,
            code: 'facility_lookup_request_id_missing',
            message: 'Facility lookup-intent saknar grid_owner_information_request_id och kan inte återupptas.',
          })
          blocked += 1
          continue
        }
        const { dispatchFacilityLookupEdifact } = await import(
          '@/lib/customer-operations/facilityLookupEdifactDispatch'
        )
        const result = await dispatchFacilityLookupEdifact({
          companyId: row.company_id,
          requestId,
          actorUserId,
        })
        if (result.status === 'queued' || result.status === 'already_waiting') resumed += 1
        else if (result.status === 'blocked' || result.status === 'failed') blocked += 1
        else skipped += 1
        continue
      }

      if (process === 'customer_masterdata') {
        const gridOwnerDataRequestId = gridOwnerDataRequestIdFromIntent(row)
        if (!gridOwnerDataRequestId) {
          await markUnsupportedOrMalformedIntent({
            row,
            actorUserId,
            code: 'grid_owner_data_request_id_missing',
            message: 'Customer masterdata-intent saknar grid_owner_data_request_id och kan inte återupptas.',
          })
          blocked += 1
          continue
        }
        const { prepareAndQueueProdatZ01FromDataRequest } = await import(
          '@/lib/ediel/flows/prodatCustomerMasterdata'
        )
        const result = await prepareAndQueueProdatZ01FromDataRequest({
          actorUserId: actorUserId ?? 'system',
          gridOwnerDataRequestId,
          communicationRouteId: row.communication_route_id,
          environment: intentEnvironment(row.environment),
          operationId: row.operation_id,
        })
        if (result.prepared) resumed += 1
        else if (result.blockerCode || result.blockerReason) blocked += 1
        else skipped += 1
        continue
      }

      await markUnsupportedOrMalformedIntent({
        row,
        actorUserId,
        code: 'resume_dispatcher_not_implemented',
        message: `Resume-dispatcher saknas ännu för outbound business_process=${process}.`,
      })
      blocked += 1
    } catch (resumeError) {
      errors.push(`${row.id}: ${resumeError instanceof Error ? resumeError.message : String(resumeError)}`)
      blocked += 1
    }
  }

  return { candidates: rows.length, resumed, blocked, skipped, errors }
}
