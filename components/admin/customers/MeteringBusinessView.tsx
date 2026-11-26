import { meteringBusinessIdentity, type MeteringBusinessData } from '@/lib/admin/meteringBusinessData'
import { formatAdminDate, formatAdminDateTime, formatStatusLabel } from '@/lib/ui/format'
import type { GridOwnerDataRequestRow, MeteringValueRow } from '@/lib/cis/types'

const readingLabels: Record<string, string> = { consumption: 'Förbrukning', production: 'Produktion', estimated: 'Uppskattat värde', adjustment: 'Rättelse' }
const linkStyle = 'inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700'
export default function MeteringBusinessView({ requests, values, query, businessData }: { businessData: MeteringBusinessData; requests: GridOwnerDataRequestRow[]; values: MeteringValueRow[]; query: string }) {
  const displayed = values.slice(0, 80)
  const waiting = requests.filter(request => request.status === 'pending' || request.status === 'sent').length
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <form className="flex min-w-0 flex-wrap gap-2"><label className="grid min-w-0 flex-1 gap-1 text-sm">Sök bland inlästa mätvärden<input name="q" defaultValue={query} placeholder="Kund, anläggning eller datum" className="min-h-11 min-w-0 w-full rounded-xl border border-slate-300 px-3 py-2" /></label><button className="min-h-11 self-end rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Sök</button></form>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">Väntande begäranden</p><p className="mt-1 text-2xl font-semibold">{waiting}</p></div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">Mätvärden i listan</p><p className="mt-1 text-2xl font-semibold">{displayed.length}</p></div>
    </div>
    <details className="rounded-2xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">Begäranden till nätägare ({requests.length})</summary>
      {requests.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga begäranden registrerade.</p> : <div role="region" aria-label="Begärda mätvärden" tabIndex={0} className="mt-3 max-h-80 space-y-2 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{requests.map(request => <article key={request.id} className="rounded-xl border border-slate-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{meteringBusinessIdentity(request, businessData).customer}</span><span>{formatStatusLabel(request.status, 'Status saknas', 'Behöver granskning')}</span></div><p className="mt-2 break-words text-slate-600">Anläggning: {meteringBusinessIdentity(request, businessData).site}</p><p className="mt-2 text-slate-600">Period: {formatAdminDate(request.requested_period_start, 'Saknas')} – {formatAdminDate(request.requested_period_end, 'Saknas')}</p><a href={`/admin/operations/grid-owner-requests/${request.id}`} className={linkStyle}>Öppna begäran</a></article>)}</div>}
    </details>
    <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Mottagna mätvärden">
      <h2 className="text-base font-semibold text-slate-950">Senaste mätvärden</h2>
      {displayed.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga mätvärden hittades.</p> : <div role="region" aria-label="Mätvärdeslista" tabIndex={0} className="mt-3 max-h-[36rem] space-y-3 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{displayed.map(value => {
        const identity = meteringBusinessIdentity(value, businessData)
        return <article key={value.id} className="min-w-0 rounded-xl border border-slate-200 p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><p className="font-medium">{identity.customer}</p><p className="font-semibold">{new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 4 }).format(value.value_kwh)} kWh</p></div>
        <p className="mt-1 break-words text-slate-600">Anläggning: {identity.site}</p>
        {identity.meter ? <p className="mt-1 break-words text-slate-600">Mätpunkt: {identity.meter}</p> : null}
        <p className="mt-1 text-slate-600">{readingLabels[value.reading_type] ?? 'Behöver granskning'} · {formatAdminDateTime(value.read_at, 'Avläsningstid saknas')}</p>
        <p className="mt-1 break-words text-slate-600">Period: {formatAdminDateTime(value.period_start, 'Saknas')} – {formatAdminDateTime(value.period_end, 'Saknas')}</p>
        {(value.revision_number ?? 1) > 1 || value.previous_value_id || /correct|korr|rätt/i.test(String(value.quality_code ?? '')) ? <p className="mt-1 font-medium text-amber-900">Rättat mätvärde</p> : null}
        {value.is_current === false ? <p className="mt-1 font-medium text-amber-900">Ersatt av ett senare mätvärde</p> : null}
        <div className="mt-2 flex flex-wrap gap-x-4">{identity.customerSiteId ? <a href={`/admin/customers/${encodeURIComponent(value.customer_id)}?tab=sites&site=${encodeURIComponent(identity.customerSiteId)}#vald-anlaggning`} className={linkStyle}>Visa anläggning</a> : null}{value.grid_owner_request_link_id ? <a href={`/admin/operations/grid-owner-requests/${value.grid_owner_request_link_id}`} className={linkStyle}>Ursprunglig begäran</a> : null}</div>
      </article>
      })}</div>}
      {values.length > displayed.length ? <p className="mt-3 text-xs text-slate-600">Visar {displayed.length} av {values.length} inlästa mätvärden. Sökningen gäller de senaste inlästa värdena.</p> : null}
    </section>
  </main>
}
