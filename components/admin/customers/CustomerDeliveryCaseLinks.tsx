import Link from 'next/link'
import { formatSupplierSwitchDate, supplierSwitchRequestTypeLabel } from '@/components/admin/customers/SupplierSwitchBusinessView'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

type Props = {
  canReadSwitches: boolean
  companyId: string | null
  customerId: string
  sites: CustomerSiteRow[]
  requests: SupplierSwitchRequestRow[]
}

export default function CustomerDeliveryCaseLinks({ canReadSwitches, companyId, customerId, sites, requests }: Props) {
  if (!canReadSwitches || !companyId) return null
  const ownSites = new Map(sites.filter(site => site.company_id === companyId && site.customer_id === customerId)
    .map(site => [site.id, site]))
  const cases = requests.flatMap(request => {
    if (request.company_id !== companyId || request.customer_id !== customerId) return []
    const site = ownSites.get(request.site_id)
    return site ? [{ request, site }] : []
  })
  if (cases.length === 0) return null

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="kundens-leveransarenden">
    <h2 id="kundens-leveransarenden" className="text-base font-semibold text-slate-950">Kundens leveransärenden</h2>
    <ul className="mt-2 divide-y divide-slate-200">
      {cases.map(({ request, site }) => <li key={request.id} className="min-w-0 py-2">
        <Link className="inline-flex min-h-11 items-center break-words font-semibold text-emerald-800 underline" href={`/admin/operations/switches/${request.id}`}>
          {supplierSwitchRequestTypeLabel(request.request_type)} · {[site.site_name, site.facility_id].filter(Boolean).join(' · ') || 'Anläggning'}
        </Link>
        <p className="text-sm text-slate-700">Önskad leveransstart {formatSupplierSwitchDate(request.requested_start_date)}</p>
      </li>)}
    </ul>
  </section>
}
