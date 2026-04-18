import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllBillingUnderlays,
  listAllGridOwnerDataRequests,
  listAllPartnerExports,
} from '@/lib/cis/db'
import {
  ingestBillingUnderlayAction,
  updateGridOwnerDataRequestStatusAction,
  updatePartnerExportStatusAction,
} from '@/app/admin/cis/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['validated', 'exported', 'received', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (['failed', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700'
  }
  if (['sent'].includes(status)) {
    return 'bg-blue-100 text-blue-700'
  }
  return 'bg-amber-100 text-amber-700'
}

export default async function AdminBillingPage({ searchParams }: PageProps) {
  await requirePermissionServer('billing_underlay.read')

  const params = await searchParams
  const status = (params.status ?? 'all').trim()
  const query = (params.q ?? '').trim()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [underlays, requests, exports] = await Promise.all([
    listAllBillingUnderlays({
      status,
      query,
    }),
    listAllGridOwnerDataRequests({
      status: 'all',
      scope: 'billing_underlay',
      query,
    }),
    listAllPartnerExports({
      status: 'all',
      exportKind: 'billing_underlay',
      query,
    }),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Billing"
        subtitle="Billing underlag från nätägare, ingest och partnerexportflöde."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på kund, site, mätpunkt, period eller referens"
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
            />
            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla statusar</option>
              <option value="pending">Pending</option>
              <option value="received">Received</option>
              <option value="validated">Validated</option>
              <option value="exported">Exported</option>
              <option value="failed">Failed</option>
            </select>
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              Filtrera
            </button>
          </form>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px]">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">
                  Billing-requests mot nätägare
                </h2>
                <p className="mt-1 text-sm text-slate-500">{requests.length} träffar.</p>
              </div>

              <div className="space-y-4 p-6">
                {requests.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                    Inga billing-requests hittades.
                  </div>
                ) : (
                  requests.slice(0, 12).map((request) => (
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

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">
                  Billing underlag
                </h2>
                <p className="mt-1 text-sm text-slate-500">{underlays.length} träffar.</p>
              </div>

              <div className="space-y-4 p-6">
                {underlays.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                    Inga billing underlag hittades.
                  </div>
                ) : (
                  underlays.slice(0, 20).map((underlay) => (
                    <div key={underlay.id} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(underlay.status)}`}>
                          {underlay.status}
                        </span>
                        <span className="text-xs text-slate-500">
                          {underlay.underlay_year ?? '—'}-{String(underlay.underlay_month ?? '').padStart(2, '0')}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        <div>Kund: <span className="font-medium">{underlay.customer_id}</span></div>
                        <div>Site: <span className="font-medium">{underlay.site_id ?? '—'}</span></div>
                        <div>Mätpunkt: <span className="font-medium">{underlay.metering_point_id ?? '—'}</span></div>
                        <div>Total kWh: <span className="font-medium">{underlay.total_kwh ?? '—'}</span></div>
                        <div>Total ex moms: <span className="font-medium">{underlay.total_sek_ex_vat ?? '—'} {underlay.currency}</span></div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 className="text-lg font-semibold text-slate-950">
                  Billing-exporter till partner
                </h2>
                <p className="mt-1 text-sm text-slate-500">{exports.length} träffar.</p>
              </div>

              <div className="space-y-4 p-6">
                {exports.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                    Inga billing-exporter ännu.
                  </div>
                ) : (
                  exports.slice(0, 12).map((exportRow) => (
                    <div key={exportRow.id} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(exportRow.status)}`}>
                          {exportRow.status}
                        </span>
                        <span className="text-xs text-slate-500">{exportRow.export_kind}</span>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-slate-600">
                        <div>Kund: <span className="font-medium">{exportRow.customer_id}</span></div>
                        <div>Target system: <span className="font-medium">{exportRow.target_system}</span></div>
                        <div>Billing underlag: <span className="font-medium">{exportRow.billing_underlay_id ?? '—'}</span></div>
                        <div>Extern referens: <span className="font-medium">{exportRow.external_reference ?? '—'}</span></div>
                      </div>

                      <form
                        action={updatePartnerExportStatusAction}
                        className="mt-4 grid gap-3 md:grid-cols-2"
                      >
                        <input type="hidden" name="export_id" value={exportRow.id} />
                        <input type="hidden" name="customer_id" value={exportRow.customer_id} />

                        <select
                          name="status"
                          defaultValue={exportRow.status}
                          className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                        >
                          <option value="queued">Queued</option>
                          <option value="sent">Sent</option>
                          <option value="acknowledged">Acknowledged</option>
                          <option value="failed">Failed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>

                        <input
                          name="external_reference"
                          defaultValue={exportRow.external_reference ?? ''}
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
                          defaultValue={exportRow.failure_reason ?? ''}
                          placeholder="Felorsak"
                          className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                        />

                        <div className="md:col-span-2">
                          <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                            Uppdatera exportstatus
                          </button>
                        </div>
                      </form>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <form
            action={ingestBillingUnderlayAction}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-950">
              Registrera inkommet billing underlag
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Första ingest-versionen innan automatisk nätägarintegration finns på plats.
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

              <div className="grid gap-4 sm:grid-cols-2">
                <input
                  name="underlay_year"
                  placeholder="År"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                />
                <input
                  name="underlay_month"
                  placeholder="Månad"
                  className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                />
              </div>

              <select
                name="status"
                defaultValue="received"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="received">Received</option>
                <option value="validated">Validated</option>
                <option value="exported">Exported</option>
                <option value="failed">Failed</option>
              </select>

              <input
                name="total_kwh"
                placeholder="Total kWh"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="total_sek_ex_vat"
                placeholder="Total SEK ex moms"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="currency"
                defaultValue="SEK"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="source_system"
                defaultValue="grid_owner"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="payload_note"
                placeholder="Payload / intern notering"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
              <input
                name="failure_reason"
                placeholder="Felorsak"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />
            </div>

            <div className="mt-6">
              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
                Registrera billing underlag
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}