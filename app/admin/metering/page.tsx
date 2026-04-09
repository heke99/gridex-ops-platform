import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllGridOwnerDataRequests,
  listAllMeteringValues,
} from '@/lib/cis/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    scope?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['received'].includes(status)) {
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
        subtitle="Requests mot nätägare och inkomna mätvärden."
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

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">
                Requestkö mot nätägare
              </h2>
              <p className="mt-1 text-sm text-slate-500">{requests.length} träffar.</p>
            </div>

            <div className="space-y-3 p-6">
              {requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Inga requests hittades.
                </div>
              ) : (
                requests.slice(0, 30).map((request) => (
                  <div key={request.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>
                        {request.status}
                      </span>
                      <span className="text-xs text-slate-500">{request.request_scope}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <div>Kund: <span className="font-medium">{request.customer_id}</span></div>
                      <div>Site: <span className="font-medium">{request.site_id ?? '—'}</span></div>
                      <div>Mätpunkt: <span className="font-medium">{request.metering_point_id ?? '—'}</span></div>
                      <div>Period: <span className="font-medium">{request.requested_period_start ?? '—'} → {request.requested_period_end ?? '—'}</span></div>
                      <div>Extern referens: <span className="font-medium">{request.external_reference ?? '—'}</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">
                Senaste mätvärden
              </h2>
              <p className="mt-1 text-sm text-slate-500">{values.length} rader.</p>
            </div>

            <div className="space-y-3 p-6">
              {values.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Inga mätvärden importerade ännu.
                </div>
              ) : (
                values.slice(0, 30).map((value) => (
                  <div key={value.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {value.reading_type}
                      </span>
                      <span className="text-xs text-slate-500">{value.source_system}</span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <div>Kund: <span className="font-medium">{value.customer_id}</span></div>
                      <div>Mätpunkt: <span className="font-medium">{value.metering_point_id}</span></div>
                      <div>Värde: <span className="font-medium">{value.value_kwh} kWh</span></div>
                      <div>Tid: <span className="font-medium">{new Date(value.read_at).toLocaleString('sv-SE')}</span></div>
                      <div>Kvalitet: <span className="font-medium">{value.quality_code ?? '—'}</span></div>
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