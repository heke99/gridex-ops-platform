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

  const [requests, underlays, partnerExports] = await Promise.all([
    listOutboundRequests({
      status,
      requestType,
      channelType,
      query,
    }),
    listAllBillingUnderlays({ status: 'all', query: '' }),
    listAllPartnerExports({ status: 'all', exportKind: 'all', query: '' }),
  ])

  const events = await listOutboundDispatchEventsByRequestIds(
    requests.map((row) => row.id)
  )

  const unresolvedCount = requests.filter(
    (request) => request.channel_type === 'unresolved'
  ).length
  const waitingResponseCount = requests.filter(
    (request) => request.status === 'sent'
  ).length

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
        subtitle="Extern orkestrering för switch, mätvärden, billing-underlag och partner-handoff."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Unresolved routes
            </div>
            <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
              {unresolvedCount}
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
              {waitingResponseCount}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Skickade requests som inte kvitterats ännu.
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

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
                <option value="all">Alla requesttyper</option>
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
              <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-slate-950">
                Filtrera
              </button>
            </form>

            <div className="grid gap-3 sm:grid-cols-2">
              <form action={runOperationsAutomationSweepAction}>
                <button className="w-full rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  Kör automation sweep
                </button>
              </form>

              <form
                action={bulkQueueReadyBillingExportsAction}
                className="flex gap-3"
              >
                <input
                  type="month"
                  name="period_month"
                  defaultValue={new Date().toISOString().slice(0, 7)}
                  className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                <button className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  Köa exporter
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          {requests.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Inga outbound requests matchade filtret.
            </div>
          ) : (
            requests.map((request) => (
              <article
                key={request.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(
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

                    <h2 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">
                      Outbound request {request.id}
                    </h2>

                    <div className="mt-4 grid gap-3 text-sm text-slate-600 dark:text-slate-300 md:grid-cols-2">
                      <div>
                        Kund: <span className="font-medium">{request.customer_id}</span>
                      </div>
                      <div>
                        Site: <span className="font-medium">{request.site_id ?? '—'}</span>
                      </div>
                      <div>
                        Mätpunkt:{' '}
                        <span className="font-medium">
                          {request.metering_point_id ?? '—'}
                        </span>
                      </div>
                      <div>
                        Nätägare:{' '}
                        <span className="font-medium">{request.grid_owner_id ?? '—'}</span>
                      </div>
                      <div>
                        Route:{' '}
                        <span className="font-medium">
                          {request.communication_route_id ?? '—'}
                        </span>
                      </div>
                      <div>
                        Batch:{' '}
                        <span className="font-medium">
                          {request.dispatch_batch_key ?? '—'}
                        </span>
                      </div>
                      <div>
                        Extern referens:{' '}
                        <span className="font-medium">
                          {request.external_reference ?? '—'}
                        </span>
                      </div>
                      <div>
                        Senaste event:{' '}
                        <span className="font-medium">
                          {latestEventText(request.id, events)}
                        </span>
                      </div>
                    </div>

                    {request.channel_type === 'unresolved' ? (
                      <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                        Den här requesten saknar aktiv route. Gå till Communication routes eller välj manuell hantering.
                      </div>
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
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  )
}