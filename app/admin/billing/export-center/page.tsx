import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { buildBillingReadinessMap } from '@/lib/cis/billingReadiness'
import { getBillingExportCenterData } from '@/lib/billing/exportCenter'
import { createBillingExportRunAction, queueReadyBillingExportRunItemsAction, sendBillingExportRunToPartnerApiAction } from './actions'

export const dynamic = 'force-dynamic'

function tone(status: string) {
  if (['ready', 'ready_with_flags', 'sent', 'exported', 'acknowledged'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['blocked', 'failed', 'requires_correction'].includes(status)) return 'border-red-200 bg-red-50 text-red-800'
  if (['warning'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default async function BillingExportCenterPage() {
  const admin = await requireAdminPageKeyAccess('billing.export_center')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  const data = companyId ? await getBillingExportCenterData(companyId) : { underlays: [], meterValues: [], partnerExports: [], exportRuns: [] }
  const readiness = buildBillingReadinessMap({ underlays: data.underlays, meterValues: data.meterValues, partnerExports: data.partnerExports })
  const readinessRows = data.underlays.map((underlay) => ({ underlay, readiness: readiness.get(underlay.id) ?? null }))
  const ready = readinessRows.filter((row) => row.readiness?.isExportable)
  const blocked = readinessRows.filter((row) => !row.readiness?.isExportable)
  const currentMonth = new Date().toISOString().slice(0, 7)

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Exportcenter"
        subtitle="Skapa fakturerings- och partnerexporter där korrekta rader går vidare och felaktiga rader flaggas utan att stoppa hela perioden."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-700">Underlag</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{data.underlays.length}</div>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-emerald-800">Redo att exportera</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{ready.length}</div>
          </div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="text-sm font-medium text-red-800">Blockerade rader</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{blocked.length}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-medium text-slate-700">Exportkörningar</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950">{data.exportRuns.length}</div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form action={createBillingExportRunAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Ny exportkörning</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Validera och skapa körning</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Körningen sparar både redo rader och blockerade rader med orsak. Den skapar inte dubletter för andra tenants.</p>
            <div className="mt-5 grid gap-4">
              <input name="period_month" type="month" defaultValue={currentMonth} className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <select name="export_format" defaultValue="json" className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm">
                <option value="json">JSON</option>
                <option value="csv">CSV</option>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="api">API</option>
              </select>
              <input name="target_system" defaultValue="billing_partner" className="h-11 rounded-2xl border border-slate-300 px-4 text-sm" />
              <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">Skapa exportkörning</button>
            </div>
          </form>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-950">Senaste exportkörningar</h2>
              <p className="mt-1 text-sm text-slate-700">Varje körning sparar antal redo, blockerade och exporterade rader.</p>
            </div>
            <div className="space-y-3 p-6">
              {data.exportRuns.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-600">Inga exportkörningar skapade ännu.</div> : data.exportRuns.map((run) => (
                <article key={run.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(run.status)}`}>{run.status}</span>
                    <span className="text-xs text-slate-500">{run.period_month} · {run.export_format}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-4">
                    <div>Total: <span className="font-semibold text-slate-950">{run.rows_total}</span></div>
                    <div>Redo: <span className="font-semibold text-emerald-800">{run.rows_ready}</span></div>
                    <div>Blockerade: <span className="font-semibold text-red-800">{run.rows_blocked}</span></div>
                    <div>Köade: <span className="font-semibold text-slate-950">{run.rows_exported}</span></div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a href={`/admin/billing/export-center/${run.id}/download?format=json`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">JSON</a>
                    <a href={`/admin/billing/export-center/${run.id}/download?format=csv`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">CSV</a>
                    <a href={`/admin/billing/export-center/${run.id}/download?format=xlsx`} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Excel (.xlsx)</a>
                    <form action={queueReadyBillingExportRunItemsAction}>
                      <input type="hidden" name="export_run_id" value={run.id} />
                      <button className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={run.rows_ready === 0}>
                        Köa partnerexport
                      </button>
                    </form>
                    <form action={sendBillingExportRunToPartnerApiAction}>
                      <input type="hidden" name="export_run_id" value={run.id} />
                      <button className="rounded-xl border border-emerald-300 bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={run.rows_ready === 0}>
                        Skicka via API
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Radstatus inför export</h2>
                <p className="mt-1 text-sm text-slate-700">Rader med fel blockeras individuellt. Övriga rader kan fortfarande gå vidare.</p>
              </div>
              <Link href="/admin/billing" className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Öppna faktureringsunderlag</Link>
            </div>
          </div>
          <div className="grid gap-4 p-6 xl:grid-cols-2">
            {readinessRows.length === 0 ? <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-slate-600 xl:col-span-2">Inga faktureringsunderlag finns ännu.</div> : readinessRows.slice(0, 40).map(({ underlay, readiness }) => (
              <article key={underlay.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(readiness?.status ?? 'blocked')}`}>{readiness?.label ?? 'Ej redo'}</span>
                  <span className="text-xs text-slate-500">{underlay.underlay_year ?? '—'}-{String(underlay.underlay_month ?? '—').padStart(2, '0')}</span>
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-950">Kund {underlay.customer_id}</div>
                <div className="mt-2 grid gap-1 text-xs text-slate-600">
                  <div>Mätpunkt: <span className="font-medium text-slate-900">{underlay.metering_point_id ?? 'saknas'}</span></div>
                  <div>kWh: <span className="font-medium text-slate-900">{underlay.total_kwh ?? 'saknas'}</span></div>
                  <div>Belopp ex moms: <span className="font-medium text-slate-900">{underlay.total_sek_ex_vat ?? 'saknas'}</span></div>
                </div>
                {readiness?.issues.length ? (
                  <div className="mt-3 space-y-2">
                    {readiness.issues.slice(0, 3).map((issue) => (
                      <div key={issue.code} className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <span className="font-semibold">{issue.title}:</span> {issue.description}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
