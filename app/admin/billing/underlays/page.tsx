import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { billingMeterLabels, fmt, readBillingPage, statusBadge } from '@/lib/pricing/adminData'
import { formatStatusLabel } from '@/lib/ui/format'
import { canPresentOperationalAction } from '@/lib/admin/actionPresentation'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'
import GenerateUnderlayForm from './GenerateUnderlayForm'

export const dynamic = 'force-dynamic'

export default async function BillingUnderlaysPage({ searchParams }: { searchParams?: Promise<{ page?: string; billing_month?: string }> } = {}) {
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin)
  const companyId = scope.companyId
  const isPlatformAdmin = isPlatformAdminContext(admin)
  const mayGenerate = companyId && await canPresentOperationalAction(['billing_underlay.export'], companyId)
  const params = await searchParams
  const pageNumber = Number(params?.page ?? '1')
  let billingMonth = previousStockholmBillingMonth()
  if (typeof params?.billing_month === 'string') {
    try { billingMonth = parseBillingMonth(params.billing_month).value } catch { /* Use the previous month. */ }
  }
  let result = { rows: [] as Record<string, unknown>[], total: 0, page: 1, pageSize: 80 }
  let labels = new Map<string, string>()
  let readFailed = false
  try {
    result = await readBillingPage('billing_underlays', companyId, {
      select: 'id,customer_id,metering_point_id,underlay_year,underlay_month,status,total_kwh,calculated_total_sek_ex_vat,calculated_total_sek_inc_vat,price_area,readiness_status,updated_at',
      page: pageNumber,
      order: [{ column: 'underlay_year', ascending: false }, { column: 'underlay_month', ascending: false }, { column: 'updated_at', ascending: false }, { column: 'id' }],
    })
    if (!isPlatformAdmin) labels = await billingMeterLabels(companyId, result.rows)
  } catch { readFailed = true }
  const underlays = readFailed ? [] : result.rows


  return (
    <div className="min-h-screen min-w-0 bg-slate-50">
      <AdminHeader title="Faktureringsunderlag" subtitle="Kontrollera inkomna mätvärden, underlag, prisstatus och vilka rader som är redo för prisförhandsgranskning." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="min-w-0 space-y-6 p-4 lg:p-8">
        {companyId && mayGenerate ? (
          <GenerateUnderlayForm key={`${companyId}:${admin.userId}`} companyId={companyId} actorUserId={admin.userId}
            initialMonth={billingMonth} />
        ) : null}
        {readFailed ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">Faktureringsunderlagen kunde inte läsas fullständigt. Försök igen.</p> : null}
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Underlag totalt</div><div className="mt-2 text-3xl font-semibold">{readFailed ? '—' : result.total}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Redo för pris på sidan</div><div className="mt-2 text-3xl font-semibold">{readFailed ? '—' : underlays.filter((row) => row.status === 'validated' && row.readiness_status === 'ready').length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Prisberäknade på sidan</div><div className="mt-2 text-3xl font-semibold">{readFailed ? '—' : underlays.filter((row) => row.calculated_total_sek_inc_vat !== null && row.calculated_total_sek_inc_vat !== undefined).length}</div></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-600">Behöver kontroll på sidan</div><div className="mt-2 text-3xl font-semibold">{readFailed ? '—' : underlays.filter((row) => row.readiness_status === 'blocked' || row.status === 'failed').length}</div></div>
        </section>

        <section className="rounded-3xl border bg-white shadow-sm">
          <div className="border-b px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Senaste underlag</h2>
            <p className="mt-1 text-sm text-slate-700">Underlagen visas med senaste faktureringsperiod först. Kontrollera förbrukning och pris före fakturering.</p>
          </div>
          <div role="region" tabIndex={0} aria-label="Faktureringsunderlag" className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-6 py-3">Period</th><th className="px-6 py-3">Mätpunkt</th><th className="px-6 py-3">Elområde</th><th className="px-6 py-3">kWh</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Total inkl. moms</th><th className="px-6 py-3"></th></tr>
              </thead>
              <tbody className="divide-y">
                {underlays.length === 0 ? <tr><td className="px-6 py-8 text-center text-slate-500" colSpan={7}>{readFailed ? 'Underlagen är tillfälligt otillgängliga.' : 'Inga faktureringsunderlag finns ännu.'}</td></tr> : null}
                {underlays.map((row) => (
                  <tr key={String(row.id)}>
                    <td className="px-6 py-4">{String(row.underlay_year ?? '—')}-{String(row.underlay_month ?? '').padStart(2, '0')}</td>
                    <td className="px-6 py-4 font-mono text-xs">{isPlatformAdmin ? fmt(row.metering_point_id) : labels.get(String(row.id)) ?? 'Mätpunktsuppgifter saknas'}</td>
                    <td className="px-6 py-4">{fmt(row.price_area)}</td>
                    <td className="px-6 py-4">{fmt(row.total_kwh)}</td>
                    <td className="px-6 py-4"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{formatStatusLabel(typeof row.status === 'string' ? row.status : null, '—', 'Behöver granskning')} / {formatStatusLabel(typeof row.readiness_status === 'string' ? row.readiness_status : null, '—', 'Behöver granskning')}</span></td>
                    <td className="px-6 py-4">{fmt(row.calculated_total_sek_inc_vat)}</td>
                    <td className="px-6 py-4 text-right"><Link className="font-semibold text-emerald-700" href={`/admin/billing/underlays/${row.id}`}>Öppna</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readFailed && result.total > result.pageSize ? <nav aria-label="Sidor med faktureringsunderlag" className="flex flex-wrap items-center gap-4 border-t p-5 text-sm">
            <span>Sida {result.page} av {Math.ceil(result.total / result.pageSize)} · {result.total} underlag</span>
            {result.page > 1 ? <Link href={`?page=${result.page - 1}`}>Föregående sida</Link> : null}
            {result.page * result.pageSize < result.total ? <Link href={`?page=${result.page + 1}`}>Nästa sida</Link> : null}
          </nav> : null}
        </section>
      </main>
    </div>
  )
}
