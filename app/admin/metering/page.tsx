// app/admin/metering/page.tsx
import Link from 'next/link'
//app/admin/metering/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
} from '@/lib/cis/db'
import {
  ingestMeteringValueAction,
  updateGridOwnerDataRequestStatusAction,
} from '@/app/admin/cis/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    scope?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['received'].includes(status)) return 'bg-emerald-100 text-emerald-700'
  if (['failed', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700'
  }
  if (['sent'].includes(status)) return 'bg-blue-100 text-blue-700'
  return 'bg-amber-100 text-amber-700'
}

export default async function AdminMeteringPage({ searchParams }: PageProps) {
  await requirePermissionServer('metering.read')

  const params = await searchParams
  const status = (params.status ?? 'all').trim()
  const scope = (params.scope ?? 'all').trim()
  const query = (params.q ?? '').trim()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [requests, values] = await Promise.all([
    listAllGridOwnerDataRequests({
      status,
      scope,
      query,
    }),
    listAllMeteringValues({
      query,
    }),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Metering"
        subtitle="Requestkö mot nätägare, statusuppföljning och ingest av inkomna mätvärden."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på kund, site, mätpunkt, nätägare eller referens"
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
            />
            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla statusar</option>
              <option value="pending">Pending</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              name="scope"
              defaultValue={scope}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla scopes</option>
              <option value="meter_values">Mätvärden</option>
              <option value="billing_underlay">Billing underlag</option>
              <option value="customer_masterdata">Masterdata</option>
            </select>
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              Filtrera
            </button>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_420px]">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">
                Requestkö mot nätägare
              </h2>
              <p className="mt-1 text-sm text-slate-500">{requests.length} träffar.</p>
            </div>

            <div className="space-y-4 p-6">
              {requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Inga requests hittades.
                </div>
              ) : (
                requests.slice(0, 20).map((request) => (
                  <div key={request.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>
                        {request.status}
                      </span>
                      <span className="text-xs text-slate-500">{request.request_scope}</span>
                      </div>

                      <Link
                        href={`/admin/operations/grid-owner-requests/${request.id}`}
                        className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Öppna detailvy
                      </Link>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <div>Kund: <span className="font-medium">{request.customer_id}</span></div>
                      <div>Site: <span className="font-medium">{request.site_id ?? '—'}</span></div>
                      <div>Mätpunkt: <span className="font-medium">{request.metering_point_id ?? '—'}</span></div>
                      <div>Nätägare: <span className="font-medium">{request.grid_owner_id ?? '—'}</span></div>
                      <div>Period: <span className="font-medium">{request.requested_period_start ?? '—'} → {request.requested_period_end ?? '—'}</span></div>
                      <div>Extern referens: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
                    </div>

                    <form
                      action={updateGridOwnerDataRequestStatusAction}
                      className="mt-4 grid gap-3 md:grid-cols-2"
                    >
                      <input type="hidden" name="request_id" value={request.id} />
                      <input type="hidden" name="customer_id" value={request.customer_id} />

                      <select
                        name="status"
                        defaultValue={request.status}
                        className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                      >
                        <option value="pending">Pending</option>
                        <option value="sent">Sent</option>
                        <option value="received">Received</option>
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

                      <input
                        name="failure_reason"
                        defaultValue={request.failure_reason ?? ''}
                        placeholder="Felorsak"
                        className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                      />

                      <div className="md:col-span-2">
                        <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                          Uppdatera requeststatus
                        </button>
                      </div>
                    </form>
                  </div>
                ))
              )}
            </div>
          </div>

          <form
            action={ingestMeteringValueAction}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-950">
              Registrera inkommet mätvärde
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Första ingest-versionen innan automatisk EDIEL/API-koppling finns på plats.
            </p>

            <div className="mt-5 grid gap-4">
              <input
                name="customer_id"
                placeholder="Customer ID"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                required
              />
              <input
                name="site_id"
                placeholder="Site ID"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="metering_point_id"
                placeholder="Metering point ID"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                required
              />
              <input
                name="source_request_id"
                placeholder="Source request ID"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="grid_owner_id"
                placeholder="Grid owner ID"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />

              <select
                name="reading_type"
                defaultValue="consumption"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              >
                <option value="consumption">Consumption</option>
                <option value="production">Production</option>
                <option value="estimated">Estimated</option>
                <option value="adjustment">Adjustment</option>
              </select>

              <input
                name="value_kwh"
                placeholder="kWh"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                required
              />
              <input
                name="quality_code"
                placeholder="Quality code"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="read_at"
                type="datetime-local"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="period_start"
                type="datetime-local"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="period_end"
                type="datetime-local"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="source_system"
                defaultValue="grid_owner"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="raw_payload_note"
                placeholder="Notering / rådatareferens"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
            </div>

            <div className="mt-6">
              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
                Registrera mätvärde
              </button>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">
              Senaste mätvärden
            </h2>
            <p className="mt-1 text-sm text-slate-500">{values.length} rader.</p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-6 py-4 font-semibold text-slate-600">Tid</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Kund</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Mätpunkt</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Typ</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">kWh</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Kvalitet</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Källa</th>
                </tr>
              </thead>
              <tbody>
                {values.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">
                      Inga mätvärden ännu.
                    </td>
                  </tr>
                ) : (
                  values.slice(0, 50).map((value) => (
                    <tr key={value.id} className="border-b border-slate-100">
                      <td className="px-6 py-4 text-slate-700">
                        {new Date(value.read_at).toLocaleString('sv-SE')}
                      </td>
                      <td className="px-6 py-4 text-slate-700">{value.customer_id}</td>
                      <td className="px-6 py-4 text-slate-700">{value.metering_point_id}</td>
                      <td className="px-6 py-4 text-slate-700">{value.reading_type}</td>
                      <td className="px-6 py-4 font-medium text-slate-900">{value.value_kwh}</td>
                      <td className="px-6 py-4 text-slate-700">{value.quality_code ?? '—'}</td>
                      <td className="px-6 py-4 text-slate-700">
                        {value.source_request_id ? (
                          <Link
                            href={`/admin/operations/grid-owner-requests/${value.source_request_id}`}
                            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
                          >
                            Request {value.source_request_id}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}