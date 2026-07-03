import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

type Props = { params: Promise<{ id: string }> }
export const dynamic = 'force-dynamic'

export default async function BillingUnderlayDetailPage({ params }: Props) {
  const { id } = await params
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null
  const underlays = (await safeListRows('billing_underlays', companyId, '*', 500)).filter((row) => row.id === id)
  const underlay = underlays[0] ?? null
  const [items, pricingRuns, allPreviewLines] = await Promise.all([
    safeListRows('billing_underlay_items', companyId, '*', 200).then((rows) => rows.filter((row) => row.billing_underlay_id === id)),
    safeListRows('pricing_runs', companyId, '*', 50).then((rows) => rows.filter((row) => row.billing_underlay_id === id)),
    safeListRows('pricing_preview_lines', companyId, '*', 1000).then((rows) => rows.filter((row) => row.billing_underlay_id === id)),
  ])

  // Provenance view: show the lines of the newest active run (locked > success > latest).
  const debugRun = [...pricingRuns].sort((a, b) => {
    const rank = (row: Record<string, unknown>) => (row.status === 'locked' ? 2 : row.status === 'success' ? 1 : 0)
    if (rank(b) !== rank(a)) return rank(b) - rank(a)
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
  })[0] ?? null
  const debugLines = debugRun
    ? allPreviewLines
        .filter((row) => row.pricing_run_id === debugRun.id)
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
    : []

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
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Faktureringsunderlag" subtitle="Detaljvy för mätdata, prispreview och varningar innan export." userEmail={admin.email} workspaceName={scope?.companyName} />
      <main className="space-y-6 p-8">
        {!underlay ? <div className="rounded-3xl border bg-white p-8 text-slate-700">Underlaget hittades inte inom valt bolag.</div> : (
          <>
            <section className="grid gap-4 lg:grid-cols-4">
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Status</div><span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${statusBadge(underlay.status)}`}>{fmt(underlay.status)}</span></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Förbrukning</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.total_kwh)} kWh</div></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Elområde</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.price_area)}</div></div>
              <div className="rounded-3xl border bg-white p-5"><div className="text-xs uppercase text-slate-500">Total inkl. moms</div><div className="mt-2 text-2xl font-semibold">{fmt(underlay.calculated_total_sek_inc_vat)} kr</div></div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Underlagsrader</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Period</th><th>Mätpunkt</th><th>kWh</th><th>Status</th></tr></thead><tbody className="divide-y">
                  {items.map((row) => <tr key={String(row.id)}><td className="py-3">{fmt(row.period_start)} → {fmt(row.period_end)}</td><td className="font-mono text-xs">{fmt(row.metering_point_id)}</td><td>{fmt(row.quantity_kwh)}</td><td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></td></tr>)}
                </tbody></table>
              </div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Prisberäkningar</h2>
              <div className="mt-4 grid gap-3">
                {pricingRuns.length === 0 ? <p className="text-sm text-slate-600">Ingen prispreview har skapats ännu.</p> : null}
                {pricingRuns.map((row) => <div key={String(row.id)} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span><span className="font-semibold">{fmt(row.total_inc_vat)} kr inkl. moms</span></div><div className="mt-2 text-xs text-slate-500">Ex moms {fmt(row.total_ex_vat)} · Moms {fmt(row.vat_amount)}</div></div>)}
              </div>
            </section>

            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">Prisdebug – radhärledning</h2>
              <p className="mt-1 text-sm text-slate-600">
                {debugRun
                  ? <>Härledning för prisberäkning <span className="font-mono text-xs">{String(debugRun.id)}</span> ({fmt(debugRun.status)}): mätkälla → priskälla → komponent → ex moms → moms → inkl. moms.</>
                  : 'Ingen prisberäkning att visa härledning för ännu.'}
              </p>
              {debugLines.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2">Rad</th>
                        <th>Härledning</th>
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
                            <div className="text-xs text-slate-500">{fmt(row.line_type)}</div>
                          </td>
                          <td className="max-w-md text-xs text-slate-600">{provenance(row)}</td>
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
                        <td className="py-3" colSpan={5}>Summa</td>
                        <td className="text-right">{fmt(debugRun?.total_ex_vat)}</td>
                        <td></td>
                        <td className="text-right">{fmt(debugRun?.vat_amount)}</td>
                        <td className="text-right">{fmt(debugRun?.total_inc_vat)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : debugRun ? (
                <p className="mt-4 text-sm text-slate-500">Prisberäkningen har inga sparade rader (pricing_preview_lines saknas för körningen).</p>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
