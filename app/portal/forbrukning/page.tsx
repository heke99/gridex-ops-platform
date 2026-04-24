import { getCustomerPortalContext, listPortalMeteringValues, summarizeConsumptionByMonth } from '@/lib/customer-portal/db'
import { formatDate, formatKwh, formatPeriod } from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

export default async function PortalConsumptionPage() {
  const context = await getCustomerPortalContext()
  const values = await listPortalMeteringValues(context, { limit: 500 })
  const months = summarizeConsumptionByMonth(values)

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Min förbrukning</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Förbrukningen baseras på mätvärden som Gridex har mottagit från nätägaren,
          normalt via UTILTS E66/E30. Saknas en period betyder det att mätvärden ännu inte
          har inkommit eller inte har kopplats färdigt.
        </p>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {months.slice(0, 4).map((month) => (
          <article key={month.monthKey} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">{month.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatKwh(month.totalKwh)}</p>
            <p className="mt-2 text-sm text-slate-600">{month.valueCount} mätvärden</p>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-950">Mätvärden</h2>
          <p className="mt-1 text-sm text-slate-500">Senaste {values.length} värden.</p>
        </div>

        <div className="divide-y divide-slate-100">
          {values.map((value) => (
            <div key={value.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1fr_1fr_1fr_160px] lg:items-center">
              <div>
                <div className="font-medium text-slate-950">{formatKwh(value.value_kwh)}</div>
                <div className="mt-1 text-xs text-slate-500">{value.reading_type} · {value.quality_code ?? 'ingen kvalitetskod'}</div>
              </div>
              <div className="text-sm text-slate-600">{formatPeriod(value.period_start, value.period_end)}</div>
              <div className="text-sm text-slate-600">Mätpunkt {value.metering_point_id}</div>
              <div className="text-sm text-slate-500">Mottaget {formatDate(value.created_at)}</div>
            </div>
          ))}

          {values.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Inga mätvärden har kopplats till ditt konto ännu.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
