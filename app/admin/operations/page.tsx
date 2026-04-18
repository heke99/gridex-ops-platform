// app/admin/operations/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import { getEdielSummary } from '@/lib/ediel/summary'
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
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
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
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'

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

function formatRequestScope(scope: GridOwnerDataRequestRow['request_scope']): string {
  switch (scope) {
    case 'meter_values':
      return 'Mätvärden'
    case 'billing_underlay':
      return 'Billing-underlag'
    case 'customer_masterdata':
      return 'Masterdata'
    default:
      return scope
  }
}

function describeRequestFollowup(params: {
  request: GridOwnerDataRequestRow
  outboundCount: number
  hasReceivedData: boolean
}): string {
  const { request, outboundCount, hasReceivedData } = params

  if (request.status === 'failed') {
    return (
      request.failure_reason?.trim() ||
      'Requesten har felat och behöver manuell uppföljning.'
    )
  }

  if (request.status === 'received') {
    return hasReceivedData
      ? 'Svar inkommet och relaterat underlag finns registrerat.'
      : 'Svar inkommet men underlag behöver verifieras i nästa steg.'
  }

  if (request.status === 'sent') {
    return outboundCount > 0
      ? 'Requesten är skickad och har outbound-koppling. Följ upp kvittens eller svar.'
      : 'Requesten står som skickad men saknar tydlig outbound-kedja att följa upp.'
  }

  return outboundCount > 0
    ? 'Requesten väntar fortfarande på nästa steg i outbound-kedjan.'
    : 'Requesten är skapad men saknar ännu tydlig dispatch-uppföljning.'
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
    dataRequests,
    meteringValues,
    partnerExports,
    meteringPoints,
    edielSummary,
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
    listAllGridOwnerDataRequests({ status: 'all', scope: 'all', query: '' }),
    listAllMeteringValues({ query: '' }),
    listAllPartnerExports({ status: 'all', exportKind: 'all', query: '' }),
    listMeteringPointsBySiteIds(supabase, sites.map((site) => site.id)),
    getEdielSummary(supabase),
  ])

  const readinessResults = await Promise.all(
    sites.map(async (site) => {
      const powersOfAttorney = await listPowersOfAttorneyByCustomerId(
        supabase,
        site.customer_id
      )

      return evaluateSiteSwitchReadiness({
        site,
        meteringPoints: meteringPoints.filter((point) => point.site_id === site.id),
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

  const requestOutboundMap = new Map<string, typeof outboundRequests>()
  for (const request of outboundRequests) {
    if (request.source_type === 'grid_owner_data_request' && request.source_id) {
      const current = requestOutboundMap.get(request.source_id) ?? []
      current.push(request)
      requestOutboundMap.set(request.source_id, current)
    }
  }

  const switchLifecycle = switchRequests.map((request) => {
    const readiness = readinessResults.find((row) => row.siteId === request.site_id)
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

  const openDataRequests = dataRequests.filter((request) =>
    ['pending', 'sent'].includes(request.status)
  )
  const failedDataRequests = dataRequests.filter(
    (request) => request.status === 'failed'
  )

  const priorityDataRequests = dataRequests
    .filter((request) =>
      ['failed', 'pending', 'sent', 'received'].includes(request.status)
    )
    .map((request) => {
      const relatedUnderlay =
        underlays.find((row) => row.source_request_id === request.id) ?? null
      const relatedMeterValueCount = meteringValues.filter(
        (row) => row.source_request_id === request.id
      ).length
      const relatedOutbound = requestOutboundMap.get(request.id) ?? []

      return {
        request,
        relatedUnderlay,
        relatedMeterValueCount,
        relatedOutbound,
        followup: describeRequestFollowup({
          request,
          outboundCount: relatedOutbound.length,
          hasReceivedData: Boolean(relatedUnderlay) || relatedMeterValueCount > 0,
        }),
      }
    })
    .sort((a, b) => {
      const rank = (status: GridOwnerDataRequestRow['status']) => {
        if (status === 'failed') return 0
        if (status === 'pending') return 1
        if (status === 'sent') return 2
        if (status === 'received') return 3
        return 4
      }

      return rank(a.request.status) - rank(b.request.status)
    })
    .slice(0, 8)

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
      id: 'ediel-attention',
      title: 'Ediel kräver uppföljning',
      count:
        edielSummary.queuedMessages +
        edielSummary.failedMessages +
        edielSummary.pendingAckMessages,
      description:
        'Köade, felade eller okvitterade Ediel-meddelanden. Här ser du direkt om Svk-flödena behöver handpåläggning.',
      href: '/admin/ediel',
      cta: 'Öppna Ediel',
      tone: edielSummary.failedMessages > 0 ? ('danger' as const) : ('warning' as const),
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
        subtitle="En tydlig startsida för vad som kräver åtgärd nu, vart du ska gå och hur switch-, outbound-, Ediel- och billingkedjan mår."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-10">
          <KpiCard
            label="Öppna tasks"
            value={openTasks.length}
            hint="Pågående operativa tasks som ännu inte är klara."
          />
          <KpiCard
            label="Blockerade tasks"
            value={blockedTasks.length}
            hint="Tasks som fastnat och kräver beslut eller korrigering."
          />
          <KpiCard
            label="Unresolved outbound"
            value={unresolvedOutbound.length}
            hint="Outbound requests utan fungerande route eller dispatch."
          />
          <KpiCard
            label="Väntar på svar"
            value={waitingResponseOutbound.length}
            hint="Skickade outbound requests utan kvittens eller slutligt svar."
          />
          <KpiCard
            label="Failed outbound"
            value={failedOutbound.length}
            hint="Outbound requests som redan har felat."
          />
          <KpiCard
            label="Öppna nätägarrequests"
            value={openDataRequests.length}
            hint="Pending eller sent requests mot nätägare."
          />
          <KpiCard
            label="Felade nätägarrequests"
            value={failedDataRequests.length}
            hint="Requests mot nätägare som behöver manuell uppföljning."
          />
          <KpiCard
            label="Ready billing exports"
            value={readyBillingExports.length}
            hint="Billing-underlag som är klara att köa för export."
          />
          <KpiCard
            label="Draft switchar"
            value={draftSwitches.length}
            hint="Leverantörsbyten som ännu inte lämnat draft-läget."
          />
          <KpiCard
            label="Ediel attention"
            value={
              edielSummary.queuedMessages +
              edielSummary.failedMessages +
              edielSummary.pendingAckMessages
            }
            hint="Ediel-meddelanden som behöver uppföljning nu."
          />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader
            title="Köer att öppna först"
            subtitle="Det här är snabbaste vägen till de arbetsytor som normalt kräver åtgärd först."
            action={
              <form action={runOperationsAutomationSweepAction}>
                <button
                  type="submit"
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Kör automation sweep
                </button>
              </form>
            }
          />

          <div className="grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-4">
            {queuePriority.map((item) => (
              <QueueCard key={item.id} {...item} />
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader
            title="Alerts"
            subtitle="Sammanfattad prioritering från control tower-logiken."
          />

          <div className="space-y-3 p-6">
            {alerts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga aktiva alerts just nu.
              </div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${alertTone(
                          alert.severity
                        )}`}
                      >
                        {alert.severity}
                      </span>
                      <span className="text-sm font-semibold text-slate-950 dark:text-white">
                        {alert.title}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {alert.description}
                    </p>
                  </div>

                  <Link
                    href={alert.href}
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Öppna
                  </Link>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader
            title="Grid owner requests att öppna nu"
            subtitle="Direktvägar till konkreta request-detaljer i stället för breda billing/metering-ytor."
          />

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-950/40">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                    Request
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                    Scope
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                    Uppföljning
                  </th>
                  <th className="px-6 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                    Öppna
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {priorityDataRequests.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-8 text-sm text-slate-500 dark:text-slate-400"
                    >
                      Inga prioriterade nätägarrequests just nu.
                    </td>
                  </tr>
                ) : (
                  priorityDataRequests.map((row) => (
                    <tr key={row.request.id}>
                      <td className="px-6 py-4 align-top">
                        <div className="font-medium text-slate-950 dark:text-white">
                          {row.request.id.slice(0, 8)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Kund {row.request.customer_id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top text-slate-600 dark:text-slate-300">
                        {formatRequestScope(row.request.request_scope)}
                      </td>
                      <td className="px-6 py-4 align-top">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                            row.request.status
                          )}`}
                        >
                          {row.request.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 align-top text-slate-600 dark:text-slate-300">
                        <div>{row.followup}</div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Outbound: {row.relatedOutbound.length} · Underlag:{' '}
                          {row.relatedUnderlay ? 'ja' : 'nej'} · Mätvärden:{' '}
                          {row.relatedMeterValueCount}
                        </div>
                      </td>
                      <td className="px-6 py-4 align-top text-right">
                        <Link
                          href={`/admin/operations/grid-owner-requests/${row.request.id}`}
                          className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Öppna detail
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Switchar som kräver action"
              subtitle="Fokusera här när du vill jobba igenom leverantörsbyten i rätt ordning."
            />

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-950/40">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Request
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Stage
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Readiness
                    </th>
                    <th className="px-6 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                      Öppna
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {recentActionRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-8 text-sm text-slate-500 dark:text-slate-400"
                      >
                        Inga switchar kräver action just nu.
                      </td>
                    </tr>
                  ) : (
                    recentActionRows.map((row) => (
                      <tr key={row.request.id}>
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-950 dark:text-white">
                            {row.request.id.slice(0, 8)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Site {row.request.site_id?.slice(0, 8) ?? '—'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                              row.lifecycle.stage
                            )}`}
                          >
                            {row.lifecycle.stage}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                          {row.readiness
                            ? summarizeReadinessIssues(row.readiness)
                            : 'Ingen readiness-data'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Link
                            href={`/admin/operations/switches/${row.request.id}`}
                            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Öppna switch
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-8">
            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <SectionHeader
                title="Ready billing exports"
                subtitle="Underlag som kan köas vidare till exportpartnern nu."
                action={
                  <form action={queueReadyBillingExportsFormAction}>
                    <button
                      type="submit"
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Köa redo exports
                    </button>
                  </form>
                }
              />

              <div className="space-y-3 p-6">
                {readyBillingExports.slice(0, 8).map((underlay) => (
                  <div
                    key={underlay.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="font-medium text-slate-950 dark:text-white">
                          {underlay.id.slice(0, 8)}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Underlag {underlay.underlay_year ?? '—'}-
                          {String(underlay.underlay_month ?? '').padStart(2, '0')}
                        </div>
                      </div>

                      <Link
                        href={
                          underlay.source_request_id
                            ? `/admin/operations/grid-owner-requests/${underlay.source_request_id}`
                            : '/admin/billing'
                        }
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {underlay.source_request_id
                          ? 'Öppna source request'
                          : 'Öppna billing'}
                      </Link>
                    </div>
                  </div>
                ))}

                {readyBillingExports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga billing exports är redo just nu.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <SectionHeader
                title="Senaste switch-events"
                subtitle="Snabb överblick över senaste händelserna i switchflödet."
              />

              <div className="space-y-3 p-6">
                {events.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga event hittades.
                  </div>
                ) : (
                  events.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                            event.event_status ?? event.event_type
                          )}`}
                        >
                          {event.event_type}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {event.created_at ?? '—'}
                        </span>
                      </div>

                      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                        {event.message ?? 'Ingen meddelandetext'}
                      </p>

                      {event.switch_request_id ? (
                        <div className="mt-3">
                          <Link
                            href={`/admin/operations/switches/${event.switch_request_id}`}
                            className="text-xs font-semibold text-slate-700 underline underline-offset-4 dark:text-slate-200"
                          >
                            Öppna switch
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}