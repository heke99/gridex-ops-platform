// lib/ediel/summary.ts

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EdielMessageRow,
  EdielRouteProfileRow,
  EdielTestRunRow,
} from '@/lib/ediel/types'

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

function isAckPending(
  message: Pick<EdielMessageRow, 'contrl_status' | 'aperak_status'>
) {
  return message.contrl_status === 'pending' || message.aperak_status === 'pending'
}

function isAckOverdue(
  message: Pick<
    EdielMessageRow,
    'contrl_status' | 'aperak_status' | 'ack_due_at'
  >
) {
  if (!isAckPending(message)) return false
  if (!message.ack_due_at) return false

  const dueAt = new Date(message.ack_due_at)
  if (Number.isNaN(dueAt.getTime())) return false

  return dueAt.getTime() < Date.now()
}

export async function getEdielSummary(
  supabase: SupabaseClient
): Promise<EdielSummary> {
  const [messagesRes, routesRes, profilesRes, testsRes] = await Promise.all([
    supabase.from('ediel_messages').select('*'),
    supabase
      .from('communication_routes')
      .select('id,is_active,route_type,target_system,target_email'),
    supabase.from('ediel_route_profiles').select('*'),
    supabase.from('ediel_test_runs').select('*'),
  ])

  if (messagesRes.error) throw messagesRes.error
  if (routesRes.error) throw routesRes.error
  if (profilesRes.error) throw profilesRes.error
  if (testsRes.error) throw testsRes.error

  const messages = (messagesRes.data ?? []) as EdielMessageRow[]
  const profiles = (profilesRes.data ?? []) as EdielRouteProfileRow[]
  const tests = (testsRes.data ?? []) as EdielTestRunRow[]

  const routes = (routesRes.data ?? []) as Array<{
    id: string
    is_active: boolean
    route_type: string
    target_system: string | null
    target_email: string | null
  }>

  const activeRoutes = routes.filter((route) => {
    if (!route.is_active) return false
    if (route.route_type === 'ediel_partner') return true
    if (route.target_system?.toLowerCase().includes('ediel')) return true
    if (route.target_email?.toLowerCase().includes('ediel')) return true
    return false
  }).length

  const activeTestRuns = tests.filter(
    (row) => row.status === 'draft' || row.status === 'running'
  ).length

  return {
    totalMessages: messages.length,
    inboundMessages: messages.filter((row) => row.direction === 'inbound').length,
    outboundMessages: messages.filter((row) => row.direction === 'outbound').length,
    draftMessages: messages.filter((row) => row.status === 'draft').length,
    failedMessages: messages.filter((row) => row.status === 'failed').length,
    queuedMessages: messages.filter((row) => row.status === 'queued').length,
    preparedMessages: messages.filter((row) => row.status === 'prepared').length,
    sentMessages: messages.filter((row) => row.status === 'sent').length,
    ackPendingMessages: messages.filter(isAckPending).length,
    ackOverdueMessages: messages.filter(isAckOverdue).length,
    activeRoutes,
    configuredProfiles: profiles.length,
    activeTestRuns,
    runningTests: activeTestRuns,
  }
}