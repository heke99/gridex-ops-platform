import Link from 'next/link'
import type { DeviationRow, ForecastSummaryRow, MetricCard, MonthlyMetricRow, ReportDefinition, SimpleChartRow } from '@/lib/analytics/types'
import { formatMwh, formatNumber } from '@/lib/analytics/utils'

export function AnalyticsTabs({ active }: { active: 'overview' | 'forecast' | 'deviations' | 'reports' }) {
  const tabs = [
    { key: 'overview', label: 'Översikt', href: '/admin/analytics' },
    { key: 'forecast', label: 'Prognos', href: '/admin/analytics/forecast' },
    { key: 'deviations', label: 'Avvikelser', href: '/admin/analytics/deviations' },
    { key: 'reports', label: 'Rapporter', href: '/admin/analytics/reports' },
  ] as const

  return (
    <nav className="flex flex-wrap gap-2">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`rounded-2xl px-4 py-2 text-sm font-black ${active === tab.key ? 'bg-emerald-700 text-white' : 'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

export function AnalyticsFilters({
  month,
  biddingZones,
  gridOwners,
  meteringMethods = [],
  statuses = [],
  selected = {},
}: {
  month: string
  biddingZones: string[]
  gridOwners: Array<{ id: string; name: string }>
  meteringMethods?: string[]
  statuses?: string[]
  selected?: {
    biddingZoneCode?: string | null
    gridOwnerId?: string | null
    customerType?: string | null
    meteringMethod?: string | null
    status?: string | null
  }
}) {
  return (
    <form className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3 xl:grid-cols-7">
      <label className="text-sm font-bold text-slate-700">
        Månad / period
        <input name="month" type="month" defaultValue={month.slice(0, 7)} className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" />
      </label>
      <label className="text-sm font-bold text-slate-700">
        SE-område
        <select name="biddingZoneCode" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" defaultValue={selected.biddingZoneCode ?? ''}>
          <option value="">Alla</option>
          {biddingZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold text-slate-700">
        Nätägare
        <select name="gridOwnerId" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" defaultValue={selected.gridOwnerId ?? ''}>
          <option value="">Alla</option>
          {gridOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold text-slate-700">
        Kundtyp
        <select name="customerType" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" defaultValue={selected.customerType ?? ''}>
          <option value="">Alla</option>
          <option value="private">Privat</option>
          <option value="business">Företag</option>
        </select>
      </label>
      <label className="text-sm font-bold text-slate-700">
        Mätmetod
        <select name="meteringMethod" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" defaultValue={selected.meteringMethod ?? ''}>
          <option value="">Alla</option>
          {meteringMethods.map((method) => <option key={method} value={method}>{method}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold text-slate-700">
        Status
        <select name="status" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2" defaultValue={selected.status ?? ''}>
          <option value="">Alla</option>
          {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <button className="self-end rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Filtrera</button>
    </form>
  )
}

export function MetricCards({ cards }: { cards: MetricCard[] }) {
  const tone = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    critical: 'border-red-200 bg-red-50 text-red-900',
    info: 'border-slate-200 bg-white text-slate-900',
  }
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => {
        const content = (
          <div className={`h-full rounded-3xl border p-5 shadow-sm ${tone[card.status]}`}>
            <p className="text-sm font-black">{card.label}</p>
            <p className="mt-2 text-3xl font-black tracking-tight">{card.value}</p>
            <p className="mt-2 text-xs font-bold leading-5 opacity-80">{card.hint}</p>
          </div>
        )
        return card.href ? <Link key={card.key} href={card.href}>{content}</Link> : <div key={card.key}>{content}</div>
      })}
    </section>
  )
}

export function SimpleBars({ rows, valueKey, labelKey }: { rows: MonthlyMetricRow[]; valueKey: keyof MonthlyMetricRow; labelKey: keyof MonthlyMetricRow }) {
  const max = Math.max(1, ...rows.map((row) => Number(row[valueKey] ?? 0)))
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const value = Number(row[valueKey] ?? 0)
        return (
          <div key={`${row.month}-${String(valueKey)}`} className="grid grid-cols-[90px_1fr_80px] items-center gap-3 text-sm">
            <span className="font-bold text-slate-700">{String(row[labelKey] ?? row.month).slice(0, 7)}</span>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
            </div>
            <span className="text-right font-black text-slate-900">{formatNumber(value)}</span>
          </div>
        )
      })}
    </div>
  )
}

export function SimpleChart({ rows, emptyLabel = 'Ingen data finns ännu.' }: { rows: SimpleChartRow[]; emptyLabel?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-[150px_1fr_90px] items-center gap-3 text-sm">
          <span className="truncate font-bold text-slate-700">{row.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.max(4, (row.value / max) * 100)}%` }} />
          </div>
          <span className="text-right font-black text-slate-900">{formatNumber(row.value)}</span>
          {row.hint ? <span className="col-span-3 text-xs font-semibold text-slate-500">{row.hint}</span> : null}
        </div>
      ))}
      {rows.length === 0 ? <p className="text-sm font-semibold text-slate-600">{emptyLabel}</p> : null}
    </div>
  )
}

export function ForecastTable({ rows }: { rows: ForecastSummaryRow[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
          <tr>
            <th className="px-5 py-4">SE-område</th>
            <th className="px-5 py-4">Prognos</th>
            <th className="px-5 py-4">Faktiskt</th>
            <th className="px-5 py-4">Diff</th>
            <th className="px-5 py-4">Säkerhet</th>
            <th className="px-5 py-4">Saknad data</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.biddingZoneCode}>
              <td className="px-5 py-4 font-black text-slate-950">{row.biddingZoneCode}</td>
              <td className="px-5 py-4">{formatMwh(row.forecastKwh)}</td>
              <td className="px-5 py-4">{formatMwh(row.actualKwh)}</td>
              <td className="px-5 py-4">{row.diffPercent === null ? '–' : `${row.diffPercent > 0 ? '+' : ''}${row.diffPercent.toFixed(0)} %`}</td>
              <td className="px-5 py-4">{row.confidenceScore ? `${row.confidenceScore} %` : '–'}</td>
              <td className="px-5 py-4">{row.missingDataCount}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center font-semibold text-slate-600">Ingen prognos finns för vald period.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

export function GridOwnerForecastTable({ rows }: { rows: ForecastSummaryRow[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
          <tr>
            <th className="px-5 py-4">Nätägare</th>
            <th className="px-5 py-4">Prognos</th>
            <th className="px-5 py-4">Faktiskt</th>
            <th className="px-5 py-4">Diff</th>
            <th className="px-5 py-4">Säkerhet</th>
            <th className="px-5 py-4">Saknad data</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.gridOwnerId ?? row.gridOwnerName}>
              <td className="px-5 py-4 font-black text-slate-950">{row.gridOwnerName ?? 'Saknad nätägare'}</td>
              <td className="px-5 py-4">{formatMwh(row.forecastKwh)}</td>
              <td className="px-5 py-4">{formatMwh(row.actualKwh)}</td>
              <td className="px-5 py-4">{row.diffPercent === null ? '–' : `${row.diffPercent > 0 ? '+' : ''}${row.diffPercent.toFixed(0)} %`}</td>
              <td className="px-5 py-4">{row.confidenceScore ? `${row.confidenceScore} %` : '–'}</td>
              <td className="px-5 py-4">{row.missingDataCount}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center font-semibold text-slate-600">Ingen nätägarprognos finns för vald period.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

export function DeviationsTable({ rows }: { rows: DeviationRow[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
          <tr>
            <th className="px-5 py-4">Typ</th>
            <th className="px-5 py-4">Påverkar</th>
            <th className="px-5 py-4">Allvar</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4">Åtgärd</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-5 py-4 font-black text-slate-950">{row.type}<div className="text-xs font-semibold text-slate-500">{row.message}</div></td>
              <td className="px-5 py-4">{row.affects}</td>
              <td className="px-5 py-4">{row.severity === 'critical' ? 'Kritisk' : 'Varning'}</td>
              <td className="px-5 py-4">{row.status === 'open' ? 'Öppen' : row.status}</td>
              <td className="px-5 py-4">{row.actionHref ? <Link href={row.actionHref} className="font-black text-emerald-800 hover:underline">Visa</Link> : 'Visa detaljer'}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={5} className="px-5 py-10 text-center font-semibold text-slate-600">Inga öppna avvikelser.</td></tr> : null}
        </tbody>
      </table>
    </div>
  )
}

export function ReportsList({ reports, month }: { reports: ReportDefinition[]; month: string }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {reports.map((report) => (
        <div key={report.key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">{report.label}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{report.description}</p>
          <Link href={`/admin/analytics/export?report=${report.key}&month=${month.slice(0, 7)}`} className="mt-4 inline-flex rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">
            Exportera CSV
          </Link>
        </div>
      ))}
    </section>
  )
}
