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
    activeRoutes,
    configuredProfiles,
    activeTestRuns,
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
    readCount(routes()),
    readCount(profiles()),
    readCount(tests().in('status', ['draft', 'running'])),
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
    activeRoutes,
    configuredProfiles,
    activeTestRuns,
    runningTests: activeTestRuns,
  }
}