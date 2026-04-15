// lib/ediel/summary.ts

import type { SupabaseClient } from '@supabase/supabase-js'

export type EdielSummary = {
  totalMessages: number
  inboundMessages: number
  outboundMessages: number
  queuedMessages: number
  failedMessages: number
  draftMessages: number
  activeRoutes: number
  configuredProfiles: number
  activeTestRuns: number
  switchLinkedMessages: number
  dataRequestLinkedMessages: number
  pendingAckMessages: number
}

type CountableResult = {
  count: number | null
  error: unknown
}

async function countHead(query: PromiseLike<CountableResult>): Promise<number> {
  const result = await query

  if (result?.error) {
    throw result.error
  }

  return result.count ?? 0
}

export async function getEdielSummary(
  supabase: SupabaseClient
): Promise<EdielSummary> {
  const [
    totalMessages,
    inboundMessages,
    outboundMessages,
    queuedMessages,
    failedMessages,
    draftMessages,
    activeRoutes,
    configuredProfiles,
    activeTestRuns,
    switchLinkedMessages,
    dataRequestLinkedMessages,
    pendingAperak,
    pendingContrl,
  ] = await Promise.all([
    countHead(
      supabase.from('ediel_messages').select('*', { count: 'exact', head: true })
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('direction', 'inbound')
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('direction', 'outbound')
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('*', { count: 'exact', head: true })
        .in('status', ['queued', 'prepared'])
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'failed')
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'draft')
    ),
    countHead(
      supabase
        .from('ediel_route_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_enabled', true)
    ),
    countHead(
      supabase
        .from('ediel_route_profiles')
        .select('id', { count: 'exact', head: true })
    ),
    countHead(
      supabase
        .from('ediel_test_runs')
        .select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'running'])
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('id', { count: 'exact', head: true })
        .not('switch_request_id', 'is', null)
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('id', { count: 'exact', head: true })
        .not('grid_owner_data_request_id', 'is', null)
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('id', { count: 'exact', head: true })
        .eq('aperak_status', 'pending')
    ),
    countHead(
      supabase
        .from('ediel_messages')
        .select('id', { count: 'exact', head: true })
        .eq('contrl_status', 'pending')
    ),
  ])

  return {
    totalMessages,
    inboundMessages,
    outboundMessages,
    queuedMessages,
    failedMessages,
    draftMessages,
    activeRoutes,
    configuredProfiles,
    activeTestRuns,
    switchLinkedMessages,
    dataRequestLinkedMessages,
    pendingAckMessages: pendingAperak + pendingContrl,
  }
}