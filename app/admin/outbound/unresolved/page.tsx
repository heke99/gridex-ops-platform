import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
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
  await requirePermissionServer('masterdata.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const requests = await listUnresolvedOutboundRequests()
  const [routes, dataRequests, switchRequests] = await Promise.all([
    listCommunicationRoutes({ routeScope: 'all', routeType: 'all', query: '' }),
    listAllGridOwnerDataRequests({ status: 'all', scope: 'all', query: '' }),
    listAllSupplierSwitchRequests(supabase, {
      status: 'all',
      requestType: 'all',
      query: '',
    }),
  ])

  const siteIds = Array.from(
    new Set(
      requests.map((row) => row.site_id).filter((value): value is string => Boolean(value))
    )
  )

  let sites: CustomerSiteRow[] = []
  if (siteIds.length > 0) {
    const sitesQuery = await supabase
      .from('customer_sites')
      .select('*')
      .in('id', siteIds)

    if (sitesQuery.error) throw sitesQuery.error
    sites = (sitesQuery.data ?? []) as CustomerSiteRow[]
  }

  const meteringPoints = await listMeteringPointsBySiteIds(supabase, siteIds)

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
        title="Outbound exceptions: unresolved"
        subtitle="Undantagskö för requests utan aktiv route. Här ser du varför något fastnat, vilken data eller route som saknas och vad nästa steg är."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <UnresolvedSummaryCards
          requestsCount={requests.length}
          switchRelatedCount={switchRelatedCount}
          meteringAndBillingCount={meteringRelatedCount + billingRelatedCount}
          requestsMissingGridOwner={requestsMissingGridOwner}
          requestsWithInactiveRouteMatch={requestsWithInactiveRouteMatch}
          requestsWithManualChoiceAvailable={requestsWithManualChoiceAvailable}
        />

        <UnresolvedQuickActions />

        <UnresolvedRequestsList
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