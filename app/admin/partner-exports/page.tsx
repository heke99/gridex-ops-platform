import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listAllPartnerExports } from '@/lib/cis/db'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    exportKind?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['acknowledged'].includes(status)) {
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

export default async function AdminPartnerExportsPage({
  searchParams,
}: PageProps) {
  await requirePermissionServer('partner_exports.read')

  const params = await searchParams
  const status = (params.status ?? 'all').trim()
  const exportKind = (params.exportKind ?? 'all').trim()
  const query = (params.q ?? '').trim()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const exports = await listAllPartnerExports({
    status,
    exportKind,
    query,
  })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Partner exports"
        subtitle="Queue och uppföljning av exporter till externa partnerflöden."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på kund, site, mätpunkt, referens eller target system"
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500"
            />

            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla statusar</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <select
              name="exportKind"
              defaultValue={exportKind}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm"
            >
              <option value="all">Alla exporttyper</option>
              <option value="billing_underlay">Billing underlag</option>
              <option value="meter_values">Mätvärden</option>
              <option value="customer_snapshot">Customer snapshot</option>
            </select>

            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              Filtrera
            </button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Exportkö</h2>
            <p className="mt-1 text-sm text-slate-500">{exports.length} träffar.</p>
          </div>

          <div className="space-y-3 p-6">
            {exports.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-slate-500">
                Inga partnerexporter matchade filtret.
              </div>
            ) : (
              exports.map((exportRow) => (
                <div key={exportRow.id} className="rounded-2xl border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(exportRow.status)}`}>
                      {exportRow.status}
                    </span>
                    <span className="text-xs text-slate-500">{exportRow.export_kind}</span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                    <div>Kund: <span className="font-medium">{exportRow.customer_id}</span></div>
                    <div>Target system: <span className="font-medium">{exportRow.target_system}</span></div>
                    <div>Site: <span className="font-medium">{exportRow.site_id ?? '—'}</span></div>
                    <div>Mätpunkt: <span className="font-medium">{exportRow.metering_point_id ?? '—'}</span></div>
                    <div>Billing underlag: <span className="font-medium">{exportRow.billing_underlay_id ?? '—'}</span></div>
                    <div>Extern referens: <span className="font-medium">{exportRow.external_reference ?? '—'}</span></div>
                    <div>Köad: <span className="font-medium">{new Date(exportRow.queued_at).toLocaleString('sv-SE')}</span></div>
                    <div>Felorsak: <span className="font-medium">{exportRow.failure_reason ?? '—'}</span></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}