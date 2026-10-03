import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { CustomerPortfolioPanel, PortfolioInsightsPanel } from '@/components/admin/analytics/CustomerPortfolioViews'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { getCustomerPortfolio, getCustomerPortfolioInsights, getWhiteLabelPortfolioOverview, listReadableWhiteLabelPlatforms } from '@/lib/analytics/customerPortfolio'
import { addMonths, formatMwh, formatNumber, monthStart } from '@/lib/analytics/utils'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<{ platform?: string; company?: string; month?: string }> }

// Read-only: white-label members see every tenant attached to their platform.
// Access is enforced again by the database RPCs; nothing here writes.
export default async function WhiteLabelPortfolioPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageAccess({ anyOf: ['whitelabel.read'] })
  const params = await searchParams
  const month = monthStart(params.month)
  const platforms = await listReadableWhiteLabelPlatforms()
  const platform = platforms.find((row) => row.id === params.platform) ?? platforms[0]

  if (!platform) {
    return (
      <div className="min-h-screen">
        <AdminHeader title="Portföljöversikt" subtitle="Du är inte medlem i någon white-label-plattform." userEmail={admin.email} />
      </div>
    )
  }

  const tenants = await getWhiteLabelPortfolioOverview(platform.id, month)
  const selected = tenants.find((row) => row.companyId === params.company) ?? null
  const detail = selected
    ? await Promise.all([
        getCustomerPortfolio(selected.companyId, addMonths(month, -11), month),
        getCustomerPortfolioInsights(selected.companyId, addMonths(month, -11), month),
      ])
    : null
  const totals = tenants.reduce(
    (sum, row) => ({
      active: sum.active + row.activeCustomers,
      added: sum.added + row.newCustomers,
      churned: sum.churned + row.churnedCustomers,
      poa: sum.poa + row.poaRequested,
      requests: sum.requests + row.meteringRequestsTotal,
      m1: sum.m1 + row.forecastMonthKwh,
      m3: sum.m3 + row.forecast3mKwh,
      m6: sum.m6 + row.forecast6mKwh,
      m12: sum.m12 + row.forecast12mKwh,
    }),
    { active: 0, added: 0, churned: 0, poa: 0, requests: 0, m1: 0, m3: 0, m6: 0, m12: 0 },
  )
  const href = (company?: string) => {
    const query = new URLSearchParams({ platform: platform.id, month: month.slice(0, 7) })
    if (company) query.set('company', company)
    return `/admin/whitelabel/portfolio?${query.toString()}`
  }

  return (
    <div className="min-h-screen">
      <AdminHeader title={`Portföljöversikt – ${platform.name}`} subtitle="Endast läsbehörighet. Kunder, fullmakter, mätvärden och prognos för alla bolag under plattformen." userEmail={admin.email} workspaceName="Min plattform" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <form className="flex flex-wrap items-end gap-3">
          {platforms.length > 1 ? (
            <label className="text-sm font-bold text-slate-700">
              Plattform
              <select name="platform" defaultValue={platform.id} className="mt-1 block rounded-2xl border border-slate-300 px-3 py-2">
                {platforms.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
          ) : <input type="hidden" name="platform" value={platform.id} />}
          <label className="text-sm font-bold text-slate-700">
            Bolag
            <select name="company" defaultValue={selected?.companyId ?? ''} className="mt-1 block rounded-2xl border border-slate-300 px-3 py-2">
              <option value="">Alla bolag</option>
              {tenants.map((row) => <option key={row.companyId} value={row.companyId}>{row.companyName}</option>)}
            </select>
          </label>
          <label className="text-sm font-bold text-slate-700">
            Månad
            <input type="month" name="month" defaultValue={month.slice(0, 7)} className="mt-1 block rounded-2xl border border-slate-300 px-3 py-2" />
          </label>
          <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Visa</button>
        </form>

        {selected && detail ? (
          <>
            <p className="text-sm font-bold text-slate-600">
              <Link href={href()} className="text-emerald-800 underline">← Alla bolag</Link> · {selected.companyName} ·{' '}
              <a href={`/admin/whitelabel/portfolio/export?platform=${platform.id}&company=${selected.companyId}&month=${month.slice(0, 7)}`} className="text-emerald-800 underline">Exportera CSV</a>
            </p>
            <CustomerPortfolioPanel {...detail[0]} />
            <PortfolioInsightsPanel insights={detail[1]} />
          </>
        ) : (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="Bolag" value={formatNumber(tenants.length)} />
              <Stat label="Aktiva kunder" value={formatNumber(totals.active)} hint={`+${formatNumber(totals.added)} nya, −${formatNumber(totals.churned)} lämnade`} />
              <Stat label="Fullmakter / mätvärdesbegäran" value={`${formatNumber(totals.poa)} / ${formatNumber(totals.requests)}`} hint="Begärda i månaden" />
              <Stat label="Prognos 12 mån" value={formatMwh(totals.m12)} hint={`Månad ${formatMwh(totals.m1)} · 3 mån ${formatMwh(totals.m3)} · 6 mån ${formatMwh(totals.m6)}`} />
            </section>
            <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Bolag</th>
                    <th className="px-4 py-3 text-right">Aktiva</th>
                    <th className="px-4 py-3 text-right">Nya</th>
                    <th className="px-4 py-3 text-right">Lämnade</th>
                    <th className="px-4 py-3 text-right">Netto</th>
                    <th className="px-4 py-3 text-right">Fullmakter</th>
                    <th className="px-4 py-3 text-right">Giltiga fullmakter</th>
                    <th className="px-4 py-3 text-right">Mätvärdesbegäran</th>
                    <th className="px-4 py-3 text-right">Prognos månad</th>
                    <th className="px-4 py-3 text-right">3 mån</th>
                    <th className="px-4 py-3 text-right">6 mån</th>
                    <th className="px-4 py-3 text-right">12 mån</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {tenants.map((row) => (
                    <tr key={row.companyId}>
                      <td className="px-4 py-3 font-bold"><Link href={href(row.companyId)} className="text-emerald-800 underline">{row.companyName}</Link></td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.activeCustomers)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.newCustomers)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.churnedCustomers)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.netChange)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.poaRequested)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.poaActive)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(row.meteringRequestsTotal)}</td>
                      <td className="px-4 py-3 text-right">{formatMwh(row.forecastMonthKwh)}</td>
                      <td className="px-4 py-3 text-right">{formatMwh(row.forecast3mKwh)}</td>
                      <td className="px-4 py-3 text-right">{formatMwh(row.forecast6mKwh)}</td>
                      <td className="px-4 py-3 text-right">{formatMwh(row.forecast12mKwh)}</td>
                    </tr>
                  ))}
                  {tenants.length === 0 ? <tr><td colSpan={12} className="px-4 py-6 text-center font-semibold text-slate-500">Inga bolag är kopplade till plattformen ännu.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-black text-slate-700">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-slate-950 tabular-nums">{value}</p>
      {hint ? <p className="mt-2 text-xs font-bold text-slate-500">{hint}</p> : null}
    </div>
  )
}
