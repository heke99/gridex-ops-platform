import { loadMeteringBusinessData, filterMeteringBusinessRows, readMeteringCustomerCardIds, METERING_REQUEST_ROW_LIMIT } from '@/lib/admin/meteringBusinessData'
import MeteringBusinessView from '@/components/admin/customers/MeteringBusinessView'
import { isPlatformAdminContext } from '@/lib/admin/guards'
import { canOpenCustomerDetail } from '@/lib/admin/accessModel'
import AdminDisclosurePanel from "@/components/admin/ui/AdminDisclosurePanel"
// app/admin/metering/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
import {
 listAllGridOwnerDataRequests,
 listAllMeteringValues,
} from '@/lib/cis/db'
import {
 MeteringFilterBar,
 MeteringIngestForm,
 MeteringOperationalSummary,
 MeteringRequestsSection,
 MeteringValuesTable,
} from './_components'

export const dynamic = 'force-dynamic'

type PageProps = {
 searchParams: Promise<{
 q?: string
 }>
}

export default async function AdminMeteringPage({ searchParams }: PageProps) {
 const [context, params] = await Promise.all([
 requirePermissionServer('metering.read'),
 searchParams,
 ])
 const query = (params.q ?? '').trim()
 const isPlatformAdmin = isPlatformAdminContext(context)

 const companyScope = await resolveAdminSelectedCompanyReadScope(context)
 const companyId = companyScope.companyId
 if (!companyId) return <main className="p-4"><h1 className="text-xl font-semibold">Mätvärden</h1><p className="mt-3 text-sm">Välj ett bolag innan mätvärden läses.</p></main>

 const [requests, values] = await Promise.all([
 listAllGridOwnerDataRequests({
 status: 'all',
 scope: 'meter_values',
 query: isPlatformAdmin ? query : '',
 companyId,
 }),
 listAllMeteringValues({
 query: isPlatformAdmin ? query : '',
 companyId,
 }),
 ])

 if (!isPlatformAdmin) {
   const businessData = await loadMeteringBusinessData(companyId, requests, values, {
     includeCustomerCardTargets: canOpenCustomerDetail(context.permissions),
   })
   return <div className="min-h-screen"><AdminHeader title="Mätvärden" subtitle="Förbrukning, rättelser och begärda uppgifter från nätägaren." userEmail={context.email} /><MeteringBusinessView requests={filterMeteringBusinessRows(requests, businessData, query)} values={filterMeteringBusinessRows(values, businessData, query)} query={query} businessData={businessData} /></div>
 }

 const customerCardIds = await readMeteringCustomerCardIds(companyId, requests.slice(0, METERING_REQUEST_ROW_LIMIT).map(row => row.customer_id))

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Mätvärden"
 subtitle="Driftvy för mätvärdesbegäran, UTILTS-import, kvalitet och koppling till rätt anläggning, nätägare och kund."
 userEmail={context.email}
 />

 <div className="min-w-0 space-y-4 p-4 lg:p-6">
 <MeteringFilterBar query={query} />
 <MeteringOperationalSummary requests={requests} values={values} />

 <section className="space-y-4">
 <MeteringRequestsSection requests={requests} customerCardIds={customerCardIds} />
 <AdminDisclosurePanel id="metering-register-value" title="Registrera mätvärde manuellt" className="rounded-2xl border border-slate-200 bg-white p-4"><MeteringIngestForm /></AdminDisclosurePanel>
 </section>

 <MeteringValuesTable values={values} />
 </div>
 </div>
 )
}
