import { formatAdminDate } from '@/lib/ui/format'
import type { CustomerSiteRow, GridOwnerRow, MeteringPointRow } from '@/lib/masterdata/types'

type Props = {
  companyId: string | null
  customerId: string
  primarySiteId: string | null
  focusedSiteId?: string | null
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  gridOwners: GridOwnerRow[]
}
const STATUS: Record<string, string> = { draft: 'Under registrering', active: 'Aktiv', pending_move: 'Inflytt planerad', pending_validation: 'Behöver kontrolleras', inactive: 'Inaktiv', closed: 'Avslutad' }
const TYPE: Record<string, string> = { consumption: 'Förbrukning', production: 'Produktion', mixed: 'Förbrukning och produktion' }
function Status({ value }: { value: string }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${value === 'active' ? 'bg-emerald-100 text-emerald-800' : ['inactive', 'closed'].includes(value) ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-900'}`}>{STATUS[value] ?? 'Status behöver kontrolleras'}</span>
}
function Field({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-slate-600">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-950">{value}</dd></div>
}

/** Server view: accepts only records in the current customer's company/site graph. */
export default function CustomerSitesBusinessView({ companyId, customerId, primarySiteId, focusedSiteId, sites, meteringPoints, gridOwners }: Props) {
  if (!companyId) return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Anläggningsuppgifter kunde inte visas för valt bolag.</p>
  const ownSites = sites.filter(site => site.company_id === companyId && site.customer_id === customerId)
  const ownerName = (id: string | null) => id ? gridOwners.find(owner => owner.id === id)?.name || 'Nätägaruppgifter saknas' : 'Inte angiven'
  if (ownSites.length === 0) return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Inga anläggningar registrerade för kunden.</p>
  return <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-950">Kundens anläggningar ({ownSites.length})</h2>
    <p className="mt-1 text-sm text-slate-600">Adresser, flyttdatum, nätägare och mätpunkter.</p>
    <div role="region" aria-label="Kundens anläggningar" tabIndex={0} className="mt-4 max-h-[40rem] space-y-3 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
      {ownSites.map((site, siteIndex) => {
        const points = meteringPoints.filter(point => point.company_id === companyId && point.site_id === site.id && (!point.customer_site_id || point.customer_site_id === site.id) && (!point.customer_id || point.customer_id === customerId))
        const pointOwnerIds = [...new Set(points.map(point => point.grid_owner_id).filter((id): id is string => Boolean(id)))]
        const siteOwnerId = site.grid_owner_id ?? (pointOwnerIds.length === 1 ? pointOwnerIds[0] : null)
        const ownerMismatch = Boolean(site.grid_owner_id && pointOwnerIds.some(id => id !== site.grid_owner_id)) || (!site.grid_owner_id && pointOwnerIds.length > 1)
        const address = [site.street, site.postal_code, site.city].filter(Boolean).join(', ')
        const focused = site.id === focusedSiteId
        return <article key={site.id} id={focused ? 'vald-anlaggning' : undefined} tabIndex={focused ? -1 : undefined} className="min-w-0 scroll-mt-4 break-words rounded-xl border border-slate-200 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-950">{site.site_name || address || 'Anläggning'}</h3>
              <p className="mt-1 text-sm text-slate-700">{site.facility_id ? `Anläggning ${site.facility_id}` : 'Anläggningsnummer saknas'}</p>
              {address ? <p className="mt-1 text-sm text-slate-600">{address}</p> : null}
              <p className="mt-1 text-xs text-slate-600">{TYPE[site.site_type] ?? 'Anläggningstyp behöver kontrolleras'}{site.id === primarySiteId ? ' · Visas i översikten' : ''}</p>
            </div>
            <Status value={site.status} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Field label="Inflytt" value={formatAdminDate(site.move_in_date, 'Inte angiven')} />
            <Field label="Utflytt" value={formatAdminDate(site.move_out_date, 'Inte angiven')} />
            <Field label="Nätägare" value={ownerName(siteOwnerId)} />
            <Field label="Elområde" value={site.price_area_code || 'Inte angivet'} />
            {site.current_supplier_name ? <Field label="Nuvarande leverantör" value={site.current_supplier_name} /> : null}
            {site.current_supplier_contract_end_date ? <Field label="Nuvarande avtal löper till" value={formatAdminDate(site.current_supplier_contract_end_date)} /> : null}
          </dl>
          {ownerMismatch ? <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Nätägaren skiljer sig mellan anläggningen och mätpunkterna. Kontrollera uppgifterna.</p> : null}
          <h4 className="mt-4 text-sm font-semibold text-slate-900">Mätpunkter ({points.length})</h4>
          {points.length === 0 ? <p className="mt-1 text-sm text-slate-600">Inga mätpunkter registrerade för anläggningen.</p> : <div role="region" aria-label={`Mätpunkter för anläggning ${siteIndex + 1}: ${site.site_name || site.facility_id || 'utan namn'}`} tabIndex={0} className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
            {points.map(point => <div key={point.id} className="min-w-0 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-sm font-semibold text-slate-900">{point.meter_point_id || 'Mätpunktsnummer saknas'}</p><Status value={point.status} /></div>
              <p className="mt-1 text-xs text-slate-600">{ownerName(point.grid_owner_id ?? siteOwnerId)} · {point.price_area_code || site.price_area_code || 'Elområde saknas'} · {TYPE[point.measurement_type] ?? 'Mätningstyp behöver kontrolleras'}</p>
              {point.start_date || point.end_date ? <p className="mt-1 text-xs text-slate-600">Från {formatAdminDate(point.start_date, 'inte angivet')} · Till {formatAdminDate(point.end_date, 'inte angivet')}</p> : null}
            </div>)}
          </div>}
        </article>
      })}
    </div>
  </section>
}
