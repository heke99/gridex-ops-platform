// app/admin/billing/page.tsx
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import {
 listAllBillingUnderlays,
 listAllGridOwnerDataRequests,
 listAllPartnerExports,
 listAllMeteringValues,
} from '@/lib/cis/db'
import {
 BillingFilterBar,
 BillingIngestForm,
 BillingRequestsSection,
 BillingUnderlaysSection,
 BillingExportsSection,
 BillingReadinessExportPanel,
} from './_components'
import { buildBillingReadinessMap } from '@/lib/cis/billingReadiness'

export const dynamic = 'force-dynamic'

type PageProps = {
 searchParams: Promise<{
 status?: string
 q?: string
 }>
}

export default async function AdminBillingPage({ searchParams }: PageProps) {
 await requirePermissionServer('billing_underlay.read')

 const params = await searchParams
 const status = (params.status ?? 'all').trim()
 const query = (params.q ?? '').trim()

 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()
 const companyScope = user ? await getOperationalCompanyScope(user.id) : null
 const companyId = companyScope?.companyId ?? null

 const [underlays, requests, exports, values] = await Promise.all([
 listAllBillingUnderlays({
 status,
 query,
 companyId,
 }),
 listAllGridOwnerDataRequests({
 status: 'all',
 scope: 'billing_underlay',
 query,
 companyId,
 }),
 listAllPartnerExports({
 status: 'all',
 exportKind: 'billing_underlay',
 query,
 companyId,
 }),
 listAllMeteringValues({
 query,
 companyId,
 }),
 ])

 const requestById = new Map(requests.map((request) => [request.id, request] as const))
 const underlayById = new Map(underlays.map((underlay) => [underlay.id, underlay] as const))
 const readinessByUnderlayId = buildBillingReadinessMap({
 underlays,
 meterValues: values,
 partnerExports: exports,
 })

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Billing"
 subtitle="Billing underlag från nätägare, ingest och partnerexportflöde."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <BillingFilterBar query={query} status={status} />

 <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_420px]">
 <div className="space-y-6">
 <BillingRequestsSection requests={requests} />
 <BillingUnderlaysSection
 underlays={underlays}
 requestById={requestById}
 readinessByUnderlayId={readinessByUnderlayId}
 />
 <BillingExportsSection
 exports={exports}
 requestById={requestById}
 underlayById={underlayById}
 />
 </div>

 <div className="space-y-6">
 <BillingReadinessExportPanel />
 <BillingIngestForm />
 </div>
 </section>
 </div>
 </div>
 )
}