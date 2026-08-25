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

 <div className="space-y-6 p-8">
 <MeteringFilterBar query={query} />
 <MeteringOperationalSummary requests={requests} values={values} />

 <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px]">
 <MeteringRequestsSection requests={requests} />
 <MeteringIngestForm />
 </section>

 <MeteringValuesTable values={values} />
 </div>
 </div>
 )
}
