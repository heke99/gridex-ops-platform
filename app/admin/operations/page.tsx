//app/admin/operations/page.tsx
import type { ReactNode } from 'react'
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
  if (
    [
      'completed',
      'accepted',
      'done',
      'acknowledged',
      'ready_to_execute',
      'ready',
    ].includes(status)
  ) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (
    ['failed', 'rejected', 'blocked', 'cancelled', 'unresolved'].includes(status)
  ) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['sent', 'submitted', 'awaiting_response'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
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

function QueueCard({
  title,
  count,
  description,
  href,
  cta,
  tone = 'neutral',
}: {
  title: string
  count: number
  description: string
  href: string
  cta: string
  tone?: 'neutral' | 'danger' | 'success' | 'info' | 'warning'
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/10'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/10'
        : tone === 'info'
          ? 'border-blue-200 bg-blue-50/60 dark:border-blue-900/50 dark:bg-blue-950/10'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/10'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'

  return (
    <Link
      href={href}
      className={`block rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {title}
          </div>
          <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
            {count}
          </div>
        </div>

        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300">
          {cta}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        {description}
      </p>
    </Link>
  )
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
      <div>
        <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {subtitle}
        </p>
      </div>
      {action}
    </div>
  )
}

async function queueReadyBillingExportsFormAction(formData: FormData): Promise<void> {
  'use server'
  await bulkQueueReadyBillingExportsAction(formData)
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
    listRecentSupplierSwitchEvents(supabase, 20),
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
  const blockedTasks = tasks.filter((task) => task.status === 'blocked')
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
  const awaitingDispatchSwitches = switchLifecycle.filter(
    (row) => row.lifecycle.stage === 'awaiting_dispatch'
  )
  const awaitingResponseSwitches = switchLifecycle.filter(
    (row) => row.lifecycle.stage === 'awaiting_response'
  )
  const readyToExecuteSwitches = switchLifecycle.filter(
    (row) => row.lifecycle.stage === 'ready_to_execute'
  )
  const failedSwitches = switchLifecycle.filter(
    (row) => row.request.status === 'failed' || row.request.status === 'rejected'
  )
  const draftSwitches = switchLifecycle.filter(
    (row) => row.request.status === 'draft'
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

  const queuePriority = [
    {
      id: 'blocked-switches',
      title: 'Blockerade switchar',
      count: blockedSwitches.length,
      description:
        'Readiness blockerar nästa steg. Börja här om leverantörsbyten inte rör sig framåt.',
      href: '/admin/operations/switches?stage=blocked',
      cta: 'Öppna blockerade',
      tone: 'danger' as const,
    },
    {
      id: 'unresolved-outbound',
      title: 'Unresolved outbound',
      count: unresolvedOutbound.length,
      description:
        'Requests utan route eller dispatch-kanal. Här fastnar automationen först.',
      href: '/admin/outbound/unresolved',
      cta: 'Öppna unresolved',
      tone: 'danger' as const,
    },
    {
      id: 'missing-outbound',
      title: 'Switchar utan outbound',
      count: missingOutboundSwitches.length,
      description:
        'Ärenden som är redo i kedjan men fortfarande saknar dispatch-post.',
      href: '/admin/operations/switches?stage=queued_for_outbound',
      cta: 'Köa / felsök',
      tone: 'warning' as const,
    },
    {
      id: 'awaiting-dispatch',
      title: 'Väntar på dispatch',
      count: awaitingDispatchSwitches.length,
      description:
        'Outbound finns men ligger fortfarande i queued eller prepared och har inte gått iväg ännu.',
      href: '/admin/operations/switches?stage=awaiting_dispatch',
      cta: 'Öppna dispatch-kö',
      tone: 'warning' as const,
    },
    {
      id: 'waiting-response',
      title: 'Väntar på kvittens',
      count: awaitingResponseSwitches.length,
      description:
        'Skickade ärenden som väntar på svar från extern part eller manuell uppföljning.',
      href: '/admin/operations/switches?stage=awaiting_response',
      cta: 'Följ upp svar',
      tone: 'info' as const,
    },
    {
      id: 'ready-to-execute',
      title: 'Redo att slutföra',
      count: readyToExecuteSwitches.length,
      description:
        'Kvitterade switchar som är klara för intern execution / finalize.',
      href: '/admin/operations/ready-to-execute',
      cta: 'Slutför switchar',
      tone: 'success' as const,
    },
    {
      id: 'failed-switches',
      title: 'Failed / rejected',
      count: failedSwitches.length,
      description:
        'Ärenden som redan brutit flödet och behöver beslut, retry eller manuell korrigering.',
      href: '/admin/operations/switches?stage=failed',
      cta: 'Granska fel',
      tone: 'danger' as const,
    },
  ]

  const recentActionRows = switchLifecycle
    .filter((row) =>
      [
        'blocked',
        'queued_for_outbound',
        'awaiting_dispatch',
        'awaiting_response',
        'ready_to_execute',
      ].includes(row.lifecycle.stage)
    )
    .slice(0, 12)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Operations control tower"
        subtitle="En tydlig startsida för vad som kräver åtgärd nu, vart du ska gå och hur switch-, outbound- och billingkedjan mår."
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
            label="Blockerade tasks"
            value={blockedTasks.length}
            hint="Tasks som inte kan gå vidare utan åtgärd."
          />
          <KpiCard
            label="Blockerade switchar"
            value={blockedSwitches.length}
            hint="Readinessproblem som stoppar byte."
          />
          <KpiCard
            label="Unresolved outbound"
            value={unresolvedOutbound.length}
            hint="Dispatch som saknar route eller kanal."
          />
          <KpiCard
            label="Redo att slutföra"
            value={readyToExecuteSwitches.length}
            hint="Accepted + kvitterad outbound."
          />
          <KpiCard
            label="Redo billing-exporter"
            value={readyBillingExports.length}
            hint="Underlag som kan handoffas till partner nu."
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Vad kräver åtgärd nu?"
              subtitle="Det här är den operativa kön. Börja här i stället för att leta runt i menyn."
              action={
                <div className="flex flex-wrap gap-3">
                  <form action={runOperationsAutomationSweepAction}>
                    <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                      Kör automation sweep
                    </button>
                  </form>

                  <form
                    action={queueReadyBillingExportsFormAction}
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
              }
            />

            <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
              {queuePriority.map((item) => (
                <QueueCard key={item.id} {...item} />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Vart ska jag gå?"
              subtitle="En enkel guide så handläggaren slipper tänka efter."
            />

            <div className="space-y-3 p-6">
              <Link
                href="/admin/customers"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Kundkort
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Börja här när du vill förstå en specifik kunds hela läge, switchhistorik och nästa steg.
                </div>
              </Link>

              <Link
                href="/admin/operations/switches"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Switchar
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Gå hit när du behöver en hel kö av leverantörsbyten, validering, execution och statuskontroll.
                </div>
              </Link>

              <Link
                href="/admin/operations/ready-to-execute"
                className="block rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 transition hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Ready to execute
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Gå hit när outbound redan är kvitterad och du bara vill slutföra switcharna snabbt, enskilt eller i bulk.
                </div>
              </Link>

              <Link
                href="/admin/outbound"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Outbound
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Gå hit när problemet gäller dispatch, route, sent/acknowledged eller retry av extern kommunikation.
                </div>
              </Link>

              <Link
                href="/admin/outbound/unresolved"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Unresolved
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Gå hit först när outbound saknar route eller kanal. Här löser du grundorsaken.
                </div>
              </Link>

              <Link
                href="/admin/operations/tasks"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  Tasks
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Gå hit när du vill jobba systematiskt med blockerare, handläggning och öppna operationspunkter.
                </div>
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Prioriterad triage"
              subtitle="Det här är de viktigaste raderna att öppna just nu."
            />

            <div className="space-y-3 p-6">
              {recentActionRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga kritiska eller väntande switchar just nu.
                </div>
              ) : (
                recentActionRows.map((row) => (
                  <div
                    key={row.request.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                          row.request.status
                        )}`}
                      >
                        {row.request.status}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                          row.lifecycle.stage
                        )}`}
                      >
                        {row.lifecycle.label}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {row.request.request_type}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">
                          Kund {row.request.customer_id}
                        </div>
                        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                          {row.lifecycle.reason}
                        </div>
                        {row.readiness && !row.readiness.isReady ? (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {summarizeReadinessIssues(row.readiness)}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-start justify-end gap-3">
                        <Link
                          href={`/admin/customers/${row.request.customer_id}`}
                          className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Kundkort
                        </Link>
                        <Link
                          href={`/admin/operations/switches/${row.request.id}`}
                          className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Switch detail
                        </Link>

                        {row.lifecycle.stage === 'ready_to_execute' ? (
                          <Link
                            href="/admin/operations/ready-to-execute"
                            className="rounded-2xl border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
                          >
                            Ready queue
                          </Link>
                        ) : row.lifecycle.stage === 'awaiting_response' ? (
                          <Link
                            href="/admin/operations/switches?stage=awaiting_response"
                            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            Väntar svar
                          </Link>
                        ) : row.lifecycle.stage === 'awaiting_dispatch' ? (
                          <Link
                            href="/admin/operations/switches?stage=awaiting_dispatch"
                            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            Dispatch-kö
                          </Link>
                        ) : row.lifecycle.stage === 'queued_for_outbound' ? (
                          <Link
                            href="/admin/operations/switches?stage=queued_for_outbound"
                            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            Saknar outbound
                          </Link>
                        ) : (
                          <Link
                            href="/admin/outbound"
                            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            Outbound
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Toppalerts"
              subtitle="Prioriterad lista över det som borde få uppmärksamhet först."
            />

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
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${alertTone(
                          alert.severity
                        )}`}
                      >
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
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Outbound triage"
              subtitle="När dispatchkedjan är problemet."
            />

            <div className="space-y-3 p-6">
              <Link
                href="/admin/outbound/unresolved"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Unresolved
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'unresolved'
                    )}`}
                  >
                    {unresolvedOutbound.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Requests som saknar route eller kanal och därför inte kan dispatchas.
                </div>
              </Link>

              <Link
                href="/admin/outbound"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Waiting response
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'awaiting_response'
                    )}`}
                  >
                    {waitingResponseOutbound.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Skickade requests som väntar på svar eller kvittens.
                </div>
              </Link>

              <Link
                href="/admin/outbound"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Failed dispatches
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'failed'
                    )}`}
                  >
                    {failedOutbound.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Requests med dispatchfel som sannolikt kräver retry eller route-fix.
                </div>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Switchköer"
              subtitle="Vad leverantörsbyteskedjan väntar på."
            />

            <div className="space-y-3 p-6">
              <Link
                href="/admin/operations/switches?status=draft"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Draft
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'draft'
                    )}`}
                  >
                    {draftSwitches.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Ärenden som ännu inte kommit igenom readiness/validation fullt ut.
                </div>
              </Link>

              <Link
                href="/admin/operations/switches?stage=queued_for_outbound"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Väntar på outbound
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'queued'
                    )}`}
                  >
                    {missingOutboundSwitches.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Ärenden som är på väg framåt men ännu inte fått sin dispatch-post.
                </div>
              </Link>

              <Link
                href="/admin/operations/switches?stage=awaiting_dispatch"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Väntar dispatch
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'submitted'
                    )}`}
                  >
                    {awaitingDispatchSwitches.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Outbound finns men dispatchen är ännu inte iväg eller kvitterad.
                </div>
              </Link>

              <Link
                href="/admin/operations/ready-to-execute"
                className="block rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 transition hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/10 dark:hover:bg-emerald-950/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Redo att slutföra
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'ready_to_execute'
                    )}`}
                  >
                    {readyToExecuteSwitches.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Kvitterade switchar där sista interna execution-steget återstår.
                </div>
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Partner-handoff"
              subtitle="Billing och exportkedjan efter operations."
            />

            <div className="space-y-3 p-6">
              <Link
                href="/admin/partner-exports"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Redo billing-exporter
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                      'ready'
                    )}`}
                  >
                    {readyBillingExports.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Underlag som kan handoffas till partner eller köas i exportflödet.
                </div>
              </Link>

              <Link
                href="/admin/billing"
                className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Billing-underlag
                  </div>
                  <span className="rounded-full px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {underlays.length}
                  </span>
                </div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Gå hit när nästa problem efter switchkedjan ligger i billing-underlaget.
                </div>
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Hårdaste readiness-blockers"
              subtitle="Anläggningar som just nu stoppar switchflödet."
            />

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
                            Kund {row.customerId} · Site {row.siteId}
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
            <SectionHeader
              title="Senaste switch-events"
              subtitle="Tidslinje över de senaste operationerna."
            />

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