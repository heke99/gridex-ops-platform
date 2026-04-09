import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listCommunicationRoutes } from '@/lib/cis/db'
import { listGridOwners } from '@/lib/masterdata/db'
import { saveCommunicationRouteAction } from '@/app/admin/cis/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    scope?: string
    q?: string
  }>
}

export default async function CommunicationRoutesPage({
  searchParams,
}: PageProps) {
  await requirePermissionServer('masterdata.read')

  const params = await searchParams
  const scope = (params.scope ?? 'all').trim()
  const query = (params.q ?? '').trim()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [routes, gridOwners] = await Promise.all([
    listCommunicationRoutes({
      scope,
      query,
    }),
    listGridOwners(supabase),
  ])

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Communication routes"
        subtitle="Styr hur supplier switch, mätvärden och billing-underlag routas ut från CIS."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form
            action={saveCommunicationRouteAction}
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold text-slate-950">
              Ny / uppdatera route
            </h2>

            <div className="mt-5 grid gap-4">
              <input name="id" type="hidden" />

              <input
                name="route_name"
                placeholder="Route name"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                required
              />

              <select
                name="route_scope"
                defaultValue="meter_values"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              >
                <option value="supplier_switch">Supplier switch</option>
                <option value="meter_values">Meter values</option>
                <option value="billing_underlay">Billing underlay</option>
              </select>

              <select
                name="route_type"
                defaultValue="partner_api"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              >
                <option value="partner_api">Partner API</option>
                <option value="ediel_partner">Ediel partner</option>
                <option value="file_export">File export</option>
                <option value="email_manual">Email manual</option>
              </select>

              <select
                name="grid_owner_id"
                defaultValue=""
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              >
                <option value="">Global default route</option>
                {gridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>

              <input
                name="target_system"
                placeholder="Target system"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
                defaultValue="partner_system"
              />

              <input
                name="endpoint"
                placeholder="Endpoint / path"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />

              <input
                name="target_email"
                placeholder="Target email"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />

              <input
                name="supported_payload_version"
                placeholder="Payload version"
                className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
              />

              <textarea
                name="notes"
                rows={4}
                placeholder="Notes"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="is_active"
                  value="true"
                  defaultChecked
                  className="h-4 w-4"
                />
                Aktiv route
              </label>
            </div>

            <div className="mt-6">
              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
                Spara route
              </button>
            </div>
          </form>

          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Routes</h2>
              <p className="mt-1 text-sm text-slate-500">{routes.length} träffar.</p>
            </div>

            <div className="space-y-3 p-6">
              {routes.length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-slate-500">
                  Inga routes ännu.
                </div>
              ) : (
                routes.map((route) => (
                  <div key={route.id} className="rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {route.route_scope}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {route.route_type}
                      </span>
                      <span className="text-xs text-slate-500">
                        {route.is_active ? 'active' : 'inactive'}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-slate-600">
                      <div>Namn: <span className="font-medium">{route.route_name}</span></div>
                      <div>Target system: <span className="font-medium">{route.target_system}</span></div>
                      <div>Nätägare: <span className="font-medium">{route.grid_owner_id ?? 'global default'}</span></div>
                      <div>Endpoint: <span className="font-medium">{route.endpoint ?? '—'}</span></div>
                      <div>Email: <span className="font-medium">{route.target_email ?? '—'}</span></div>
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