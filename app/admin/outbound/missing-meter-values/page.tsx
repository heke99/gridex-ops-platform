import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { bulkQueueMissingMeterValuesAction } from '@/app/admin/cis/actions'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'

export const dynamic = 'force-dynamic'

export default async function MissingMeterValuesPage() {
  await requirePermissionServer('metering.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: sites, error: sitesError } = await supabase
    .from('customer_sites')
    .select('*')
    .order('created_at', { ascending: false })

  if (sitesError) throw sitesError

  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    ((sites ?? []) as { id: string }[]).map((site) => site.id)
  )

  const { data: values, error: valuesError } = await supabase
    .from('metering_values')
    .select('metering_point_id')

  if (valuesError) throw valuesError

  const existingPointIds = new Set(
    ((values ?? []) as { metering_point_id: string }[])
      .map((row) => row.metering_point_id)
      .filter(Boolean)
  )

  const missingPoints = meteringPoints.filter(
    (point) => !existingPointIds.has(point.id)
  )

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Bulk: saknade mätvärden"
        subtitle="Identifiera mätpunkter utan importerade mätvärden och köa extern förfrågan i bulk."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <div className="text-sm text-slate-500">Totala mätpunkter</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {meteringPoints.length}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <div className="text-sm text-slate-500">Med mätvärden</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {meteringPoints.length - missingPoints.length}
              </div>
            </div>
            <div className="rounded-2xl bg-amber-50 px-4 py-4">
              <div className="text-sm text-amber-700">Saknar mätvärden</div>
              <div className="mt-2 text-2xl font-semibold text-amber-900">
                {missingPoints.length}
              </div>
            </div>
          </div>

          <form action={bulkQueueMissingMeterValuesAction} className="mt-6">
            <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
              Köa alla saknade mätvärden
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Förhandsvisning</h2>
            <p className="mt-1 text-sm text-slate-500">
              Mätpunkter som just nu saknar importerade mätvärden.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-6 py-4 font-semibold text-slate-600">Mätpunkt</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Site</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Nätägare</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {missingPoints.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-sm text-slate-500">
                      Alla mätpunkter har minst ett mätvärde registrerat.
                    </td>
                  </tr>
                ) : (
                  missingPoints.map((point) => (
                    <tr key={point.id} className="border-b border-slate-100">
                      <td className="px-6 py-4 text-slate-700">{point.meter_point_id}</td>
                      <td className="px-6 py-4 text-slate-700">{point.site_id}</td>
                      <td className="px-6 py-4 text-slate-700">{point.grid_owner_id ?? '—'}</td>
                      <td className="px-6 py-4 text-slate-700">{point.status}</td>
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