import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { formatAverageMw } from '@/lib/analytics/power'
import { resolveElklartDemoConfig } from '@/lib/demo/elklartConfig'
import { demoDay, demoPortfolio, demoStages, demoZones, type DemoStage } from '@/lib/demo/elklartPortfolio'

export const dynamic = 'force-dynamic'

const stages: Record<DemoStage, string> = {
  baseline: 'Planerad leverans',
  confirmed: 'Bekräftad leverans',
  evening: 'Kvällsskift',
  measured: 'Mätvärden inkomna',
  ended: 'Efter utflyttning',
}

const scenarios = [
  ['Anna Lind', 'Nytt avtal och leverantörsbyte', '/admin/website-applications', 'Öppna ansökningar'],
  ['Anna Lind', 'Bekräftad leveransstart och portfölj', '/admin/operations/switches', 'Öppna leverantörsbyten'],
  ['Samir Ek', 'Inflyttning och förbrukning från leveransstart', '/admin/customers?q=Samir%20Ek', 'Sök upp kunden'],
  ['Sjövik Verkstad AB', 'Två anläggningar och ändrad prognos', '/admin/customers?q=Sj%C3%B6vik%20Verkstad%20AB', 'Sök upp företaget'],
  ['Sjövik Verkstad AB', 'Uppmätta och korrigerade mätvärden', '/admin/metering', 'Öppna mätvärden'],
  ['Sjövik Verkstad AB', 'Fakturaunderlag och faktura', '/admin/billing', 'Öppna fakturering'],
  ['Karin Holm', 'Fakturafråga, intern anteckning och kundsvar', '/admin/customer-cases', 'Öppna kundärenden'],
  ['Bergdala Fastigheter AB', 'Stoppat byte och nytt försök', '/admin/operations/switches', 'Öppna leverantörsbyten'],
  ['Jonas Vik', 'Utflyttning, slutfaktura och framtida prognos', '/admin/customers?q=Jonas%20Vik', 'Sök upp kunden'],
  ['Elklart', 'Personal och behörigheter', '/admin/users', 'Öppna användare'],
] as const

const inputStyle = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2'
const linkStyle = 'rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50'
const energy = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })

function EnergyCell({ value, hours }: { value: number | null; hours: number }) {
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
      {value === null ? '–' : (
        <>{energy.format(value / 1000)} MWh<span className="block text-xs text-slate-600">{formatAverageMw(value, hours)}</span></>
      )}
    </td>
  )
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function ElklartDemoPage({ searchParams }: Props) {
  const config = resolveElklartDemoConfig(process.env, (await headers()).get('host'))
  if (!config) notFound()
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  if (admin.companyId !== config.companyId) notFound()

  const params = await searchParams
  const zone = demoZones.find(value => value === params.zone) ?? 'SE4'
  const stage = demoStages.find(value => value === params.stage) ?? 'baseline'
  const resolution = params.resolution === '60' ? 60 : 15
  const intervals = demoPortfolio(zone, stage, resolution)
  const selected = intervals.find(row => String(row.index) === params.interval) ?? intervals[12 * 60 / resolution]
  const hours = resolution / 60
  const scale = Math.max(...intervals.map(row => row.forecastKwh), 1)
  const metrics = [
    { label: 'Prognos', value: selected.forecastKwh },
    { label: 'Planerat', value: selected.plannedKwh },
    { label: 'Inköpt', value: selected.purchasedKwh },
    { label: selected.remainingKwh < 0 ? 'Övertäckning' : 'Kvar att täcka', value: Math.abs(selected.remainingKwh) },
    { label: 'Uppmätt', value: selected.actualKwh },
    { label: 'Utfall mot prognos', value: selected.deviationKwh },
  ]
  const query = new URLSearchParams({ zone, stage, resolution: String(resolution) })

  return (
    <main className="min-h-screen">
      <AdminHeader title="Elklart · systemdemo" subtitle="Kunder, leveranser, portfölj och fakturering" userEmail={admin.email} workspaceName="Elklart" />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <nav aria-label="Demovyer" className="flex flex-wrap gap-3">
          <Link className={linkStyle} href="/admin">Öppna OPS</Link>
          <a className={linkStyle} href={`${config.portalOrigin}/mina-sidor`} target="_blank" rel="noreferrer">Öppna Mina sidor</a>
          <a className={linkStyle} href={`${config.portalOrigin}/teckna-avtal`} target="_blank" rel="noreferrer">Teckna avtal</a>
          <Link className={linkStyle} href="/admin/analytics/portfolio">Öppna OPS ordinarie kundportfölj</Link>
        </nav>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-black text-slate-950">Portfölj · scenarioövning</h1>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-900">Simulerat exempel · {demoDay}</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">Välj ett steg för att se hur den förberedda kundvolymen påverkar prognosen. Övningen använder egna exempelvärden.</p>
          <form action="/admin/elklart-demo#intervall" className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm font-bold">Elområde
              <select name="zone" defaultValue={zone} className={inputStyle}>
                {demoZones.map(value => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold">Scenario
              <select name="stage" defaultValue={stage} className={inputStyle}>
                {demoStages.map(value => <option key={value} value={value}>{stages[value]}</option>)}
              </select>
            </label>
            <label className="text-sm font-bold">Upplösning
              <select name="resolution" defaultValue={resolution} className={inputStyle}>
                <option value={15}>Kvart</option>
                <option value={60}>Timme</option>
              </select>
            </label>
            <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Visa</button>
            <Link className={linkStyle} href="/admin/elklart-demo">Återställ övningen</Link>
          </form>

          <section id="intervall" aria-label="Valt portföljintervall" className="mt-5 space-y-3">
            <h2 className="font-black">Volym kl. {selected.time} · {zone}</h2>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {metrics.map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3 tabular-nums">
                  <dt className="text-xs font-bold text-slate-600">{label}</dt>
                  <dd className="font-black text-slate-950">{value === null ? '–' : `${energy.format(value / 1000)} MWh`}</dd>
                  {value !== null && <dd className="text-xs text-slate-600">{formatAverageMw(value, hours)}</dd>}
                </div>
              ))}
            </dl>
            <div aria-hidden="true" className="flex h-16 items-end gap-px rounded-lg bg-slate-50 px-2">
              {intervals.map(row => (
                <span
                  key={row.index}
                  className={`flex-1 ${row.index === selected.index ? 'bg-emerald-900' : 'bg-emerald-300'}`}
                  style={{ height: `${(row.forecastKwh / scale) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-slate-500"><span>00:00</span><span>12:00</span><span>24:00</span></div>
          </section>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-bold text-emerald-800">Visa alla intervall och välj anläggningsfördelning</summary>
            <div className="mt-2 max-h-80 overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Portfölj per intervall i svensk lokal tid</caption>
              <thead className="sticky top-0 bg-slate-50 text-right">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left">Tid</th>
                  {['Prognos', 'Planerad volym', 'Inköpt', 'Kvar att täcka', 'Uppmätt', 'Prognosavvikelse'].map(label =>
                    <th key={label} scope="col" className="px-3 py-2">{label}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {intervals.map(row => (
                  <tr key={row.index} className={row.index === selected.index ? 'bg-emerald-50' : undefined}>
                    <th scope="row" className="px-3 py-2 text-left">
                      <Link className="text-emerald-800 underline" aria-label={`Visa anläggningar för ${row.time}`} href={`?${query.toString()}&interval=${row.index}#anlaggningar`}>{row.time}</Link>
                    </th>
                    <EnergyCell value={row.forecastKwh} hours={hours} />
                    <EnergyCell value={row.plannedKwh} hours={hours} />
                    <EnergyCell value={row.purchasedKwh} hours={hours} />
                    <EnergyCell value={row.remainingKwh} hours={hours} />
                    <EnergyCell value={row.actualKwh} hours={hours} />
                    <EnergyCell value={row.deviationKwh} hours={hours} />
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>

          <h2 id="anlaggningar" className="mt-6 font-black">Anläggningar kl. {selected.time}</h2>
          <div className="mt-2 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-right">
                <tr>{['Kund', 'Anläggning', 'Prognos', 'Planerad volym', 'Uppmätt'].map((label, index) =>
                  <th key={label} scope="col" className={`px-3 py-2 ${index < 2 ? 'text-left' : ''}`}>{label}</th>
                )}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selected.contributions.map(row => (
                  <tr key={row.site}>
                    <th scope="row" className="px-3 py-2 text-left">{row.customer}</th>
                    <td className="px-3 py-2">{row.site}</td>
                    <EnergyCell value={row.forecastKwh} hours={hours} />
                    <EnergyCell value={row.plannedKwh} hours={hours} />
                    <EnergyCell value={row.actualKwh} hours={hours} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-black">Genomgång i OPS</h2>
          <p className="mt-1 text-sm text-slate-600">Genvägar till ordinarie arbetsytor. Kundflödena kräver att demokunder och startlägen har förberetts i miljön.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scenarios.map(([customer, title, href, label]) => (
              <article key={title} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{customer}</p>
                <h3 className="mt-1 font-black">{title}</h3>
                <Link href={href} className="mt-3 inline-block text-sm font-bold text-emerald-800 underline">{label}</Link>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
