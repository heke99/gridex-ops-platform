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
  message_family: string | null
  message_code: string | null
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

function normalizeProdatSwitchCode(value: string | null, process: string):
  | 'Z03'
  | 'Z04'
  | 'Z05'
  | 'Z06'
  | 'Z09'
  | 'Z10'
  | 'Z13'
  | 'Z14'
  | 'Z15'
  | 'Z18'
  | null {
  const code = String(value ?? '').trim().toUpperCase()
  if (code === 'Z03' || code === 'Z04' || code === 'Z05' || code === 'Z06' || code === 'Z09' || code === 'Z10' || code === 'Z13' || code === 'Z14' || code === 'Z15' || code === 'Z18') {
    return code
  }
  if (process === 'supplier_switch') return 'Z03'
  if (process === 'metering_permission' || process === 'metering_access') return 'Z13'
  return null
}

function normalizeUtiltsCode(value: string | null): 'E73' | 'E66' | null {
  const code = String(value ?? '').trim().toUpperCase()
  if (code === 'E73' || code === 'E66') return code
  if (!code) return 'E73'
  return null
}

function numberFromPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

async function linkResumeResultToIntent(params: {
  row: StuckIntentRow
  actorUserId: string | null
  message: { id?: string | null; outbound_request_id?: string | null } | null | undefined
}): Promise<void> {
  const messageId = text(params.message?.id)
  const outboundRequestId = text(params.message?.outbound_request_id)

  if (messageId) {
    const { error } = await supabaseService
      .from('ediel_messages')
      .update({ intent_id: params.row.id, updated_by: params.actorUserId ?? 'system' })
      .eq('id', messageId)
    if (error && !isMissingSchema(error)) throw error
  }

  await updateIntentLifecycle(params.row.id, {
    renderStatus: messageId ? 'rendered' : 'failed',
    outboxStatus: messageId ? 'queued' : 'failed',
    edielMessageId: messageId ?? null,
    outboundRequestId: outboundRequestId ?? null,
    actorUserId: params.actorUserId,
  })
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
// process-specific dispatcher. The dispatcher covers active outbound business
// processes and records controlled blockers when a persisted intent is malformed
// instead of leaving it invisible at not_rendered/not_queued.
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
        'message_family',
        'message_code',
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

      if (process === 'supplier_switch' || process === 'metering_permission' || process === 'metering_access') {
        const switchRequestId = text(row.supplier_switch_request_id)
        const messageCode = normalizeProdatSwitchCode(text(row.message_code), process)
        if (!switchRequestId) {
          await markUnsupportedOrMalformedIntent({
            row,
            actorUserId,
            code: 'supplier_switch_request_id_missing',
            message: `${process}-intent saknar supplier_switch_request_id och kan inte återupptas.`,
          })
          blocked += 1
          continue
        }
        if (!messageCode) {
          await markUnsupportedOrMalformedIntent({
            row,
            actorUserId,
            code: 'supplier_switch_message_code_unsupported',
            message: `${process}-intent har message_code=${row.message_code ?? 'null'} och kan inte återupptas automatiskt.`,
          })
          blocked += 1
          continue
        }
        const { prepareAndQueueProdatSwitch } = await import('@/lib/ediel/flows/prodatSwitch')
        const message = await prepareAndQueueProdatSwitch({
          actorUserId: actorUserId ?? 'system',
          switchRequestId,
          messageCode,
          communicationRouteId: row.communication_route_id,
          environment: intentEnvironment(row.environment) ?? undefined,
        })
        await linkResumeResultToIntent({ row, actorUserId, message })
        resumed += 1
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

      if (process === 'meter_values' || process === 'metering_values' || process === 'timeseries_request' || process === 'billing_underlay') {
        const gridOwnerDataRequestId = gridOwnerDataRequestIdFromIntent(row)
        const messageCode = normalizeUtiltsCode(text(row.message_code))
        const payload = asRecord(row.payload)
        if (!gridOwnerDataRequestId) {
          await markUnsupportedOrMalformedIntent({
            row,
            actorUserId,
            code: 'grid_owner_data_request_id_missing',
            message: `${process}-intent saknar grid_owner_data_request_id och kan inte återupptas.`,
          })
          blocked += 1
          continue
        }
        if (!messageCode) {
          await markUnsupportedOrMalformedIntent({
            row,
            actorUserId,
            code: 'utilts_message_code_unsupported',
            message: `${process}-intent har message_code=${row.message_code ?? 'null'} och kan inte återupptas automatiskt.`,
          })
          blocked += 1
          continue
        }
        const { prepareAndQueueUtiltsE73, prepareAndQueueUtiltsE66 } = await import('@/lib/ediel/flows/utiltsDataRequest')
        const message = messageCode === 'E66'
          ? await prepareAndQueueUtiltsE66({
              actorUserId: actorUserId ?? 'system',
              gridOwnerDataRequestId,
              communicationRouteId: row.communication_route_id,
              environment: intentEnvironment(row.environment),
              quantity: numberFromPayload(payload, 'quantity') ?? numberFromPayload(payload, 'valueKwh'),
              periodStart: text(payload.periodStart) ?? text(payload.period_start),
              periodEnd: text(payload.periodEnd) ?? text(payload.period_end),
              registrationTime: text(payload.registrationTime) ?? text(payload.registration_time),
            })
          : await prepareAndQueueUtiltsE73({
              actorUserId: actorUserId ?? 'system',
              gridOwnerDataRequestId,
              communicationRouteId: row.communication_route_id,
              environment: intentEnvironment(row.environment),
            })
        await linkResumeResultToIntent({ row, actorUserId, message })
        resumed += 1
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
