import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseService } from '@/lib/supabase/service'

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

type RawRow = Record<string, unknown>

export type PlatformDashboardEdielSummary = {
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

export type PlatformDashboardSummary = {
  generatedAt: string | null
  customersTotal: number
  contractsTotal: number
  sitesTotal: number
  meteringPointsTotal: number
  openTasks: number
  openGridOwnerRequests: number
  openSwitches: number
  outboundRequestsTotal: number
  meteringValuesTotal: number
  billingUnderlaysTotal: number
  ongoingSupplierSwitches: number
  waitingForGridOwner: number
  negativeAcknowledgements: number
  missingMeteringValues: number
  customersActionRequired: number
  latestMeteringValues: number
  upcomingTerminations: number
  pendingCustomerApplications: number
  companiesTotal: number
  gridOwnersTotal: number
  electricitySuppliersTotal: number
  ediel: PlatformDashboardEdielSummary
}

function mapEdiel(value: unknown): PlatformDashboardEdielSummary {
  const row = value && typeof value === 'object' ? (value as RawRow) : {}
  const activeTestRuns = toNumber(row.active_test_runs)

  return {
    totalMessages: toNumber(row.total_messages),
    inboundMessages: toNumber(row.inbound_messages),
    outboundMessages: toNumber(row.outbound_messages),
    draftMessages: toNumber(row.draft_messages),
    failedMessages: toNumber(row.failed_messages),
    queuedMessages: toNumber(row.queued_messages),
    preparedMessages: toNumber(row.prepared_messages),
    sentMessages: toNumber(row.sent_messages),
    ackPendingMessages: toNumber(row.ack_pending_messages),
    ackOverdueMessages: toNumber(row.ack_overdue_messages),
    activeRoutes: toNumber(row.active_routes),
    configuredProfiles: toNumber(row.configured_profiles),
    activeTestRuns,
    runningTests: toNumber(row.running_tests) || activeTestRuns,
  }
}

async function loadPlatformDashboardSummary(): Promise<PlatformDashboardSummary | null> {
  const startedAt = performance.now()

  try {
    const { data, error } = await supabaseService.rpc('gridex_platform_dashboard_summary_v1')
    const durationMs = performance.now() - startedAt

    if (error || !data || typeof data !== 'object') {
      console.warn('[admin-dashboard:timing]', {
        stage: 'dashboard-summary',
        mode: 'platform',
        durationMs: Math.round(durationMs * 10) / 10,
        ok: false,
        code: error?.code ?? 'empty_result',
      })
      return null
    }

    const row = data as RawRow
    console.info('[admin-dashboard:timing]', {
      stage: 'dashboard-summary',
      mode: 'platform',
      durationMs: Math.round(durationMs * 10) / 10,
      ok: true,
    })

    return {
      generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
      customersTotal: toNumber(row.customers_total),
      contractsTotal: toNumber(row.contracts_total),
      sitesTotal: toNumber(row.sites_total),
      meteringPointsTotal: toNumber(row.metering_points_total),
      openTasks: toNumber(row.open_tasks),
      openGridOwnerRequests: toNumber(row.open_grid_owner_requests),
      openSwitches: toNumber(row.open_switches),
      outboundRequestsTotal: toNumber(row.outbound_requests_total),
      meteringValuesTotal: toNumber(row.metering_values_total),
      billingUnderlaysTotal: toNumber(row.billing_underlays_total),
      ongoingSupplierSwitches: toNumber(row.ongoing_supplier_switches),
      waitingForGridOwner: toNumber(row.waiting_for_grid_owner),
      negativeAcknowledgements: toNumber(row.negative_acknowledgements),
      missingMeteringValues: toNumber(row.missing_metering_values),
      customersActionRequired: toNumber(row.customers_action_required),
      latestMeteringValues: toNumber(row.latest_metering_values),
      upcomingTerminations: toNumber(row.upcoming_terminations),
      pendingCustomerApplications: toNumber(row.pending_customer_applications),
      companiesTotal: toNumber(row.companies_total),
      gridOwnersTotal: toNumber(row.grid_owners_total),
      electricitySuppliersTotal: toNumber(row.electricity_suppliers_total),
      ediel: mapEdiel(row.ediel),
    }
  } catch (error) {
    console.warn('[admin-dashboard:timing]', {
      stage: 'dashboard-summary',
      mode: 'platform',
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ok: false,
      code: error instanceof Error ? error.name : 'unknown_error',
    })
    return null
  }
}

// React cache deduplicates the service-role aggregate during a server render.
const getPlatformDashboardSummary = cache(loadPlatformDashboardSummary)

const verifiedSummaryByClient = new WeakMap<SupabaseClient, Promise<PlatformDashboardSummary | null>>()

async function verifyAndLoadPlatformSummary(
  supabase: SupabaseClient
): Promise<PlatformDashboardSummary | null> {
  const startedAt = performance.now()

  try {
    const { data, error } = await supabase.rpc('gridex_user_is_platform_admin')
    const durationMs = performance.now() - startedAt
    const allowed = !error && data === true

    console.info('[admin-dashboard:timing]', {
      stage: 'platform-rpc-guard',
      durationMs: Math.round(durationMs * 10) / 10,
      ok: allowed,
      code: error?.code ?? null,
    })

    if (!allowed) return null
    return getPlatformDashboardSummary()
  } catch (error) {
    console.warn('[admin-dashboard:timing]', {
      stage: 'platform-rpc-guard',
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ok: false,
      code: error instanceof Error ? error.name : 'unknown_error',
    })
    return null
  }
}

// A null company scope is not by itself proof that the caller is a platform admin.
// Verify with the caller's authenticated Supabase client before any service-role read.
// WeakMap dedupes the guard + aggregate for the same request-scoped client instance.
export function getVerifiedPlatformDashboardSummary(
  supabase: SupabaseClient
): Promise<PlatformDashboardSummary | null> {
  const existing = verifiedSummaryByClient.get(supabase)
  if (existing) return existing

  const pending = verifyAndLoadPlatformSummary(supabase)
  verifiedSummaryByClient.set(supabase, pending)
  return pending
}
