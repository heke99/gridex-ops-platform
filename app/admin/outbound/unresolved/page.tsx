import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listUnresolvedOutboundRequests } from '@/lib/cis/db'

export const dynamic = 'force-dynamic'

export default async function UnresolvedOutboundPage() {
  await requirePermissionServer('masterdata.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const requests = await listUnresolvedOutboundRequests()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Outbound: unresolved"
        subtitle="Requests utan aktiv route. Dessa behöver route-konfiguration eller manuell dispatch-kanal."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl bg-amber-50 px-4 py-4">
              <div className="text-sm text-amber-700">Öppna unresolved</div>
              <div className="mt-2 text-2xl font-semibold text-amber-900">{requests.length}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <div className="text-sm text-slate-500">Switch-relaterade</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {requests.filter((row) => row.request_type === 'supplier_switch').length}
              </div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <div className="text-sm text-slate-500">Meter/Billing</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">
                {requests.filter((row) => row.request_type !== 'supplier_switch').length}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Unresolved requests</h2>
            <p className="mt-1 text-sm text-slate-500">
              Alla outbound requests som saknar route och därför ligger på channel_type = unresolved.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {requests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                Inga unresolved requests just nu.
              </div>
            ) : (
              requests.map((request) => (
                <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                      {request.status}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {request.request_type}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                    <div>Kund: <span className="font-medium">{request.customer_id}</span></div>
                    <div>Site: <span className="font-medium">{request.site_id ?? '—'}</span></div>
                    <div>Mätpunkt: <span className="font-medium">{request.metering_point_id ?? '—'}</span></div>
                    <div>Nätägare: <span className="font-medium">{request.grid_owner_id ?? '—'}</span></div>
                    <div>Period: <span className="font-medium">{request.period_start ?? '—'} → {request.period_end ?? '—'}</span></div>
                    <div>Batch: <span className="font-medium">{request.dispatch_batch_key ?? '—'}</span></div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-4 text-sm">
                    <Link href={`/admin/customers/${request.customer_id}`} className="font-medium text-slate-700 underline-offset-4 hover:underline">
                      Öppna kundkort
                    </Link>
                    <Link href="/admin/integrations/routes" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                      Öppna communication routes
                    </Link>
                    <Link href="/admin/outbound" className="font-medium text-slate-700 underline-offset-4 hover:underline">
                      Öppna outbound queue
                    </Link>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}