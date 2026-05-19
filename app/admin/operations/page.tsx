// app/admin/operations/page.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
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
  listAllBillingUnderlays,
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
  listAllPartnerExports,
  listOutboundRequests,
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
import { archiveSupplierSwitchEventFromAdminAction } from './actions'
import type { GridOwnerDataRequestRow } from '@/lib/cis/types'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchEventRow } from '@/lib/operations/types'

export const dynamic = 'force-dynamic'

function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: number
  hint: string
  tone?: 'neutral' | 'danger' | 'success' | 'info' | 'warning'
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/50 dark:bg-rose-950/10'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/10'
        : tone === 'info'
          ? 'border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/10'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/10'
            : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'

  return (
    <div className={`rounded-3xl border p-6 shadow-sm ${toneClass}`}>
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
      'received',
      'active',
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

function lifecycleLabel(status: string): string {
  switch (status) {
    case 'blocked':
      return 'Blockerad'
    case 'queued_for_outbound':
      return 'Klar för utskick'
    case 'awaiting_dispatch':
      return 'Väntar på utskick'
    case 'awaiting_response':
      return 'Väntar på svar'
    case 'ready_to_execute':
      return 'Redo att slutföra'
    case 'completed':
      return 'Slutförd'
    case 'failed':
    case 'rejected':
      return 'Kräver åtgärd'
    case 'draft':
      return 'Utkast'
    case 'sent':
      return 'Skickad'
    case 'pending':
      return 'Väntar'
    case 'received':
      return 'Mottagen'
    default:
      return status
        .replaceAll('_', ' ')
        .replace(/^./, (char) => char.toUpperCase())
  }
}

function eventTypeLabel(value: string): string {
  switch (value) {
    case 'status_changed':
      return 'Status ändrad'
    case 'validation_updated':
      return 'Validering uppdaterad'
    case 'outbound_queued':
      return 'Utskick köat'
    case 'execution_completed':
      return 'Slutförd'
    default:
      return lifecycleLabel(value)
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatRequestScope(scope: GridOwnerDataRequestRow['request_scope']): string {
  switch (scope) {
    case 'meter_values':
      return 'Mätvärden'
    case 'billing_underlay':
      return 'Faktureringsunderlag'
    case 'customer_masterdata':
      return 'Kund- och anläggningsdata'
    default:
      return lifecycleLabel(scope)
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
      'Begäran har stoppats och behöver manuell uppföljning.'
    )
  }

  if (request.status === 'received') {
    return hasReceivedData
      ? 'Svar är mottaget och relaterat underlag finns registrerat.'
      : 'Svar är mottaget och underlaget behöver verifieras.'
  }

  if (request.status === 'sent') {
    return outboundCount > 0
      ? 'Begäran är skickad. Följ upp kvittens eller inkommande svar.'
      : 'Begäran är markerad som skickad men saknar tydlig utskickskedja.'
  }

  return outboundCount > 0
    ? 'Begäran väntar på nästa steg i utskickskedjan.'
    : 'Begäran är skapad och behöver förberedas för utskick.'
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
      ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900/50 dark:bg-rose-950/10'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/10'
        : tone === 'info'
          ? 'border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/10'
          : tone === 'warning'
            ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/10'
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

        <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-300">
          {cta}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
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
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
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

function SwitchEventItem({ event }: { event: SupplierSwitchEventRow }) {
  return (
    <details className="group rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                event.event_status ?? event.event_type
              )}`}
            >
              {eventTypeLabel(event.event_type)}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {formatDateTime(event.created_at)}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
            {event.message ?? 'Händelsen saknar beskrivning.'}
          </p>
        </div>

        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition group-open:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:group-open:bg-slate-800">
          Visa detaljer
        </span>
      </summary>

      <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Status
            </div>
            <div className="mt-1 font-medium text-slate-900 dark:text-white">
              {lifecycleLabel(event.event_status)}
            </div>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
            <div className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Switchärende
            </div>
            <div className="mt-1 font-mono text-xs text-slate-900 dark:text-white">
              {event.switch_request_id}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/admin/operations/switches/${event.switch_request_id}`}
            className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Öppna switchärende
          </Link>

          <form action={archiveSupplierSwitchEventFromAdminAction}>
            <input type="hidden" name="event_id" value={event.id} />
            <input
              type="hidden"
              name="switch_request_id"
              value={event.switch_request_id}
            />
            <input
              type="hidden"
              name="archive_reason"
              value="Arkiverad från operationsöversikten."
            />
            <button className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              Arkivera händelse
            </button>
          </form>
        </div>
      </div>
    </details>
  )
}

export default async function AdminOperationsPage() {
  await requireAdminPageKeyAccess('operations.control_tower')

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
    listRecentSupplierSwitchEvents(supabase, 30),
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
    listMeteringPointsBySiteIds(
      supabase,
      sites.map((site) => site.id)
    ),
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
      title: 'Blockerade leverantörsbyten',
      count: blockedSwitches.length,
      description:
        'Readiness stoppar nästa steg. Börja här när ett leverantörsbyte inte kan gå vidare.',
      href: '/admin/operations/switches?stage=blocked',
      cta: 'Granska blockerare',
      tone: 'danger' as const,
    },
    {
      id: 'unresolved-outbound',
      title: 'Ej matchade utskick',
      count: unresolvedOutbound.length,
      description:
        'Utskick som saknar tydlig mottagare, kanal eller rutt. Dessa bör hanteras innan automationsflödet fortsätter.',
      href: '/admin/outbound/unresolved',
      cta: 'Lös matchning',
      tone: 'danger' as const,
    },
    {
      id: 'awaiting-dispatch',
      title: 'Väntar på utskick',
      count: awaitingDispatchSwitches.length,
      description:
        'Ärenden som är förberedda internt men ännu inte har fullständig utskickskedja.',
      href: '/admin/operations/switches?stage=awaiting_dispatch',
      cta: 'Öppna kön',
      tone: 'warning' as const,
    },
    {
      id: 'awaiting-response',
      title: 'Väntar på svar',
      count: awaitingResponseSwitches.length,
      description:
        'Skickade ärenden som väntar på kvittens, nätägarsvar eller annan extern återkoppling.',
      href: '/admin/operations/switches?stage=awaiting_response',
      cta: 'Följ upp svar',
      tone: 'info' as const,
    },
    {
      id: 'ready-to-execute',
      title: 'Redo att slutföra',
      count: readyToExecuteSwitches.length,
      description:
        'Kvitterade leverantörsbyten som är klara för intern slutföring.',
      href: '/admin/operations/ready-to-execute',
      cta: 'Slutför ärenden',
      tone: 'success' as const,
    },
    {
      id: 'failed-switches',
      title: 'Kräver manuell åtgärd',
      count: failedSwitches.length,
      description:
        'Ärenden som har stoppats, avvisats eller behöver beslut innan de kan fortsätta.',
      href: '/admin/operations/switches?stage=failed',
      cta: 'Granska ärenden',
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

  const latestEvents = events.slice(0, 5)
  const archivedBehindAccordion = events.slice(5)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Operations"
        subtitle="Daglig kontroll av kundintag, leverantörsbyten, utskick, nätägardata, mätvärden och faktureringsunderlag."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Öppna arbetsuppgifter"
            value={openTasks.length}
            hint="Operativa uppgifter som ännu inte är slutförda."
          />
          <KpiCard
            label="Blockerade uppgifter"
            value={blockedTasks.length}
            hint="Uppgifter som kräver beslut eller komplettering."
            tone={blockedTasks.length > 0 ? 'danger' : 'neutral'}
          />
          <KpiCard
            label="Ej matchade utskick"
            value={unresolvedOutbound.length}
            hint="Utskick som saknar fungerande rutt eller mottagare."
            tone={unresolvedOutbound.length > 0 ? 'danger' : 'neutral'}
          />
          <KpiCard
            label="Väntar på svar"
            value={waitingResponseOutbound.length}
            hint="Skickade ärenden utan slutlig återkoppling."
            tone="info"
          />
          <KpiCard
            label="Klara faktureringsunderlag"
            value={readyBillingExports.length}
            hint="Underlag som kan köas vidare för export."
            tone="success"
          />
          <KpiCard
            label="Felade utskick"
            value={failedOutbound.length}
            hint="Utskick som behöver manuell hantering."
            tone={failedOutbound.length > 0 ? 'danger' : 'neutral'}
          />
          <KpiCard
            label="Öppna nätägarbegäran"
            value={openDataRequests.length}
            hint="Begäran som väntar eller är skickade."
          />
          <KpiCard
            label="Felade nätägarbegäran"
            value={failedDataRequests.length}
            hint="Begäran mot nätägare som kräver uppföljning."
            tone={failedDataRequests.length > 0 ? 'danger' : 'neutral'}
          />
          <KpiCard
            label="Utkast till leverantörsbyte"
            value={draftSwitches.length}
            hint="Ärenden som inte är redo för utskick."
            tone="warning"
          />
          <KpiCard
            label="Ediel-meddelanden"
            value={edielSummary.totalMessages}
            hint="Totalt antal registrerade Ediel-meddelanden."
            tone="info"
          />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <SectionHeader
            title="Prioriterade arbetsköer"
            subtitle="Köerna är sorterade efter vad som normalt blockerar driftflödet först."
            action={
              <form action={runOperationsAutomationSweepAction}>
                <button className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-black dark:bg-white dark:text-slate-950">
                  Kör automatisk genomgång
                </button>
              </form>
            }
          />

          <div className="grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-3">
            {queuePriority.map((item) => (
              <QueueCard key={item.id} {...item} />
            ))}
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Aktiva driftvarningar"
              subtitle="Risker och fel som bör få snabb uppmärksamhet innan de påverkar kundflödet."
            />

            <div className="space-y-4 p-6">
              {alerts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga aktiva driftvarningar hittades just nu.
                </div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${alertTone(
                          alert.severity
                        )}`}
                      >
                        {lifecycleLabel(alert.severity)}
                      </span>
                      <span className="text-sm font-semibold text-slate-950 dark:text-white">
                        {alert.title}
                      </span>
                    </div>

                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {alert.description}
                    </p>

                    <div className="mt-3">
                      <Link
                        href={alert.href}
                        className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                      >
                        Öppna arbetsytan
                      </Link>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Nätägarbegäran att följa upp"
              subtitle="Begäran som är mest angelägna utifrån status, svarsläge och kopplat underlag."
            />

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-950/40">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Underlag
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Uppföljning
                    </th>
                    <th className="px-6 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                      Åtgärd
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {priorityDataRequests.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-8 text-sm text-slate-500 dark:text-slate-400"
                      >
                        Inga nätägarbegäran kräver särskild uppföljning just nu.
                      </td>
                    </tr>
                  ) : (
                    priorityDataRequests.map((row) => (
                      <tr key={row.request.id}>
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-950 dark:text-white">
                            {formatRequestScope(row.request.request_scope)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {row.request.id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                              row.request.status
                            )}`}
                          >
                            {lifecycleLabel(row.request.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                          <div>{row.followup}</div>
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Utskick: {row.relatedOutbound.length} · Underlag:{' '}
                            {row.relatedUnderlay ? 'finns' : 'saknas'} · Mätvärden:{' '}
                            {row.relatedMeterValueCount}
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top text-right">
                          <Link
                            href={`/admin/operations/grid-owner-requests/${row.request.id}`}
                            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Öppna ärende
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid gap-8 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <SectionHeader
              title="Leverantörsbyten som kräver åtgärd"
              subtitle="Fokusera här när du vill arbeta igenom leverantörsbyten i rätt ordning."
            />

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-950/40">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Ärende
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Läge
                    </th>
                    <th className="px-6 py-3 text-left font-medium text-slate-500 dark:text-slate-400">
                      Readiness
                    </th>
                    <th className="px-6 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                      Åtgärd
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
                        Inga leverantörsbyten kräver åtgärd just nu.
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
                            Anläggning {row.request.site_id?.slice(0, 8) ?? '—'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(
                              row.lifecycle.stage
                            )}`}
                          >
                            {lifecycleLabel(row.lifecycle.stage)}
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
                            Öppna ärende
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
                title="Faktureringsunderlag redo för export"
                subtitle="Underlag som kan köas vidare till exportpartnern nu."
                action={
                  <form action={queueReadyBillingExportsFormAction}>
                    <button
                      type="submit"
                      className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Köa redo underlag
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
                          Period {underlay.underlay_year ?? '—'}-
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
                          ? 'Öppna nätägarbegäran'
                          : 'Öppna fakturaunderlag'}
                      </Link>
                    </div>
                  </div>
                ))}

                {readyBillingExports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga faktureringsunderlag är redo för export just nu.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <SectionHeader
                title="Senaste switchhändelser"
                subtitle="De fem senaste händelserna visas direkt. Äldre händelser ligger samlade under en utfällbar historik."
              />

              <div className="space-y-3 p-6">
                {events.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Inga switchhändelser hittades.
                  </div>
                ) : (
                  <>
                    {latestEvents.map((event) => (
                      <SwitchEventItem key={event.id} event={event} />
                    ))}

                    {archivedBehindAccordion.length > 0 ? (
                      <details className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                          Visa äldre switchhändelser ({archivedBehindAccordion.length})
                        </summary>
                        <div className="mt-4 space-y-3">
                          {archivedBehindAccordion.map((event) => (
                            <SwitchEventItem key={event.id} event={event} />
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
