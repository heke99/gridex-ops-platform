import { getCustomerPortalContext, listPortalMeteringPoints, listPortalSites } from '@/lib/customer-portal/db'

export const dynamic = 'force-dynamic'

export default async function PortalSitesPage() {
  const context = await getCustomerPortalContext()
  const sites = await listPortalSites(context)
  const meteringPoints = await listPortalMeteringPoints(sites.map((site) => site.id))
  const pointsBySite = new Map<string, typeof meteringPoints>()

  for (const point of meteringPoints) {
    if (!point.site_id) continue
    const list = pointsBySite.get(point.site_id) ?? []
    list.push(point)
    pointsBySite.set(point.site_id, list)
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Mina anläggningar</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Här visas de anläggningar och mätpunkter som är kopplade till ditt kundkonto.
        </p>
      </section>

      <section className="space-y-4">
        {sites.map((site) => {
          const points = pointsBySite.get(site.id) ?? []
          return (
            <article key={site.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{site.site_name ?? site.facility_id ?? site.id}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {[site.street, site.postal_code, site.city].filter(Boolean).join(', ') || 'Ingen adress angiven'}
                  </p>
                </div>

                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                  {site.status ?? 'okänd status'}
                </span>
              </div>

              <div className="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                <div>Prisområde: <strong>{site.price_area_code ?? '—'}</strong></div>
                <div>Anläggnings-ID: <strong>{site.facility_id ?? '—'}</strong></div>
                <div>Årsförbrukning: <strong>{site.annual_consumption_kwh ?? '—'} kWh</strong></div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-950">Mätpunkter</div>
                <div className="mt-3 space-y-2">
                  {points.map((point) => (
                    <div key={point.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <div className="font-medium text-slate-950">{point.meter_point_id ?? point.id}</div>
                      <div className="mt-1 text-xs text-slate-500">Status {point.status ?? '—'} · Prisområde {point.price_area_code ?? '—'}</div>
                    </div>
                  ))}

                  {points.length === 0 ? (
                    <div className="text-sm text-slate-500">Inga mätpunkter är kopplade ännu.</div>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}

        {sites.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
            Inga anläggningar är kopplade till ditt konto ännu.
          </div>
        ) : null}
      </section>
    </div>
  )
}
