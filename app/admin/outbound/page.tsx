import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listOutboundDispatchEventsByRequestIds,
  listOutboundRequests,
} from '@/lib/cis/db'
import { updateOutboundRequestStatusAction } from '@/app/admin/cis/actions'

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
  if (['acknowledged'].includes(status)) return 'bg-emerald-100 text-emerald-700'
  if (['failed', 'cancelled'].includes(status)) return 'bg-rose-100 text-rose-700'
  if (['sent'].includes(status)) return 'bg-blue-100 text-blue-700'
  return 'bg-amber-100 text-amber-700'
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

  const requests = await listOutboundRequests({
    status,
    requestType,
    channelType,
    query,
  })

  const events = await listOutboundDispatchEventsByRequestIds(
    requests.map((row) => row.id)
  )

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Outbound queue"
        subtitle="Extern orkestrering för switch, mätvärden och billing-underlag."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-3">
            <Link
              href="/admin/outbound/missing-meter-values"
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Bulk: saknade mätvärden
            </Link>
            <Link
              href="/admin/outbound/ready-switches"
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Bulk: redo för byte
            </Link>
            <Link
              href="/admin/integrations/routes"
              className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Communication routes
            </Link>
          </div>

          <form className="grid gap-4 xl:grid-cols-[1.2fr_220px_220px_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på kund, site, mätpunkt, batch eller referens"
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            />
            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
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
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla requesttyper</option>
              <option value="supplier_switch">Supplier switch</option>
              <option value="meter_values">Meter values</option>
              <option value="billing_underlay">Billing underlay</option>
            </select>
            <select
              name="channelType"
              defaultValue={channelType}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla kanaler</option>
              <option value="partner_api">Partner API</option>
              <option value="ediel_partner">Ediel partner</option>
              <option value="file_export">File export</option>
              <option value="email_manual">Email manual</option>
              <option value="unresolved">Unresolved</option>
            </select>
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              Filtrera
            </button>
          </form>
        </section>

        <section className="space-y-4">
          {requests.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              Inga outbound requests matchade filtret.
            </div>
          ) : (
            requests.map((request) => (
              <article
                key={request.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>
                        {request.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {request.request_type}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {request.channel_type}
                      </span>
                    </div>

                    <h2 className="mt-3 text-base font-semibold text-slate-950">
                      Outbound request {request.id}
                    </h2>

                    <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                      <div>Kund: <span className="font-medium">{request.customer_id}</span></div>
                      <div>Site: <span className="font-medium">{request.site_id ?? '—'}</span></div>
                      <div>Mätpunkt: <span className="font-medium">{request.metering_point_id ?? '—'}</span></div>
                      <div>Nätägare: <span className="font-medium">{request.grid_owner_id ?? '—'}</span></div>
                      <div>Route: <span className="font-medium">{request.communication_route_id ?? '—'}</span></div>
                      <div>Batch: <span className="font-medium">{request.dispatch_batch_key ?? '—'}</span></div>
                      <div>Extern referens: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
                      <div>Senaste event: <span className="font-medium">{latestEventText(request.id, events)}</span></div>
                    </div>
                  </div>

                  <form
                    action={updateOutboundRequestStatusAction}
                    className="rounded-3xl border border-slate-200 p-4"
                  >
                    <h3 className="text-sm font-semibold text-slate-900">
                      Uppdatera dispatch-status
                    </h3>

                    <input type="hidden" name="outbound_request_id" value={request.id} />
                    <input type="hidden" name="customer_id" value={request.customer_id} />

                    <div className="mt-4 grid gap-3">
                      <select
                        name="status"
                        defaultValue={request.status}
                        className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
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
                        className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                      />

                      <input
                        name="response_payload_note"
                        placeholder="Svar / intern notering"
                        className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                      />

                      <textarea
                        name="failure_reason"
                        defaultValue={request.failure_reason ?? ''}
                        placeholder="Felorsak"
                        rows={4}
                        className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                      />

                      <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                        Spara dispatch-status
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