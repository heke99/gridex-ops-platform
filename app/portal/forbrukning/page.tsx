import { getCustomerPortalContext, listPortalConsumptionPage } from '@/lib/customer-portal/db'
import { formatDate, formatKwh, formatPeriod, PORTAL_CONSUMPTION_BOUNDARY_NOTICE, PORTAL_CONSUMPTION_REVIEW_NOTICES } from '@/lib/customer-portal/format'

export const dynamic = 'force-dynamic'

const readingTimestamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  timeZoneName: 'longOffset',
})

function readingInterval(start: string | null, end: string | null) {
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i
  if (!start || !end || !zoned.test(start) || !zoned.test(end)) {
    return { label: formatPeriod(start, end), minutes: null }
  }
  const startsAt = new Date(start)
  const endsAt = new Date(end)
  const durationMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return { label: formatPeriod(start, end), minutes: null }
  }
  return {
    label: `${readingTimestamp.format(startsAt)} – ${readingTimestamp.format(endsAt)}`,
    minutes: Number.isInteger(durationMinutes) ? durationMinutes : null,
  }
}

export default async function PortalConsumptionPage() {
  const context = await getCustomerPortalContext()
  const { values, months } = await listPortalConsumptionPage(context)

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
            <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{month.totalKwh === null ? 'Summa otillgänglig' : formatKwh(month.totalKwh)}</p>
            <p className="mt-2 text-sm text-slate-600">
              {month.valueCount} mätvärden{month.complete === false ? ' · ofullständig månad' : ''}
            </p>
            {month.reviewReasons?.map((reason) => (
              <p key={reason} className="mt-2 text-sm text-slate-600">{PORTAL_CONSUMPTION_REVIEW_NOTICES[reason]}</p>
            ))}
            {month.needsFinerIntervals ? (
              <p className="mt-2 text-sm text-slate-600">{PORTAL_CONSUMPTION_BOUNDARY_NOTICE}</p>
            ) : null}
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-lg font-semibold text-slate-950">Mätvärden</h2>
          <p className="mt-1 text-sm text-slate-500">
            Senaste {values.length} aktuella värden. När nätägaren rättar ett värde visas den senaste versionen.
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {values.map((value) => {
            const interval = readingInterval(value.period_start, value.period_end)
            return (
              <div key={value.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1fr_1fr_1fr_160px] lg:items-center">
                <div>
                  <div className="font-medium text-slate-950">{formatKwh(value.value_kwh)}</div>
                  <div className="mt-1 text-xs text-slate-500">{value.reading_type} · {value.quality_code ?? 'ingen kvalitetskod'}</div>
                </div>
                <div className="text-sm text-slate-600">
                  <div>{interval.label}</div>
                  {interval.minutes !== null ? (
                    <div className="text-xs text-slate-500">Intervall {interval.minutes} {interval.minutes === 1 ? 'minut' : 'minuter'}</div>
                  ) : null}
                </div>
                <div className="text-sm text-slate-600">{value.meter_point_id ? `Mätpunkt ${value.meter_point_id}` : 'Mätpunktsuppgifter saknas'}</div>
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
