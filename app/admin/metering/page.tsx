import AdminDisclosurePanel from "@/components/admin/ui/AdminDisclosurePanel"
// app/admin/metering/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
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

 const companyScope = await getOperationalCompanyScope(context.userId)
 const companyId = companyScope.companyId

 const [requests, values] = await Promise.all([
 listAllGridOwnerDataRequests({
 status: 'all',
 scope: 'meter_values',
 query,
 companyId,
 }),
 listAllMeteringValues({
 query,
 companyId,
 }),
 ])

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
 <MeteringRequestsSection requests={requests} />
 <AdminDisclosurePanel id="metering-register-value" title="Registrera mätvärde manuellt" className="rounded-2xl border border-slate-200 bg-white p-4"><MeteringIngestForm /></AdminDisclosurePanel>
 </section>

 <MeteringValuesTable values={values} />
 </div>
 </div>
 )
}
