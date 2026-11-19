import { getCustomerPortalContext, listPortalMeteringPointNumbers, listPortalMeteringValues, listPortalMonthlyConsumption } from '@/lib/customer-portal/db'
import { formatDate, formatKwh, formatPeriod } from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

function readingTypeLabel(value: string | null) {
  const type = value?.trim().toLowerCase()
  if (type === 'consumption') return 'Förbrukning'
  if (type === 'production') return 'Produktion'
  return type ? 'Okänd mättyp' : 'Mättyp ej angiven'
}

function qualityLabel(value: string | null) {
  const quality = value?.trim().toLowerCase()
  if (quality === 'measured' || quality === 'actual') return 'Uppmätt värde'
  if (quality === 'estimated') return 'Uppskattat värde'
  if (quality === 'calculated') return 'Beräknat värde'
  if (quality === 'preliminary' || quality === 'temp' || quality === 'temporary') return 'Preliminärt värde'
  if (quality === 'corrected') return 'Korrigerat värde'
  return quality ? 'Okänd kvalitet' : 'Kvalitet ej angiven'
}

export default async function PortalConsumptionPage() {
  const context = await getCustomerPortalContext()
  // Month cards use the complete native month sum; the detail list below stays bounded.
  const detail = listPortalMeteringValues(context, { limit: 500 }).then(async (values) => ({
    values,
    pointNumbers: await listPortalMeteringPointNumbers(context, values).catch(() => null),
  }))
  const [{ values, pointNumbers }, months] = await Promise.all([detail, listPortalMonthlyConsumption(context)])

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Min förbrukning</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Förbrukningen baseras på mätvärden som {context.branding.brandName} har tagit emot
          från din nätägare. Saknas en period betyder det att mätvärden ännu inte
          har kommit in eller inte har kopplats färdigt.
        </p>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {months.slice(0, 4).map((month) => (
          <article key={month.monthKey} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">{month.label}</p>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatKwh(month.totalKwh)}</p>
            <p className="mt-2 text-sm text-slate-600">
              {month.valueCount} mätvärden{month.complete === false ? ' · ofullständig månad' : ''}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-950">Mätvärden</h2>
          <p className="mt-1 text-sm text-slate-500">Senaste {values.length} värden.</p>
        </div>

        <div className="divide-y divide-slate-100">
          {values.map((value) => {
            const number = pointNumbers?.get(value.id)
            const pointLabel = pointNumbers === null
              ? 'Mätpunktsnumret kunde inte hämtas'
              : number ? `Mätpunkt ${number}` : 'Mätpunktsnummer saknas'
            return (
              <div key={value.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1fr_1fr_1fr_160px] lg:items-center">
                <div>
                  <div className="font-medium text-slate-950">{formatKwh(value.value_kwh)}</div>
                  <div className="mt-1 text-xs text-slate-500">{readingTypeLabel(value.reading_type)} · {qualityLabel(value.quality_code)}</div>
                </div>
                <div className="text-sm text-slate-600">{formatPeriod(value.period_start, value.period_end)}</div>
                <div className="text-sm text-slate-600">{pointLabel}</div>
                <div className="text-sm text-slate-500">Mottaget {formatDate(value.created_at)}</div>
              </div>
            )
          })}

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
