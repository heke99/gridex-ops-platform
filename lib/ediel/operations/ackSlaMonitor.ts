import { supabaseService } from '@/lib/supabase/service'

type OverdueAckRow = {
  id?: string | null
  company_id?: string | null
  message_family?: string | null
  message_code?: string | null
  ack_due_at?: string | null
  ack_status?: string | null
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return (
    maybe?.code === '42P01' ||
    maybe?.code === '42703' ||
    maybe?.code === 'PGRST204' ||
    maybe?.code === 'PGRST205' ||
    /does not exist|schema cache|column/i.test(maybe?.message ?? '')
  )
}

export async function runEdielAckSlaMonitor(input?: {
  companyId?: string | null
  actorUserId?: string | null
  limit?: number
  /** Rows of the overdue view read per page. */
  pageSize?: number
  /** Upper bound on overdue rows read in one run. */
  maxScan?: number
}) {
  // FINDINGS I-B7: an unordered first page of the overdue view was the whole run. Messages that already had an open
  // event filled it (each insert a 23505), so a newly overdue message beyond the first page (here a silent Z03) never
  // got its event. Read in a stable order and skip messages whose open event exists until `limit` new ones are made.
  const limit = input?.limit ?? 100
  const pageSize = Math.max(1, input?.pageSize ?? 200)
  const maxScan = Math.max(pageSize, input?.maxScan ?? 5000)
  const pending: OverdueAckRow[] = []
  let checked = 0
  for (let offset = 0; offset < maxScan && pending.length < limit; offset += pageSize) {
    let query = supabaseService
      .from('ediel_overdue_message_acks_v')
      .select('*')
      .order('ack_due_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (input?.companyId) query = query.eq('company_id', input.companyId)
    const { data: page, error } = await query
    if (error) {
      if (isSchemaCompatibilityError(error)) return { checked: 0, created: 0 }
      throw error
    }
    const rows = ((page ?? []) as OverdueAckRow[]).filter(row => row.id && row.ack_due_at)
    checked += (page ?? []).length
    if (rows.length > 0) {
      const { data: open, error: openError } = await supabaseService
        .from('ediel_ack_sla_events')
        .select('ediel_message_id')
        .eq('status', 'open')
        .in('ediel_message_id', rows.map(row => row.id as string))
      if (openError && !isSchemaCompatibilityError(openError)) throw openError
      const escalated = new Set(((open ?? []) as Array<{ ediel_message_id: string | null }>).map(row => row.ediel_message_id))
      for (const row of rows) if (!escalated.has(row.id ?? null) && pending.length < limit) pending.push(row)
    }
    if ((page ?? []).length < pageSize) break
  }
  const data = pending

  let created = 0
  for (const row of (data ?? []) as OverdueAckRow[]) {
    if (!row.id || !row.ack_due_at) continue

    const { error: eventError } = await supabaseService
      .from('ediel_ack_sla_events')
      .insert({
        company_id: row.company_id ?? null,
        ediel_message_id: row.id,
        ack_family: row.ack_status ?? 'ack',
        due_at: row.ack_due_at,
        breached_at: new Date().toISOString(),
        severity: 'warning',
        status: 'open',
        metadata: {
          messageFamily: row.message_family ?? null,
          messageCode: row.message_code ?? null,
        },
        created_by: input?.actorUserId ?? null,
      })

    if (eventError) {
      if (eventError.code === '23505' || isSchemaCompatibilityError(eventError)) continue
      throw eventError
    }

    created += 1

    await supabaseService
      .from('ediel_message_events')
      .insert({
        company_id: row.company_id ?? null,
        ediel_message_id: row.id,
        event_type: 'ack_sla_breached',
        event_status: 'warning',
        message: 'ACK SLA har passerat utan förväntad kvittens.',
        payload: {
          dueAt: row.ack_due_at,
          ackStatus: row.ack_status ?? null,
        },
        created_by: input?.actorUserId ?? null,
      })
      .then(({ error: messageEventError }) => {
        if (messageEventError && !isSchemaCompatibilityError(messageEventError)) throw messageEventError
      })
  }

  return { checked, created }
}
