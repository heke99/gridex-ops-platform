// app/admin/outbound/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllBillingUnderlays,
  listAllPartnerExports,
  listOutboundDispatchEventsByRequestIds,
  listOutboundRequests,
} from '@/lib/cis/db'
import { updateOutboundRequestStatusAction } from '@/app/admin/cis/actions'
import {
  bulkQueueReadyBillingExportsAction,
  runOperationsAutomationSweepAction,
} from '@/app/admin/operations/control-actions'
import { getBillingExportReadiness } from '@/lib/operations/controlTower'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    requestType?: string
    channelType?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }
  if (['failed', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }
  if (['sent'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function latestEventText(
  requestId: string,
  events: Array<{
    outbound_request_id: string
    message: string | null
    event_type: string
    event_status: string
  }>
): string {
  const latest = events.find((event) => event.outbound_request_id === requestId)
  if (!latest) return 'Inga dispatch-events ännu'
  return latest.message ?? `${latest.event_type} — ${latest.event_status}`
}

function TriageCard({
  title,
  description,
  href,
}: {
  title: string
  description: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-950"
    >
      <div className="font-semibold text-slate-900 dark:text-white">{title}</div>
      <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {description}
      </div>
    </Link>
  )

}

function buildPrimaryDetailLink(request: {
  request_type: string
  source_type: string | null
  source_id: string | null
}): { href: string; label: string } | null {
  if (request.source_type === 'grid_owner_data_request' && request.source_id) {
    return {
      href: `/admin/operations/grid-owner-requests/${request.source_id}`,
      label: 'Öppna request-detail',
    }
  }

  if (request.source_type === 'supplier_switch_request' && request.source_id) {
    return {
      href: `/admin/operations/switches/${request.source_id}`,
      label: 'Öppna switch-detail',
    }
  }

  if (request.request_type === 'billing_underlay') {
    return {
      href: '/admin/billing',
      label: 'Öppna billing',
    }
  }

  if (request.request_type === 'meter_values') {
    return {
      href: '/admin/metering',
      label: 'Öppna metering',
    }
  }

  return null
}

async function runAutomationSweepFormAction(_: FormData): Promise<void> {
  'use server'
  await runOperationsAutomationSweepAction()
}

async function queueReadyBillingExportsFormAction(
  formData: FormData
): Promise<void> {
  'use server'
  await bulkQueueReadyBillingExportsAction(formData)
}

export default async function OutboundPage({ searchParams }: PageProps) {
  await requirePermissionServer('masterdata.read')

  const params = await searchParams
  const status = (params.status ?? 'all').trim()
  const requestType = (params.requestType ?? 'all').trim()
  const channelType = (params.channelType ?? 'all').trim()
  const query = (params.q ?? '').trim()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [requests, underlays, partnerExports, switchRequests] = await Promise.all([
    listOutboundRequests({
      status,
      requestType,
      channelType,
      query,
    }),
    listAllBillingUnderlays({ status: 'all', query: '' }),
    listAllPartnerExports({ status: 'all', exportKind: 'all', query: '' }),
    listAllSupplierSwitchRequests(supabase, {
      status: 'all',
      requestType: 'all',
      query: '',
    }),
  ])

  const events = await listOutboundDispatchEventsByRequestIds(
    requests.map((row) => row.id)
  )

  const unresolvedRequests = requests.filter(
    (request) => request.channel_type === 'unresolved'
  )
  const waitingResponseRequests = requests.filter(
    (request) => request.status === 'sent'
  )
  const failedRequests = requests.filter((request) => request.status === 'failed')
  const queuedRequests = requests.filter((request) =>
    ['queued', 'prepared'].includes(request.status)
  )
  const automationReadyRequests = requests.filter(
    (request) =>
      ['queued', 'prepared', 'failed'].includes(request.status) &&
      request.channel_type !== 'unresolved'
  )
  const autoAckCandidates = requests.filter(
    (request) =>
      request.status === 'sent' &&
      ['email_manual', 'file_export'].includes(request.channel_type)
  )
  const retryableFailedRequests = failedRequests.filter(
    (request) => request.attempts_count < 3
  )
  const switchOutboundRequests = requests.filter(
    (request) => request.request_type === 'supplier_switch'
  )
  const switchRequestsMissingOutbound = switchRequests.filter(
    (switchRequest) =>
      ['queued', 'submitted', 'accepted'].includes(switchRequest.status) &&
      !switchOutboundRequests.some(
        (outbound) =>
          outbound.source_type === 'supplier_switch_request' &&
          outbound.source_id === switchRequest.id &&
          ['queued', 'prepared', 'sent', 'acknowledged'].includes(outbound.status)
      )
  )
  const switchRequestsWaitingAck = switchOutboundRequests.filter(
    (request) => request.status === 'sent'
  )
  const switchRequestsFailed = switchOutboundRequests.filter(
    (request) => request.status === 'failed'
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

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Outbound queue"
        subtitle="Extern orkestrering för switch, mätvärden, billing-underlag och partner-handoff. Automation sweep kan nu lösa route, återköa efter cooldown, auto-förbereda, auto-skicka och auto-kvittera interna kanaler."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Unresolved routes
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {unresolvedRequests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Requests utan fungerande route eller kanalupplösning.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Väntar på svar
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {waitingResponseRequests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Skickade requests som inte kvitterats ännu.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Dispatch-fel
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {failedRequests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Requests som behöver ny åtgärd eller route-fix.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Redo billing-exporter
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {readyBillingExports.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Underlag som kan handoffas till partner nu.
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Automation-klara
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {automationReadyRequests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Köade/förberedda/failade requests som sweepen kan försöka driva vidare.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Auto-ack kandidater
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {autoAckCandidates.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Sent-requests på interna/manuella kanaler som sweepen kan kvittera.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Retrybara dispatch-fel
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {retryableFailedRequests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Failed requests som fortfarande ligger under retry-taket.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Switch utan outbound
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {switchRequestsMissingOutbound.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Supplier-switch requests som borde ha köats men ännu saknar outbound.
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Supplier switch väntar på ack
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {switchRequestsWaitingAck.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Switch-outbounds som är skickade men ännu inte kvitterade.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Supplier switch dispatch-fel
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {switchRequestsFailed.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Switch-outbounds som stoppats och kräver manuell åtgärd.
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex flex-wrap gap-3">
              <Link
                href="/admin/outbound/missing-meter-values"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Bulk: saknade mätvärden
              </Link>
              <Link
                href="/admin/outbound/ready-switches"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Bulk: redo för byte
              </Link>
              <Link
                href="/admin/integrations/routes"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Communication routes
              </Link>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <form className="grid gap-4 xl:grid-cols-[1.2fr_220px_220px_220px_auto]">
                <input
                  name="q"
                  defaultValue={query}
                  placeholder="Sök på kund, site, mätpunkt, batch eller referens"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />

                <select
                  name="status"
                  defaultValue={status}
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="all">Alla statusar</option>
                  <option value="queued">Queued</option>
                  <option value="prepared">Prepared</option>
                  <option value="sent">Sent</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </select>

                <select
                  name="requestType"
                  defaultValue={requestType}
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="all">Alla request-typer</option>
                  <option value="supplier_switch">Supplier switch</option>
                  <option value="meter_values">Meter values</option>
                  <option value="billing_underlay">Billing underlay</option>
                </select>

                <select
                  name="channelType"
                  defaultValue={channelType}
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="all">Alla kanaler</option>
                  <option value="partner_api">Partner API</option>
                  <option value="ediel_partner">Ediel partner</option>
                  <option value="file_export">File export</option>
                  <option value="email_manual">Email manual</option>
                  <option value="unresolved">Unresolved</option>
                </select>

                <div className="flex gap-3">
                  <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                    Filtrera
                  </button>
                  <Link
                    href="/admin/outbound"
                    className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                  >
                    Rensa
                  </Link>
                </div>
              </form>

              <div className="flex flex-wrap items-start gap-3 xl:justify-end">
                <form action={runAutomationSweepFormAction}>
                  <button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    Kör automation sweep 7.8
                  </button>
                </form>

                <form action={queueReadyBillingExportsFormAction}>
                  <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                    Köa billing-exporter
                  </button>
                </form>
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <TriageCard
                title="Unresolved outbound"
                description="Requests utan aktiv route eller kanal."
                href="/admin/outbound/unresolved"
              />
              <TriageCard
                title="Saknade mätvärden"
                description="Bulk-köa nätägarförfrågningar för meter values."
                href="/admin/outbound/missing-meter-values"
              />
              <TriageCard
                title="Saknade billing-underlag"
                description="Bulk-köa nätägarförfrågningar för billing underlay."
                href="/admin/outbound/missing-billing-underlays"
              />
            </div>

            <div className="mt-6 space-y-4">
              {requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga outbound requests matchade filtret.
                </div>
              ) : (
                requests.map((request) => {
                  const primaryDetailLink = buildPrimaryDetailLink(request)

                  return (
                  <article
                    key={request.id}
                    className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                  >
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone(
                              request.status
                            )}`}
                          >
                            {request.status}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {request.request_type}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {request.channel_type}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                            Outbound request {request.id}
                          </h3>

                          <div className="flex flex-wrap items-center gap-2">
                            {primaryDetailLink ? (
                              <Link
                                href={primaryDetailLink.href}
                                className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-950"
                              >
                                {primaryDetailLink.label}
                              </Link>
                            ) : null}

                            <Link
                              href={`/admin/customers/${request.customer_id}`}
                              className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-950"
                            >
                              Kundkort
                            </Link>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Kund</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.customer_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Site</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.site_id ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.metering_point_id ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Källa</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.source_type && request.source_id
                                ? `${request.source_type} · ${request.source_id}`
                                : request.source_type ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Grid owner</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.grid_owner_id ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Route</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.communication_route_id ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Period</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.period_start ?? '—'} → {request.period_end ?? '—'}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Extern referens</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.external_reference ?? '—'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                          <div>
                            Batch:{' '}
                            <span className="font-medium">
                              {request.dispatch_batch_key ?? '—'}
                            </span>
                          </div>
                          <div>
                            Senaste dispatch-event:{' '}
                            <span className="font-medium">
                              {latestEventText(request.id, events)}
                            </span>
                          </div>
                          <div>
                            Försök:{' '}
                            <span className="font-medium">
                              {request.attempts_count}
                            </span>
                          </div>
                        </div>

                        {request.channel_type === 'unresolved' ? (
                          <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                            Den här requesten saknar aktiv route. Sweep 7.8 försöker lösa om route finns nu, annars ligger den kvar för manuell route-fix.
                          </div>
                        ) : null}

                        {request.status === 'sent' ? (
                          <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                            {['email_manual', 'file_export'].includes(request.channel_type)
                              ? 'Den här requesten kan auto-kvitteras av sweepen eftersom kanalen är intern/manuell.'
                              : 'Den här requesten väntar på extern återkoppling.'}
                          </div>
                        ) : null}

                        {request.status === 'failed' ? (
                          <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                            {request.failure_reason ?? 'Dispatch misslyckades och kräver ny åtgärd.'}{' '}
                            {request.attempts_count < 3
                              ? 'Sweep 7.8 kan återköa den efter cooldown.'
                              : 'Retry-taket är uppnått och kräver manuell insats.'}
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-4">
                        <div className="grid gap-2 sm:grid-cols-2">
                          {request.status === 'queued' ? (
                            <form action={updateOutboundRequestStatusAction}>
                              <input type="hidden" name="outbound_request_id" value={request.id} />
                              <input type="hidden" name="customer_id" value={request.customer_id} />
                              <input type="hidden" name="status" value="prepared" />
                              <input type="hidden" name="dispatch_step" value="prepare" />
                              <button className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                                Förbered
                              </button>
                            </form>
                          ) : null}

                          {['queued', 'prepared'].includes(request.status) ? (
                            <form action={updateOutboundRequestStatusAction}>
                              <input type="hidden" name="outbound_request_id" value={request.id} />
                              <input type="hidden" name="customer_id" value={request.customer_id} />
                              <input type="hidden" name="status" value="sent" />
                              <input type="hidden" name="dispatch_step" value="send" />
                              <button className="w-full rounded-2xl border border-blue-300 px-4 py-2.5 text-sm font-semibold text-blue-700 dark:border-blue-800 dark:text-blue-300">
                                Markera som skickad
                              </button>
                            </form>
                          ) : null}

                          {request.status === 'sent' ? (
                            <form action={updateOutboundRequestStatusAction}>
                              <input type="hidden" name="outbound_request_id" value={request.id} />
                              <input type="hidden" name="customer_id" value={request.customer_id} />
                              <input type="hidden" name="status" value="acknowledged" />
                              <input type="hidden" name="dispatch_step" value="ack" />
                              <button className="w-full rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                                Markera som kvitterad
                              </button>
                            </form>
                          ) : null}

                          {['queued', 'prepared', 'sent'].includes(request.status) ? (
                            <form action={updateOutboundRequestStatusAction}>
                              <input type="hidden" name="outbound_request_id" value={request.id} />
                              <input type="hidden" name="customer_id" value={request.customer_id} />
                              <input type="hidden" name="status" value="failed" />
                              <input
                                type="hidden"
                                name="failure_reason"
                                value="Dispatch markerad som failed från snabbåtgärd."
                              />
                              <input type="hidden" name="dispatch_step" value="fail" />
                              <button className="w-full rounded-2xl border border-rose-300 px-4 py-2.5 text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300">
                                Markera som failed
                              </button>
                            </form>
                          ) : null}
                        </div>

                        <form
                          action={updateOutboundRequestStatusAction}
                          className="rounded-3xl border border-slate-200 p-4 dark:border-slate-800"
                        >
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                            Uppdatera dispatch-status
                          </h3>

                          <input
                            type="hidden"
                            name="outbound_request_id"
                            value={request.id}
                          />
                          <input
                            type="hidden"
                            name="customer_id"
                            value={request.customer_id}
                          />

                          <div className="mt-4 grid gap-3">
                            <select
                              name="status"
                              defaultValue={request.status}
                              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="queued">Queued</option>
                              <option value="prepared">Prepared</option>
                              <option value="sent">Sent</option>
                              <option value="acknowledged">Acknowledged</option>
                              <option value="failed">Failed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>

                            <input
                              name="external_reference"
                              defaultValue={request.external_reference ?? ''}
                              placeholder="Extern referens"
                              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />

                            <input
                              name="response_payload_note"
                              placeholder="Svar / intern notering"
                              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />

                            <textarea
                              name="failure_reason"
                              defaultValue={request.failure_reason ?? ''}
                              placeholder="Felorsak"
                              rows={4}
                              className="rounded-2xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />

                            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                              Spara status
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  </article>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Ready to export
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Billing-underlag som saknar aktiv partnerexport.
                </p>
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
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          redo
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {underlay.underlay_year ?? '—'}-
                          {String(underlay.underlay_month ?? '').padStart(2, '0')}
                        </span>
                      </div>

                      <div className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                        Kund {underlay.customer_id} · Site {underlay.site_id ?? '—'} ·
                        Mätpunkt {underlay.metering_point_id ?? '—'}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {underlay.source_request_id ? (
                          <Link
                            href={`/admin/operations/grid-owner-requests/${underlay.source_request_id}`}
                            className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-950"
                          >
                            Öppna source request
                          </Link>
                        ) : null}

                        <Link
                          href="/admin/billing"
                          className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-950"
                        >
                          Öppna billing
                        </Link>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Köläge
                </h2>
              </div>

              <div className="space-y-3 p-6">
                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Queued / Prepared
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {queuedRequests.length} requests väntar på att dispatchas eller auto-förberedas.
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Sent
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {waitingResponseRequests.length} requests väntar på extern återkoppling eller auto-ack.
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Failed
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {failedRequests.length} requests kräver ny route, ny dispatch eller manuell åtgärd.
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    Acknowledged
                  </div>
                  <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {requests.filter((request) => request.status === 'acknowledged').length} requests är klara.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}