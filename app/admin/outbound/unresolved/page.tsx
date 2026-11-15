import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import {
 listAllGridOwnerDataRequests,
 listCommunicationRoutes,
 listUnresolvedOutboundRequests,
} from '@/lib/cis/db'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import { buildResolutionSummary } from './helpers'
import UnresolvedSummaryCards from './UnresolvedSummaryCards'
import UnresolvedQuickActions from './UnresolvedQuickActions'
import UnresolvedRequestsList from './UnresolvedRequestsList'

export const dynamic = 'force-dynamic'

export default async function UnresolvedOutboundPage() {
 const context = await requireAdminPageKeyAccess('outbound.unresolved')
 const tenantScope = await resolveAdminTenantReadScope(context)
 const companyId = tenantScope.companyId

 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()

 const requests = await listUnresolvedOutboundRequests({ companyId })
 const [routes, dataRequests, switchRequests] = await Promise.all([
 listCommunicationRoutes({ routeScope: 'all', routeType: 'all', query: '', companyId }),
 listAllGridOwnerDataRequests({ status: 'all', scope: 'all', query: '', companyId }),
 listAllSupplierSwitchRequests(supabase, {
 status: 'all',
 requestType: 'all',
 query: '',
 companyId,
 }),
 ])

 const siteIds = Array.from(
 new Set(
 requests.map((row) => row.site_id).filter((value): value is string => Boolean(value))
 )
 )

 let sites: CustomerSiteRow[] = []
 if (siteIds.length > 0) {
 let sitesQueryBuilder = supabase
 .from('customer_sites')
 .select('*')
 .in('id', siteIds)

 if (companyId) {
 sitesQueryBuilder = sitesQueryBuilder.eq('company_id', companyId)
 }

 const sitesQuery = await sitesQueryBuilder

 if (sitesQuery.error) throw sitesQuery.error
 sites = (sitesQuery.data ?? []) as CustomerSiteRow[]
 }

 const meteringPoints = await listMeteringPointsBySiteIds(supabase, siteIds, { companyId })

 const switchRelatedCount = requests.filter(
 (row) => row.request_type === 'supplier_switch'
 ).length
 const meteringRelatedCount = requests.filter(
 (row) => row.request_type === 'meter_values'
 ).length
 const billingRelatedCount = requests.filter(
 (row) => row.request_type === 'billing_underlay'
 ).length
 const requestsMissingGridOwner = requests.filter((row) => !row.grid_owner_id).length
 const requestsWithInactiveRouteMatch = requests.filter((row) => {
 const summary = buildResolutionSummary({ request: row, routes })
 return summary.inactiveRouteMatches.length > 0
 }).length
 const requestsWithManualChoiceAvailable = requests.filter((row) => {
 const summary = buildResolutionSummary({ request: row, routes })
 return summary.assignableRoutes.length > 0
 }).length

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Utskick som behöver åtgärdas"
 subtitle="Granska kunduppgifter och följ upp utskick som har stannat."
 userEmail={context.email}
 />

 <div className="space-y-4 p-4 sm:p-6">
 {tenantScope.isPlatformAdmin ? <UnresolvedSummaryCards
 requestsCount={requests.length}
 switchRelatedCount={switchRelatedCount}
 meteringAndBillingCount={meteringRelatedCount + billingRelatedCount}
 requestsMissingGridOwner={requestsMissingGridOwner}
 requestsWithInactiveRouteMatch={requestsWithInactiveRouteMatch}
 requestsWithManualChoiceAvailable={requestsWithManualChoiceAvailable}
 /> : <p className="text-sm text-slate-700">{requests.length} utskick behöver åtgärdas.</p>}

 {tenantScope.isPlatformAdmin ? <UnresolvedQuickActions /> : null}

 <UnresolvedRequestsList
 showTechnicalDetails={tenantScope.isPlatformAdmin}
 requests={requests}
 routes={routes}
 switchRequests={switchRequests}
 dataRequests={dataRequests}
 sites={sites}
 meteringPoints={meteringPoints}
 />
 </div>
 </div>
 )
}