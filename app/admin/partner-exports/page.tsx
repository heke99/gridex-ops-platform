// app/admin/partner-exports/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listAllBillingUnderlays, listAllPartnerExports } from '@/lib/cis/db'
import { updatePartnerExportStatusAction } from '@/app/admin/cis/actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{
    status?: string
    exportKind?: string
    q?: string
  }>
}

function tone(status: string): string {
  if (['acknowledged'].includes(status)) return 'bg-emerald-100 text-emerald-700'
  if (['failed', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700'
  }
  if (['sent'].includes(status)) return 'bg-blue-100 text-blue-700'
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

  const [exports, underlays] = await Promise.all([
    listAllPartnerExports({
      status,
      exportKind,
      query,
    }),
    listAllBillingUnderlays({
      status: 'all',
      query: '',
    }),
  ])

  const underlayMap = new Map(underlays.map((row) => [row.id, row]))

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Partner exports"
        subtitle="Queue, statusuppföljning och ack/felhantering mot externa partnerflöden."
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

        <section className="space-y-4">
          {exports.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              Inga partnerexporter matchade filtret.
            </div>
          ) : (
            exports.map((exportRow) => {
              const relatedUnderlay = exportRow.billing_underlay_id
                ? underlayMap.get(exportRow.billing_underlay_id) ?? null
                : null

              return (
              <article
                key={exportRow.id}
                className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(exportRow.status)}`}>
                        {exportRow.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {exportRow.export_kind}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-slate-950">
                        Export {exportRow.id}
                      </h2>

                      <div className="flex flex-wrap gap-2">
                        {relatedUnderlay?.source_request_id ? (
                          <Link
                            href={`/admin/operations/grid-owner-requests/${relatedUnderlay.source_request_id}`}
                            className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Öppna source request
                          </Link>
                        ) : null}

                        <Link
                          href="/admin/billing"
                          className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Öppna billing
                        </Link>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                      <div>Kund: <span className="font-medium">{exportRow.customer_id}</span></div>
                      <div>Target system: <span className="font-medium">{exportRow.target_system}</span></div>
                      <div>Site: <span className="font-medium">{exportRow.site_id ?? '—'}</span></div>
                      <div>Mätpunkt: <span className="font-medium">{exportRow.metering_point_id ?? '—'}</span></div>
                      <div>Billing underlag: <span className="font-medium">{exportRow.billing_underlay_id ?? '—'}</span></div>
                      <div>Source request: <span className="font-medium">{relatedUnderlay?.source_request_id ?? '—'}</span></div>
                      <div>Extern referens: <span className="font-medium">{exportRow.external_reference ?? '—'}</span></div>
                      <div>Köad: <span className="font-medium">{new Date(exportRow.queued_at).toLocaleString('sv-SE')}</span></div>
                      <div>Felorsak: <span className="font-medium">{exportRow.failure_reason ?? '—'}</span></div>
                    </div>
                  </div>

                  <form
                    action={updatePartnerExportStatusAction}
                    className="rounded-3xl border border-slate-200 p-4"
                  >
                    <h3 className="text-sm font-semibold text-slate-900">
                      Uppdatera exportstatus
                    </h3>

                    <input type="hidden" name="export_id" value={exportRow.id} />
                    <input type="hidden" name="customer_id" value={exportRow.customer_id} />

                    <div className="mt-4 grid gap-3">
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

                      <textarea
                        name="failure_reason"
                        defaultValue={exportRow.failure_reason ?? ''}
                        placeholder="Felorsak"
                        rows={4}
                        className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                      />

                      <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
                        Spara exportstatus
                      </button>
                    </div>
                  </form>
                </div>
              </article>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}