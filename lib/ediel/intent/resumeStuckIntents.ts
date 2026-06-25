// lib/ediel/intent/resumeStuckIntents.ts
//
// Resume engine for stuck outbound intents (PART 4: "can resume stuck
// validated/not_rendered/not_queued intents"). A validated intent that never
// reached the outbox (render crashed, process interrupted, route became ready
// later) must not sit invisible forever. This sweep re-runs the sanctioned render
// gateway idempotently so the intent either reaches the outbox or records a
// controlled blocker.
//
// It is concurrency-safe and idempotent: the underlying dispatcher reuses the
// existing intent (idempotency_key) and existing outbound_requests row, and the
// RenderGateway's duplicate check prevents double messages.

import { supabaseService } from '@/lib/supabase/service'

type StuckIntentRow = {
  id: string
  company_id: string
  business_process: string | null
  grid_owner_information_request_id: string | null
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

export type ResumeStuckIntentsResult = {
  candidates: number
  resumed: number
  blocked: number
  skipped: number
  errors: string[]
}

// Finds validated facility-lookup intents that never reached the outbox and
// re-runs the dispatcher for the linked grid_owner_information_request.
export async function resumeStuckEdielIntents(input: {
  companyId?: string | null
  limit?: number
  actorUserId?: string | null
} = {}): Promise<ResumeStuckIntentsResult> {
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
  let query = supabaseService
    .from('ediel_message_intents')
    .select(
      'id,company_id,business_process,grid_owner_information_request_id,validation_status,render_status,outbox_status,created_by',
    )
    .eq('validation_status', 'validated')
    .eq('business_process', 'facility_lookup')
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

  const rows = ((data ?? []) as StuckIntentRow[]).filter((row) =>
    Boolean(row.grid_owner_information_request_id),
  )

  let resumed = 0
  let blocked = 0
  let skipped = 0
  const errors: string[] = []

  // Lazy import to keep the intent layer free of a static dependency on the
  // customer-operations dispatcher (avoids an import cycle).
  const { dispatchFacilityLookupEdifact } = await import(
    '@/lib/customer-operations/facilityLookupEdifactDispatch'
  )

  // Dedupe by grid_owner_information_request_id so two stuck intents for the same
  // request do not race each other.
  const seen = new Set<string>()
  for (const row of rows) {
    const requestId = row.grid_owner_information_request_id as string
    if (seen.has(requestId)) {
      skipped += 1
      continue
    }
    seen.add(requestId)
    try {
      const result = await dispatchFacilityLookupEdifact({
        companyId: row.company_id,
        requestId,
        actorUserId: input.actorUserId ?? row.created_by ?? null,
      })
      if (result.status === 'queued' || result.status === 'already_waiting') resumed += 1
      else if (result.status === 'blocked' || result.status === 'failed') blocked += 1
      else skipped += 1
    } catch (resumeError) {
      errors.push(`${row.id}: ${resumeError instanceof Error ? resumeError.message : String(resumeError)}`)
      blocked += 1
    }
  }

  return { candidates: rows.length, resumed, blocked, skipped, errors }
}
