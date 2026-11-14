import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { formatAverageMw } from '@/lib/analytics/power'
import { resolveElklartDemoConfig } from '@/lib/demo/elklartConfig'
import { demoDay, demoZones } from '@/lib/demo/elklartPortfolio'
import { buildLiveDemoPortfolio, demoDayBounds, parseDemoBindings } from '@/lib/demo/elklartLivePortfolio'
import { loadLiveDemoData } from '@/lib/demo/elklartLiveData'

export const dynamic = 'force-dynamic'
const energy = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
function mwh(value: number | null) { return value === null ? 'Saknas' : `${energy.format(value / 1000)} MWh` }
const linkStyle = 'rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }
export default async function ElklartOpsPortfolioPage({ searchParams }: Props) {
  const config = resolveElklartDemoConfig(process.env, (await headers()).get('host'))
  if (!config) notFound()
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  if (admin.companyId !== config.companyId) notFound()
  const params = await searchParams
  const day = typeof params.day === 'string' ? params.day : demoDay
  const zone = demoZones.find(value => value === params.zone) ?? 'SE4'
  let snapshot: { rows: ReturnType<typeof buildLiveDemoPortfolio>; readAt: string } | null = null
  let problem: string | null = null
  try {
    demoDayBounds(day)
    const bindings = parseDemoBindings(process.env.ELKLART_DEMO_BINDINGS)
    if (!bindings.length) problem = 'Demokunderna är ännu inte kopplade till portföljen. Förbered kundernas startlägen före genomgången.'
    else {
      const data = await loadLiveDemoData(config.companyId, bindings, day)
      snapshot = { rows: buildLiveDemoPortfolio({ companyId: config.companyId, bindings, day, zone, ...data }), readAt: data.readAt }
    }
  } catch {
    problem = 'Portföljen kunde inte verifieras. Kontrollera datum, kundkopplingar, behörigheter och mätserier innan du fortsätter.'
  }
  const rows = snapshot?.rows ?? []
  const selected = rows.find(row => row.startAt === params.interval) ?? rows.find(row => row.time.startsWith('12:00')) ?? rows[0]
  const query = new URLSearchParams({ day, zone })
  const totalForecast = rows.reduce((sum, row) => sum + row.forecastKwh, 0)
  const totalActual = rows.some(row => row.actualKwh === null) ? null : rows.reduce((sum, row) => sum + (row.actualKwh ?? 0), 0)
  const sum = (key: 'plannedKwh' | 'purchasedKwh' | 'remainingKwh') => rows.reduce((total, row) => total + row[key], 0)
  const scale = Math.max(1, ...rows.map(row => row.forecastKwh + row.plannedKwh))
  return (
    <main className="min-h-screen">
      <AdminHeader title="Elklart · portfölj från OPS" subtitle="Leveransperioder och aktuella mätvärden" userEmail={admin.email} workspaceName="Elklart" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <nav aria-label="Demovyer" className="flex flex-wrap gap-3">
          <Link className={linkStyle} href="/admin/elklart-demo">Demostart och förberedda exempel</Link>
          <Link className={linkStyle} href="/admin/analytics/portfolio">Ordinarie kundportfölj</Link>
        </nav>
        <section className="rounded-3xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-black">Leveransdagens portfölj · {zone}</h1>
          <p className="mt-2 text-sm text-slate-600">Leveransperioder och mätvärden läses från OPS. Prognosprofilen och inköpsprofilen är förberedda demoantaganden. En bekräftad start eller ett leveransslut påverkar prognosen när sidan uppdateras.</p>
          <form className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-bold">Leveransdag
              <input className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" type="date" name="day" required defaultValue={day} />
            </label>
            <label className="text-sm font-bold">Elområde
              <select className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" name="zone" defaultValue={zone}>{demoZones.map(value => <option key={value}>{value}</option>)}</select>
            </label>
            {rows.length > 0 && <label className="text-sm font-bold">Kvart
              <select className="mt-1 block rounded-xl border border-slate-300 px-3 py-2" name="interval" defaultValue={selected?.startAt}>{rows.map(row => <option key={row.startAt} value={row.startAt}>{row.time}</option>)}</select>
            </label>}
            <button className="rounded-xl bg-emerald-800 px-4 py-2 font-bold text-white">Uppdatera från OPS</button>
          </form>
          {problem && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-950">{problem}</p>}
          {snapshot && selected && <>
            <p className="mt-3 text-sm text-slate-600">Läst från OPS: <time dateTime={snapshot.readAt}>{new Date(snapshot.readAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</time>. Svensk lokal tid; {rows.length} kvartar.</p>
            <h2 className="mt-6 font-black">Dygnsenergi · {day}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[['Prognos', totalForecast], ['Planerat', sum('plannedKwh')], ['Inköpt i demot', sum('purchasedKwh')], ['Återstående behov (negativt = övertäckning)', sum('remainingKwh')], ['Uppmätt', totalActual]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><dt className="text-sm text-slate-600">{label}</dt><dd className="font-bold tabular-nums">{mwh(value as number | null)}</dd></div>)}
            </dl>
            <div className="mt-5 flex h-24 items-end gap-px" aria-label="Välj kvart för att visa anläggningar">
              {rows.map(row => <Link key={row.startAt} href={`?${query}&interval=${encodeURIComponent(row.startAt)}#anlaggningar`} aria-label={`Visa ${row.time}, prognos ${mwh(row.forecastKwh)}`} aria-current={row.startAt === selected.startAt ? 'true' : undefined} className="flex h-full min-w-0 flex-1 items-end focus-visible:outline-2 focus-visible:outline-emerald-950"><span className={`w-full ${row.startAt === selected.startAt ? 'bg-emerald-950' : 'bg-emerald-500'}`} style={{ height: `${Math.max(4, row.forecastKwh / scale * 100)}%` }} /></Link>)}
            </div>
            <section id="anlaggningar" className="mt-5">
              <h2 className="font-black">Anläggningar · {selected.time}</h2>
              <p className="mt-2 text-sm">Prognos {mwh(selected.forecastKwh)} ({formatAverageMw(selected.forecastKwh, 0.25)}). Inköpt {mwh(selected.purchasedKwh)}. Återstående behov {mwh(selected.remainingKwh)}. Uppmätt {mwh(selected.actualKwh)}. Avvikelse {mwh(selected.deviationKwh)}.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <caption className="sr-only">Kundernas bidrag till den valda kvarten</caption>
                  <thead className="bg-slate-50"><tr>{['Kund och anläggning', 'Prognos / medeleffekt', 'Planerat', 'Uppmätt', 'Leverans uppdaterad'].map(label => <th key={label} scope="col" className="px-3 py-2 text-left">{label}</th>)}</tr></thead>
                  <tbody>{selected.contributions.map(row => <tr key={row.meteringPointId} className="border-t border-slate-100">
                    <th scope="row" className="px-3 py-2 text-left"><Link className="text-emerald-800 underline" href={`/admin/customers/${row.customerId}`}>{row.customer} · {row.site}</Link></th>
                    <td className="px-3 py-2 tabular-nums">{mwh(row.forecastKwh)} / {formatAverageMw(row.forecastKwh, 0.25)}</td>
                    <td className="px-3 py-2 tabular-nums">{mwh(row.plannedKwh)}</td><td className="px-3 py-2 tabular-nums">{mwh(row.actualKwh)}</td>
                    <td className="px-3 py-2">{row.updatedAt ? new Date(row.updatedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' }) : 'Ingen leveransperiod'}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-slate-600">Saknas betyder att hela kvartens bekräftade leverans ännu inte täcks av aktuella mätvärden. Timvärden fördelas inte på påhittade kvartar. Korrigeringar ersätter utfall; prognosen ligger kvar.</p>
            </section>
          </>}
        </section>
      </div>
    </main>
  )
}
