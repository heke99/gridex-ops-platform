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
}) {
  let query = supabaseService
    .from('ediel_overdue_message_acks_v')
    .select('*')
    .limit(input?.limit ?? 100)

  if (input?.companyId) query = query.eq('company_id', input.companyId)

  const { data, error } = await query
  if (error) {
    if (isSchemaCompatibilityError(error)) return { checked: 0, created: 0 }
    throw error
  }

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

  return { checked: (data ?? []).length, created }
}
