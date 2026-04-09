import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllBillingUnderlays,
  listAllGridOwnerDataRequests,
} from '@/lib/cis/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['validated', 'exported', 'received'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700'
  }
  if (['failed'].includes(status)) {
    return 'bg-rose-100 text-rose-700'
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

  const [underlays, requests] = await Promise.all([
    listAllBillingUnderlays({
      status,
      query,
    }),
    listAllGridOwnerDataRequests({
      status: 'all',
      scope: 'billing_underlay',
      query,
    }),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Billing"
        subtitle="Billing underlag från nätägare och underlag inför partnerexport."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på kund, site, mätpunkt, period eller felorsak"
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

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Billing underlag</h2>
              <p className="mt-1 text-sm text-slate-500">{underlays.length} träffar.</p>
            </div>

            <div className="space-y-3 p-6">
              {underlays.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Inga billing underlag hittades.
                </div>
              ) : (
                underlays.slice(0, 30).map((underlay) => (
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
                Billing-requests mot nätägare
              </h2>
              <p className="mt-1 text-sm text-slate-500">{requests.length} träffar.</p>
            </div>

            <div className="space-y-3 p-6">
              {requests.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Inga billing-requests hittades.
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
                      <div>Nätägare: <span className="font-medium">{request.grid_owner_id ?? '—'}</span></div>
                      <div>Period: <span className="font-medium">{request.requested_period_start ?? '—'} → {request.requested_period_end ?? '—'}</span></div>
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