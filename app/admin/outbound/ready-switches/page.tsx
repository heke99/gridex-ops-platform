import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { bulkQueueReadySupplierSwitchesAction } from '@/app/admin/cis/actions'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'

export const dynamic = 'force-dynamic'

export default async function ReadySwitchesPage() {
  await requirePermissionServer('switching.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const requests = await listAllSupplierSwitchRequests(supabase, {
    status: 'all',
    requestType: 'all',
    query: '',
  })

  const readyRequests = requests.filter((row) =>
    ['queued', 'submitted', 'accepted'].includes(row.status)
  )

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Bulk: redo för byte"
        subtitle="Köa externa leverantörsbytesrequests i bulk för switchärenden som är klara att skickas vidare."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <div className="text-sm text-slate-500">Aktiva switchärenden</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {readyRequests.length}
              </div>
            </div>

            <div className="rounded-2xl bg-blue-50 px-4 py-4">
              <div className="text-sm text-blue-700">Bulk-körning</div>
              <div className="mt-2 text-2xl font-semibold text-blue-900">
                Supplier switch
              </div>
            </div>
          </div>

          <form action={bulkQueueReadySupplierSwitchesAction} className="mt-6">
            <button className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
              Köa alla redo-för-byte
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Förhandsvisning</h2>
            <p className="mt-1 text-sm text-slate-500">
              Switchärenden som är kandidater för extern dispatch.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-6 py-4 font-semibold text-slate-600">Status</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Kund</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Site</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Mätpunkt</th>
                  <th className="px-6 py-4 font-semibold text-slate-600">Startdatum</th>
                </tr>
              </thead>
              <tbody>
                {readyRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                      Inga redo-för-byte just nu.
                    </td>
                  </tr>
                ) : (
                  readyRequests.map((request) => (
                    <tr key={request.id} className="border-b border-slate-100">
                      <td className="px-6 py-4 text-slate-700">{request.status}</td>
                      <td className="px-6 py-4 text-slate-700">{request.customer_id}</td>
                      <td className="px-6 py-4 text-slate-700">{request.site_id}</td>
                      <td className="px-6 py-4 text-slate-700">{request.metering_point_id}</td>
                      <td className="px-6 py-4 text-slate-700">{request.requested_start_date ?? '—'}</td>
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