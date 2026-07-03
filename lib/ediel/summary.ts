// lib/ediel/summary.ts

import type { SupabaseClient } from '@supabase/supabase-js'

export type EdielSummary = {
  totalMessages: number
  inboundMessages: number
  outboundMessages: number
  draftMessages: number
  failedMessages: number
  queuedMessages: number
  preparedMessages: number
  sentMessages: number
  ackPendingMessages: number
  ackOverdueMessages: number
  activeRoutes: number
  configuredProfiles: number
  activeTestRuns: number
  runningTests: number
}

type CountQuery = PromiseLike<{
  count: number | null
  error: unknown
}>

async function readCount(query: CountQuery): Promise<number> {
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

type MessageCounts = {
  totalMessages: number
  inboundMessages: number
  outboundMessages: number
  draftMessages: number
  failedMessages: number
  queuedMessages: number
  preparedMessages: number
  sentMessages: number
  ackPendingMessages: number
  ackOverdueMessages: number
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

// Single-pass aggregation over ediel_messages (RPC added in migration
// 20260703100000). Returns null when the function is not deployed yet so the
// caller can fall back to the legacy per-count queries.
async function tryMessageCountsViaRpc(
  supabase: SupabaseClient,
  companyId?: string | null
): Promise<MessageCounts | null> {
  try {
    const { data, error } = await supabase.rpc('gridex_ediel_message_summary', {
      p_company_id: companyId ?? null,
    })
    if (error) return null

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined
    if (!row || typeof row !== 'object') return null

    return {
      totalMessages: toCount(row.total_messages),
      inboundMessages: toCount(row.inbound_messages),
      outboundMessages: toCount(row.outbound_messages),
      draftMessages: toCount(row.draft_messages),
      failedMessages: toCount(row.failed_messages),
      queuedMessages: toCount(row.queued_messages),
      preparedMessages: toCount(row.prepared_messages),
      sentMessages: toCount(row.sent_messages),
      ackPendingMessages: toCount(row.ack_pending_messages),
      ackOverdueMessages: toCount(row.ack_overdue_messages),
    }
  } catch {
    return null
  }
}

export async function getEdielSummary(
  supabase: SupabaseClient,
  companyId?: string | null
): Promise<EdielSummary> {
  const messages = () => {
    let query = supabase.from('ediel_messages').select('id', { count: 'exact', head: true })
    if (companyId) query = query.eq('company_id', companyId)
    return query
  }
  const routes = () => {
    let query = supabase
      .from('communication_routes')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .or('route_type.eq.ediel_partner,target_system.ilike.%ediel%,target_email.ilike.%ediel%')
    if (companyId) query = query.eq('company_id', companyId)
    return query
  }
  const profiles = () => {
    let query = supabase.from('ediel_route_profiles').select('id', { count: 'exact', head: true })
    if (companyId) query = query.eq('company_id', companyId)
    return query
  }
  const tests = () => {
    let query = supabase.from('ediel_test_runs').select('id', { count: 'exact', head: true })
    if (companyId) query = query.eq('company_id', companyId)
    return query
  }

  const [rpcCounts, activeRoutes, configuredProfiles, activeTestRuns] = await Promise.all([
    tryMessageCountsViaRpc(supabase, companyId),
    readCount(routes()),
    readCount(profiles()),
    readCount(tests().in('status', ['draft', 'running'])),
  ])

  const messageCounts: MessageCounts =
    rpcCounts ??
    (await (async () => {
      const [
        totalMessages,
        inboundMessages,
        outboundMessages,
        draftMessages,
        failedMessages,
        queuedMessages,
        preparedMessages,
        sentMessages,
        ackPendingMessages,
        ackOverdueMessages,
      ] = await Promise.all([
        readCount(messages()),
        readCount(messages().eq('direction', 'inbound')),
        readCount(messages().eq('direction', 'outbound')),
        readCount(messages().eq('status', 'draft')),
        readCount(messages().eq('status', 'failed')),
        readCount(messages().eq('status', 'queued')),
        readCount(messages().eq('status', 'prepared')),
        readCount(messages().eq('status', 'sent')),
        readCount(messages().or('contrl_status.eq.pending,aperak_status.eq.pending')),
        readCount(
          messages()
            .or('contrl_status.eq.pending,aperak_status.eq.pending')
            .lt('ack_due_at', new Date().toISOString())
        ),
      ])
      return {
        totalMessages,
        inboundMessages,
        outboundMessages,
        draftMessages,
        failedMessages,
        queuedMessages,
        preparedMessages,
        sentMessages,
        ackPendingMessages,
        ackOverdueMessages,
      }
    })())

  return {
    ...messageCounts,
    activeRoutes,
    configuredProfiles,
    activeTestRuns,
    runningTests: activeTestRuns,
  }
}