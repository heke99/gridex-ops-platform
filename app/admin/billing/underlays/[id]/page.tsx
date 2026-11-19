import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import { billingMeterLabels, fmt, readBillingPage, readBillingRows, statusBadge } from '@/lib/pricing/adminData'
import { formatStatusLabel } from '@/lib/ui/format'

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ runPage?: string }> }
export const dynamic = 'force-dynamic'

export default async function BillingUnderlayDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const requestedRunPage = Number((await searchParams)?.runPage ?? '1')
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const scope = await resolveAdminSelectedCompanyReadScope(admin)
  const companyId = scope.companyId
  const isPlatformAdmin = isPlatformAdminContext(admin)
  let underlay: Record<string, unknown> | null = null
  let items: Record<string, unknown>[] = []
  let pricingRuns: Record<string, unknown>[] = []
  let debugRun: Record<string, unknown> | null = null
  let debugLines: Record<string, unknown>[] = []
  let labels = new Map<string, string>()
  let historyTotal = 0
  let historyPage = 1
  let readFailed = false
  try {
    const result = await readBillingPage('billing_underlays', companyId, { equals: { id }, pageSize: 1, order: [{ column: 'id' }] })
    underlay = result.rows[0] ?? null
    if (underlay) {
      const history = await readBillingPage('pricing_runs', companyId, { equals: { billing_underlay_id: id }, pageSize: 20, page: requestedRunPage, order: [{ column: 'created_at', ascending: false }, { column: 'id' }] })
      pricingRuns = history.rows
      historyTotal = history.total
      historyPage = history.page
      // Apply the existing locked > success > latest preference in the query, before limiting.
      for (const status of ['locked', 'success', null]) {
        const preferred = await readBillingPage('pricing_runs', companyId, { equals: { billing_underlay_id: id, ...(status ? { status } : {}) }, pageSize: 1, order: [{ column: 'created_at', ascending: false }, { column: 'id' }] })
        if (preferred.rows.length) { debugRun = preferred.rows[0]; break }
      }
      ;[items, debugLines] = await Promise.all([
        readBillingRows('billing_underlay_items', companyId, { billing_underlay_id: id }, 'period_start'),
        debugRun ? readBillingRows('pricing_preview_lines', companyId, { billing_underlay_id: id, pricing_run_id: String(debugRun.id) }, 'sort_order') : Promise.resolve([]),
      ])
      if (!isPlatformAdmin) labels = await billingMeterLabels(companyId, items.filter(row => !row.customer_id || row.customer_id === underlay?.customer_id).map(row => ({ ...row, customer_id: underlay?.customer_id })))
    }
  } catch { readFailed = true }

  const lineMetadata = (row: Record<string, unknown>): Record<string, unknown> =>
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {}
  const provenance = (row: Record<string, unknown>): string => {
    const metadata = lineMetadata(row)
    const parts = [
      typeof metadata.source_type === 'string' ? `priskälla: ${metadata.source_type}` : null,
      typeof metadata.source_price_sek_per_kwh === 'number' ? `källpris: ${metadata.source_price_sek_per_kwh} SEK/kWh` : null,
      typeof metadata.weight_percent === 'number' ? `vikt: ${metadata.weight_percent}%` : null,
      typeof metadata.component_type === 'string' ? `komponent: ${metadata.component_type}` : null,
      typeof metadata.calculation_type === 'string' ? `beräkning: ${metadata.calculation_type}` : null,
      metadata.input_amount !== undefined && metadata.input_amount !== null ? `insatsvärde: ${String(metadata.input_amount)} ${typeof metadata.display_pricing_unit === 'string' ? metadata.display_pricing_unit : typeof metadata.input_unit === 'string' ? metadata.input_unit : ''}`.trim() : null,
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : String(row.line_type ?? '–')
  }

  return (
    <div className="min-h-screen min-w-0 bg-slate-50">
      <AdminHeader title="Faktureringsunderlag" subtitle="Detaljvy för mätdata, prisförhandsgranskning och varningar innan export." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="min-w-0 space-y-6 p-4 lg:p-8">
        {readFailed ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">Underlaget kunde inte läsas fullständigt. Försök igen. Inga delvis inlästa prisrader visas.</p> : !underlay ? <div className="rounded-3xl border bg-white p-8 text-slate-700">Underlaget hittades inte inom valt bolag.</div> : (
          <>
            <section className="grid gap-4 lg:grid-cols-4">
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Status</div><span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge(underlay.status)}`}>{formatStatusLabel(typeof underlay.status === 'string' ? underlay.status : null, '—', 'Behöver granskning')}</span></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Förbrukning</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.total_kwh)} kWh</div></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Elområde</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.price_area)}</div></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Total inkl. moms</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.calculated_total_sek_inc_vat)} kr</div></div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Underlagsrader</h2>
              <div role="region" tabIndex={0} aria-label="Underlagsrader" className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
                <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Period</th><th>Mätpunkt</th><th>kWh</th><th>Status</th></tr></thead><tbody className="divide-y">
                  {items.map((row) => <tr key={String(row.id)}><td className="py-3">{fmt(row.period_start)} → {fmt(row.period_end)}</td><td className="font-mono text-xs">{isPlatformAdmin ? fmt(row.metering_point_id) : labels.get(String(row.id)) ?? 'Mätpunktsuppgifter saknas'}</td><td>{fmt(row.quantity_kwh)}</td><td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{formatStatusLabel(typeof row.status === 'string' ? row.status : null, '—', 'Behöver granskning')}</span></td></tr>)}
                </tbody></table>
              </div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Senaste prisberäkningar</h2>
              <p className="mt-1 text-sm text-slate-600">Visar {pricingRuns.length} av {historyTotal} beräkningar. Prisraderna nedan gäller den prioriterade låsta eller godkända beräkningen, annars den senaste.</p>
              <div className="mt-4 grid gap-3">
                {pricingRuns.length === 0 ? <p className="text-sm text-slate-600">Ingen prisförhandsgranskning har skapats ännu.</p> : null}
                {pricingRuns.map((row) => <div key={String(row.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{formatStatusLabel(typeof row.status === 'string' ? row.status : null, '—', 'Behöver granskning')}</span><span className="font-semibold">{fmt(row.total_inc_vat)} kr inkl. moms</span></div><div className="mt-2 text-xs text-slate-500">Ex moms {fmt(row.total_ex_vat)} · Moms {fmt(row.vat_amount)}</div></div>)}
              </div>
              {historyTotal > 20 ? <nav aria-label="Sidor med prisberäkningar" className="mt-4 flex flex-wrap gap-4 text-sm">
                <span>Sida {historyPage} av {Math.ceil(historyTotal / 20)}</span>
                {historyPage > 1 ? <Link href={`?runPage=${historyPage - 1}`}>Föregående sida</Link> : null}
                {historyPage * 20 < historyTotal ? <Link href={`?runPage=${historyPage + 1}`}>Nästa sida</Link> : null}
              </nav> : null}
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Så beräknades priset</h2>
              <p className="mt-1 text-sm text-slate-600">
                {debugRun
                  ? <>Prisberäkning {isPlatformAdmin ? <span className="font-mono text-xs">{String(debugRun.id)}</span> : null} ({formatStatusLabel(typeof debugRun.status === 'string' ? debugRun.status : null, '—', 'Behöver granskning')}). Rader, pris och moms visas nedan.</>
                  : 'Ingen prisberäkning att visa härledning för ännu.'}
              </p>
              {debugLines.length > 0 ? (
                <div role="region" tabIndex={0} aria-label="Prisrader" className="mt-4 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2">Rad</th>
                        {isPlatformAdmin ? <th>Härledning</th> : null}
                        <th className="text-right">Antal</th>
                        <th>Enhet</th>
                        <th className="text-right">à-pris ex moms</th>
                        <th className="text-right">Ex moms</th>
                        <th className="text-right">Moms%</th>
                        <th className="text-right">Moms</th>
                        <th className="text-right">Inkl. moms</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {debugLines.map((row) => (
                        <tr key={String(row.id)}>
                          <td className="py-3">
                            <div className="font-medium text-slate-900">{fmt(row.description)}</div>
                            {isPlatformAdmin ? <div className="text-xs text-slate-500">{fmt(row.line_type)}</div> : null}
                          </td>
                          {isPlatformAdmin ? <td className="max-w-md text-xs text-slate-600">{provenance(row)}</td> : null}
                          <td className="text-right">{fmt(row.quantity)}</td>
                          <td>{fmt(row.unit)}</td>
                          <td className="text-right">{fmt(row.unit_price_ex_vat)}</td>
                          <td className="text-right font-medium">{fmt(row.amount_ex_vat)}</td>
                          <td className="text-right">{typeof row.vat_rate === 'number' ? `${Math.round(row.vat_rate * 100)}%` : fmt(row.vat_rate)}</td>
                          <td className="text-right">{fmt(row.vat_amount)}</td>
                          <td className="text-right font-semibold">{fmt(row.amount_inc_vat)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 text-sm font-semibold">
                        <td className="py-3" colSpan={isPlatformAdmin ? 5 : 4}>Summa</td>
                        <td className="text-right">{fmt(debugRun?.total_ex_vat)}</td>
                        <td></td>
                        <td className="text-right">{fmt(debugRun?.vat_amount)}</td>
                        <td className="text-right">{fmt(debugRun?.total_inc_vat)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : debugRun ? (
                <p className="mt-4 text-sm text-slate-500">{isPlatformAdmin ? 'Prisberäkningen har inga sparade rader (pricing_preview_lines saknas för körningen).' : 'Prisberäkningen saknar sparade prisrader. Kontrollera underlaget före fakturering.'}</p>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
