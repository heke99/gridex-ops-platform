import type { PortfolioForecastMonth, PortfolioHorizon, PortfolioMonthRow } from '@/lib/analytics/customerPortfolio'
import { formatMwh, formatNumber } from '@/lib/analytics/utils'

function formatPercent(value: number | null) {
  return value === null ? '–' : `${(value * 100).toLocaleString('sv-SE', { maximumFractionDigits: 1 })} %`
}

function formatSigned(value: number) {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value)
}

function Card({ label, value, hint, tone = 'info' }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warning' | 'info' }) {
  const tones = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-slate-200 bg-white text-slate-900',
  }
  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${tones[tone]}`}>
      <p className="text-sm font-black">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight tabular-nums">{value}</p>
      {hint ? <p className="mt-2 text-xs font-bold leading-5 opacity-80">{hint}</p> : null}
    </div>
  )
}

export function PortfolioKpis({ current }: { current: PortfolioMonthRow | undefined }) {
  if (!current) return <p className="text-sm font-semibold text-slate-600">Ingen kunddata för perioden.</p>
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Card label="Aktiva kunder" value={formatNumber(current.activeCustomers)} hint={`${formatNumber(current.activeMeteringPoints)} aktiva anläggningar vid månadsslut`} />
      <Card label="Nya kunder" value={formatNumber(current.newCustomers)} hint="Första leveransstart i månaden" tone="ok" />
      <Card label="Lämnade kunder" value={formatNumber(current.churnedCustomers)} hint="Sista leveransdag i månaden" tone={current.churnedCustomers > 0 ? 'warning' : 'info'} />
      <Card label="Nettoförändring" value={formatSigned(current.netChange)} hint={`Från ${formatNumber(current.activeCustomersStart)} vid månadens start`} />
      <Card label="Churn" value={formatPercent(current.churnRate)} hint="Lämnade / aktiva vid månadens start" />
    </section>
  )
}

export function ForecastHorizonCards({ horizons }: { horizons: PortfolioHorizon[] }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {horizons.map((horizon) => (
        <Card
          key={horizon.key}
          label={`Prognos ${horizon.label.toLowerCase()}`}
          value={formatMwh(horizon.forecastKwh)}
          hint={`Intervall ${formatMwh(horizon.lowKwh)} – ${formatMwh(horizon.highKwh)}`}
        />
      ))}
    </section>
  )
}

export function ForecastCurve({ rows }: { rows: PortfolioForecastMonth[] }) {
  const max = Math.max(1, ...rows.map((row) => row.highKwh))
  if (rows.length === 0) return <p className="text-sm font-semibold text-slate-600">Ingen prognos ännu – inga aktiva anläggningar.</p>
  const coverage = rows[0] && rows[0].meteringPoints > 0 ? rows[0].pointsWithHistory / rows[0].meteringPoints : null
  return (
    <div className="space-y-3">
      {coverage !== null ? (
        <p className="text-xs font-semibold text-slate-500">
          {formatPercent(coverage)} av anläggningarna har egen mätvärdeshistorik; övriga skattas med portföljens snitt och säsongsprofil. Kända avslut är borträknade.
        </p>
      ) : null}
      {rows.map((row) => (
        <div key={row.month} className="grid grid-cols-[80px_1fr_90px] items-center gap-3 text-sm">
          <span className="font-bold text-slate-700 tabular-nums">{row.month.slice(0, 7)}</span>
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="absolute h-full rounded-full bg-emerald-200" style={{ left: `${(row.lowKwh / max) * 100}%`, width: `${((row.highKwh - row.lowKwh) / max) * 100}%` }} />
            <div className="absolute h-full rounded-full bg-emerald-700" style={{ width: `${Math.max(1, (row.forecastKwh / max) * 100)}%`, opacity: 0.85 }} />
          </div>
          <span className="text-right font-black text-slate-900 tabular-nums">{formatMwh(row.forecastKwh)}</span>
        </div>
      ))}
    </div>
  )
}

export function PortfolioMonthTable({ rows }: { rows: PortfolioMonthRow[] }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Månad</th>
            <th className="px-4 py-3 text-right">Aktiva</th>
            <th className="px-4 py-3 text-right">Nya</th>
            <th className="px-4 py-3 text-right">Lämnade</th>
            <th className="px-4 py-3 text-right">Netto</th>
            <th className="px-4 py-3 text-right">Churn</th>
            <th className="px-4 py-3 text-right">Fullmakter begärda</th>
            <th className="px-4 py-3 text-right">Fullmakter signerade</th>
            <th className="px-4 py-3 text-right">Giltiga fullmakter</th>
            <th className="px-4 py-3 text-right">Mätvärdesbegäran</th>
            <th className="px-4 py-3 text-right">varav historiska</th>
            <th className="px-4 py-3 text-right">varav löpande</th>
            <th className="px-4 py-3 text-right">Misslyckade</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {[...rows].reverse().map((row) => (
            <tr key={row.month}>
              <td className="px-4 py-3 font-bold text-slate-800">{row.month.slice(0, 7)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.activeCustomers)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.newCustomers)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.churnedCustomers)}</td>
              <td className="px-4 py-3 text-right">{formatSigned(row.netChange)}</td>
              <td className="px-4 py-3 text-right">{formatPercent(row.churnRate)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.poaRequested)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.poaSigned)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.poaActive)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.meteringRequestsTotal)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.meteringRequestsHistorical)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.meteringRequestsOngoing)}</td>
              <td className="px-4 py-3 text-right">{formatNumber(row.meteringRequestsFailed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CustomerPortfolioPanel({ months, forecastMonths, horizons }: { months: PortfolioMonthRow[]; forecastMonths: PortfolioForecastMonth[]; horizons: PortfolioHorizon[] }) {
  const current = months[months.length - 1]
  return (
    <div className="space-y-6">
      <PortfolioKpis current={current} />
      <ForecastHorizonCards horizons={horizons} />
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-950">Förbrukningsprognos 12 månader</h2>
        <div className="mt-4"><ForecastCurve rows={forecastMonths} /></div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-black text-slate-950">Kunder, fullmakter och mätvärden per månad</h2>
        <PortfolioMonthTable rows={months} />
      </section>
    </div>
  )
}
