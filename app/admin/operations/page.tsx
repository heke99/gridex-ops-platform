import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
  listAllOperationTasks,
  listAllSupplierSwitchRequests,
  listPowersOfAttorneyByCustomerId,
  listRecentSupplierSwitchEvents,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import {
  listOutboundRequests,
  listAllBillingUnderlays,
  listAllPartnerExports,
} from '@/lib/cis/db'
import {
  getBillingExportReadiness,
  getSwitchLifecycle,
  summarizeReadinessIssues,
} from '@/lib/operations/controlTower'
import { buildOperationsAlerts } from '@/lib/operations/controlTowerAlerts'
import {
  bulkQueueReadyBillingExportsAction,
  runOperationsAutomationSweepAction,
} from './control-actions'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

export const dynamic = 'force-dynamic'

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint: string
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        {hint}
      </p>
    </div>
  )
}

function statusStyle(status: string): string {
  if (['completed', 'accepted', 'done', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (
    ['failed', 'rejected', 'blocked', 'cancelled', 'unresolved'].includes(
      status
    )
  ) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function alertTone(severity: 'critical' | 'high' | 'medium' | 'low'): string {
  switch (severity) {
    case 'critical':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
    case 'high':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
    case 'medium':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

export default async function AdminOperationsPage() {
  await requirePermissionServer('masterdata.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const sitesQuery = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesQuery.error) throw sitesQuery.error
  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const [
    tasks,
    switchRequests,
    events,
    outboundRequests,
    underlays,
    partnerExports,
    meteringPoints,
  ] = await Promise.all([
    listAllOperationTasks(supabase),
    listAllSupplierSwitchRequests(supabase),
    listRecentSupplierSwitchEvents(supabase, 12),
    listOutboundRequests({
      status: 'all',
      requestType: 'all',
      channelType: 'all',
      query: '',
    }),
    listAllBillingUnderlays({ status: 'all', query: '' }),
    listAllPartnerExports({ status: 'all', exportKind: 'all', query: '' }),
    listMeteringPointsBySiteIds(supabase, sites.map((site) => site.id)),
  ])

  const readinessResults = await Promise.all(
    sites.map(async (site) => {
      const powersOfAttorney = await listPowersOfAttorneyByCustomerId(
        supabase,
        site.customer_id
      )

      return evaluateSiteSwitchReadiness({
        site,
        meteringPoints: meteringPoints.filter(
          (point) => point.site_id === site.id
        ),
        powersOfAttorney,
      })
    })
  )

  const openTasks = tasks.filter((task) =>
    ['open', 'in_progress', 'blocked'].includes(task.status)
  )
  const unresolvedOutbound = outboundRequests.filter(
    (request) => request.channel_type === 'unresolved'
  )
  const waitingResponseOutbound = outboundRequests.filter(
    (request) => request.status === 'sent'
  )
  const failedOutbound = outboundRequests.filter(
    (request) => request.status === 'failed'
  )

  const switchLifecycle = switchRequests.map((request) => {
    const readiness = readinessResults.find(
      (row) => row.siteId === request.site_id
    )
    const outbound = outboundRequests.find(
      (row) =>
        row.source_type === 'supplier_switch_request' &&
        row.source_id === request.id
    )

    return {
      request,
      lifecycle: getSwitchLifecycle({
        request,
        readiness,
        outboundRequest: outbound,
      }),
      readiness,
      outbound,
    }
  })

  const blockedSwitches = switchLifecycle.filter(
    (row) => row.lifecycle.stage === 'blocked'
  )
  const missingOutboundSwitches = switchLifecycle.filter(
    (row) => row.lifecycle.stage === 'queued_for_outbound'
  )

  const exportMap = new Map(
    partnerExports
      .filter((row) => row.billing_underlay_id)
      .map((row) => [row.billing_underlay_id as string, row])
  )

  const readyBillingExports = underlays.filter((underlay) =>
    getBillingExportReadiness({
      underlay,
      existingExport: exportMap.get(underlay.id) ?? null,
    }).isReady
  )

  const alerts = buildOperationsAlerts({
    tasks,
    switchRequests,
    readinessResults,
    outboundRequests,
    billingUnderlays: underlays,
    partnerExports,
  })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Operations"
        subtitle="Control tower för blockers, outbound, switchlivscykel, alerts och partner-handoff."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-6">
          <KpiCard
            label="Öppna tasks"
            value={openTasks.length}
            hint="Alla tasks som kräver handläggning."
          />
          <KpiCard
            label="Blockerade switchar"
            value={blockedSwitches.length}
            hint="Readinessproblem som stoppar nästa steg."
          />
          <KpiCard
            label="Switchar utan outbound"
            value={missingOutboundSwitches.length}
            hint="Redo ärenden som ännu inte köats ut."
          />
          <KpiCard
            label="Unresolved outbound"
            value={unresolvedOutbound.length}
            hint="Requests utan route eller kanalupplösning."
          />
          <KpiCard
            label="Väntar på svar"
            value={waitingResponseOutbound.length}
            hint="Skickade outbound requests utan kvittens."
          />
          <KpiCard
            label="Redo billing-exporter"
            value={readyBillingExports.length}
            hint="Underlag som kan handoffas till partner nu."
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Automatisering
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Kör readiness-sync, skapa saknade switch-outbound och köa billing-exporter.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <form action={runOperationsAutomationSweepAction}>
                  <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                    Kör automation sweep
                  </button>
                </form>

                <form
                  action={bulkQueueReadyBillingExportsAction}
                  className="flex items-center gap-3"
                >
                  <input
                    type="month"
                    name="period_month"
                    defaultValue={new Date().toISOString().slice(0, 7)}
                    className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                    Köa billing-exporter
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Link
                href="/admin/operations/tasks"
                className="rounded-2xl border border-slate-200 p-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">
                  Tasks
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  Se blockerade och öppna uppgifter i detalj.
                </div>
              </Link>

              <Link
                href="/admin/operations/switches"
                className="rounded-2xl border border-slate-200 p-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">
                  Switchlivscykel
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  Granska blockers, outbound och status per ärende.
                </div>
              </Link>

              <Link
                href="/admin/outbound"
                className="rounded-2xl border border-slate-200 p-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">
                  Outbound queue
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  Hantera dispatch, unresolved routes och kvittenser.
                </div>
              </Link>

              <Link
                href="/admin/outbound/unresolved"
                className="rounded-2xl border border-slate-200 p-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">
                  Unresolved
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  Requests som saknar aktiv route och kräver snabb åtgärd.
                </div>
              </Link>

              <Link
                href="/admin/partner-exports"
                className="rounded-2xl border border-slate-200 p-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">
                  Partner exports
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  Handoff av billing och andra exportflöden.
                </div>
              </Link>

              <Link
                href="/admin/integrations/routes"
                className="rounded-2xl border border-slate-200 p-4 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="font-semibold text-slate-900 dark:text-white">
                  Communication routes
                </div>
                <div className="mt-1 text-slate-500 dark:text-slate-400">
                  Routning per nätägare, scope och kanal.
                </div>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Toppalerts
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Prioriterad triage för det som bör hanteras först.
              </p>
            </div>

            <div className="space-y-3 p-6">
              {alerts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga akuta alerts just nu.
                </div>
              ) : (
                alerts.slice(0, 10).map((alert) => (
                  <Link
                    key={alert.id}
                    href={alert.href}
                    className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${alertTone(alert.severity)}`}>
                        {alert.severity}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {alert.category}
                      </span>
                    </div>

                    <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                      {alert.title}
                    </div>
                    <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {alert.description}
                    </div>

                    <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                      Kund {alert.customerId ?? '—'} · Site {alert.siteId ?? '—'}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Switchar som kräver fokus
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Blockerade, misslyckade eller redo utan outbound.
              </p>
            </div>

            <div className="space-y-3 p-6">
              {switchLifecycle.filter((row) =>
                ['blocked', 'queued_for_outbound', 'failed'].includes(
                  row.lifecycle.stage
                )
              ).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga kritiska switchärenden just nu.
                </div>
              ) : (
                switchLifecycle
                  .filter((row) =>
                    ['blocked', 'queued_for_outbound', 'failed'].includes(
                      row.lifecycle.stage
                    )
                  )
                  .slice(0, 10)
                  .map((row) => (
                    <div
                      key={row.request.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(row.request.status)}`}>
                          {row.request.status}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(row.lifecycle.stage)}`}>
                          {row.lifecycle.label}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {row.request.request_type}
                        </span>
                      </div>

                      <div className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                        {row.request.incoming_supplier_name} · kund {row.request.customer_id}
                      </div>
                      <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {row.lifecycle.reason}
                      </div>

                      {row.readiness && !row.readiness.isReady ? (
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          {summarizeReadinessIssues(row.readiness)}
                        </div>
                      ) : null}

                      <div className="mt-4">
                        <Link
                          href={`/admin/customers/${row.request.customer_id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                        >
                          Öppna kundkort
                        </Link>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Outbound triage
                </h2>
              </div>

              <div className="space-y-3 p-6">
                <Link
                  href="/admin/outbound/unresolved"
                  className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Unresolved
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {unresolvedOutbound.length} requests saknar route eller kanal.
                  </div>
                </Link>

                <Link
                  href="/admin/outbound"
                  className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Waiting response
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {waitingResponseOutbound.length} skickade requests väntar på svar.
                  </div>
                </Link>

                <Link
                  href="/admin/outbound"
                  className="block rounded-2xl border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Failed dispatches
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    {failedOutbound.length} requests har dispatchfel.
                  </div>
                </Link>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Redo för partner-handoff
                </h2>
              </div>

              <div className="space-y-3 p-6">
                {readyBillingExports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga billing-underlag redo för export just nu.
                  </div>
                ) : (
                  readyBillingExports.slice(0, 8).map((underlay) => (
                    <div
                      key={underlay.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(underlay.status)}`}>
                          {underlay.status}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {underlay.underlay_year ?? '—'}-{String(
                            underlay.underlay_month ?? ''
                          ).padStart(2, '0')}
                        </span>
                      </div>

                      <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                        Kund {underlay.customer_id} · Site {underlay.site_id ?? '—'} ·
                        Mätpunkt {underlay.metering_point_id ?? '—'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Hårdaste readiness-blockers
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Anläggningar som stoppar switchflödet just nu.
              </p>
            </div>

            <div className="space-y-3 p-6">
              {readinessResults.filter((row) => !row.isReady).length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga aktiva readiness-blockers just nu.
                </div>
              ) : (
                readinessResults
                  .filter((row) => !row.isReady)
                  .slice(0, 10)
                  .map((row) => (
                    <div
                      key={row.siteId}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {row.siteName}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Site {row.siteId}
                          </div>
                        </div>
                        <Link
                          href={`/admin/customers/${row.customerId}`}
                          className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                        >
                          Kundkort
                        </Link>
                      </div>

                      <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                        {summarizeReadinessIssues(row)}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Senaste switch-events
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Tidslinje över de senaste operationerna.
              </p>
            </div>

            <div className="space-y-3 p-6">
              {events.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga switch-events ännu.
                </div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                          event.event_status
                        )}`}
                      >
                        {event.event_status}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {event.event_type}
                      </span>
                    </div>

                    <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                      {event.message ?? 'Ingen meddelandetext'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(event.created_at).toLocaleString('sv-SE')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}