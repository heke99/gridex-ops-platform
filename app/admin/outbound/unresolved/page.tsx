import Link from 'next/link'
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
import { updateOutboundRequestStatusAction } from '@/app/admin/cis/actions'
import {
  assignRouteToUnresolvedOutboundAction,
  rerunAllUnresolvedRouteResolutionsAction,
  rerunUnresolvedRouteResolutionAction,
} from './actions'
import type {
  CommunicationRouteRow,
  GridOwnerDataRequestRow,
  OutboundRequestRow,
} from '@/lib/cis/types'
import type {
  CustomerSiteRow,
  MeteringPointRow,
} from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'

export const dynamic = 'force-dynamic'

type ResolutionSummary = {
  reasonTitle: string
  reasonText: string
  recommendation: string
  routeMatches: CommunicationRouteRow[]
  inactiveRouteMatches: CommunicationRouteRow[]
  globalActiveRoute: CommunicationRouteRow | null
  scopedActiveRoute: CommunicationRouteRow | null
  assignableRoutes: CommunicationRouteRow[]
}

function tone(status: string): string {
  if (['acknowledged', 'ready', 'resolved', 'active'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }
  if (['failed', 'cancelled', 'unresolved', 'missing_route', 'inactive'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }
  if (['sent', 'submitted'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }
  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function siteLabel(siteId: string | null, sites: CustomerSiteRow[]): string {
  if (!siteId) return '—'
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

function meteringPointLabel(
  meteringPointId: string | null,
  meteringPoints: MeteringPointRow[]
): string {
  if (!meteringPointId) return '—'
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    meteringPointId
  )
}

function requestScopeLabel(requestType: OutboundRequestRow['request_type']): string {
  if (requestType === 'supplier_switch') return 'supplier_switch'
  if (requestType === 'meter_values') return 'meter_values'
  return 'billing_underlay'
}

function buildResolutionSummary(params: {
  request: OutboundRequestRow
  routes: CommunicationRouteRow[]
}): ResolutionSummary {
  const { request, routes } = params
  const scope = requestScopeLabel(request.request_type)

  const routeMatches = routes.filter((route) => route.route_scope === scope)
  const assignableRoutes = routeMatches.filter((route) => route.is_active)
  const scopedActiveRoute =
    routeMatches.find(
      (route) => route.is_active && route.grid_owner_id === request.grid_owner_id
    ) ?? null
  const globalActiveRoute =
    routeMatches.find(
      (route) => route.is_active && route.grid_owner_id === null
    ) ?? null
  const inactiveRouteMatches = routeMatches.filter(
    (route) =>
      !route.is_active &&
      (route.grid_owner_id === request.grid_owner_id || route.grid_owner_id === null)
  )

  if (!request.grid_owner_id && !globalActiveRoute && inactiveRouteMatches.length === 0) {
    return {
      reasonTitle: 'Saknar grid owner + ingen global route',
      reasonText:
        'Requesten saknar grid_owner_id och systemet hittar inte heller någon global aktiv route för detta scope.',
      recommendation:
        'Gå till kund/site eller källdata och säkra grid owner. Alternativt skapa en global route om processen ska gå utan nätägarspecifik routning.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (!request.grid_owner_id && inactiveRouteMatches.length > 0 && !globalActiveRoute) {
    return {
      reasonTitle: 'Global route finns men är inaktiv',
      reasonText:
        'Systemet hittar routes för detta scope, men ingen aktiv global route som kan användas när grid_owner_id saknas.',
      recommendation:
        'Aktivera global route i communication routes eller komplettera requesten med korrekt grid owner.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (
    request.grid_owner_id &&
    !scopedActiveRoute &&
    inactiveRouteMatches.some((route) => route.grid_owner_id === request.grid_owner_id)
  ) {
    return {
      reasonTitle: 'Nätägarspecifik route finns men är inaktiv',
      reasonText:
        'Det finns en route för rätt grid owner och scope, men den är inte aktiv och kan därför inte väljas.',
      recommendation:
        'Öppna communication routes och aktivera den specifika routen eller skapa en aktiv ersättare.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (routeMatches.length === 0) {
    return {
      reasonTitle: 'Ingen route konfigurerad för scopet',
      reasonText:
        'Systemet hittar inga communication routes alls för den här requesttypen.',
      recommendation:
        'Skapa en ny communication route för detta scope innan requesten kan lämna unresolved.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  if (!scopedActiveRoute && !globalActiveRoute) {
    return {
      reasonTitle: 'Ingen aktiv route matchar requesten',
      reasonText:
        'Det finns routes för scopet, men ingen aktiv route matchar grid owner eller global fallback.',
      recommendation:
        'Skapa eller aktivera en aktiv route för rätt grid owner, eller lägg upp en global fallback-route om det är tillåtet.',
      routeMatches,
      inactiveRouteMatches,
      globalActiveRoute,
      scopedActiveRoute,
      assignableRoutes,
    }
  }

  return {
    reasonTitle: 'Route bör gå att lösa om',
    reasonText:
      'Det finns minst en möjlig route. Kör ny route-upplösning eller välj route manuellt för att få requesten ur unresolved.',
    recommendation:
      'Använd “Välj route nu” nedan om du redan vet vilken route som ska användas. Annars klicka på “Kör route-upplösning igen”.',
    routeMatches,
    inactiveRouteMatches,
    globalActiveRoute,
    scopedActiveRoute,
    assignableRoutes,
  }
}

function getPrimaryLink(params: {
  request: OutboundRequestRow
  switchRequests: SupplierSwitchRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
}): { href: string; label: string } {
  const { request, switchRequests, dataRequests } = params

  if (
    request.request_type === 'supplier_switch' &&
    request.source_type === 'supplier_switch_request' &&
    request.source_id
  ) {
    const match = switchRequests.find((row) => row.id === request.source_id)
    if (match) {
      return {
        href: `/admin/operations/switches/${match.id}`,
        label: 'Öppna switch detail',
      }
    }
  }

  if (
    request.source_type === 'grid_owner_data_request' &&
    request.source_id &&
    dataRequests.some((row) => row.id === request.source_id)
  ) {
    return {
      href:
        request.request_type === 'meter_values'
          ? '/admin/metering'
          : '/admin/billing',
      label:
        request.request_type === 'meter_values'
          ? 'Öppna metering'
          : 'Öppna billing',
    }
  }

  return {
    href: `/admin/customers/${request.customer_id}`,
    label: 'Öppna kundkort',
  }
}

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
        <section className="grid gap-4 xl:grid-cols-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Öppna unresolved
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {requests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Totala undantag i dispatch-kedjan.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Switch-relaterade
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {switchRelatedCount}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Leverantörsbyten som fastnat före dispatch.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Meter / billing
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {meteringRelatedCount + billingRelatedCount}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Data requests för mätvärden och billing-underlag.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Saknar grid owner
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {requestsMissingGridOwner}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Requestdata som inte räcker för nätägarspecifik routing.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Inaktiva route-träffar
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {requestsWithInactiveRouteMatch}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Route finns, men är inte aktiv just nu.
            </div>
          </div>

          <div className="rounded-3xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm dark:border-blue-900/50 dark:bg-blue-950/10">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Manuellt valbar route
            </div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {requestsWithManualChoiceAvailable}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Requests där du kan välja aktiv route direkt från denna sida.
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Snabbåtgärder
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Använd detta när du vill försöka lösa hela unresolved-kön eller gå direkt till rätt arbetsyta.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <form action={rerunAllUnresolvedRouteResolutionsAction}>
                <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                  Kör route-upplösning för alla
                </button>
              </form>

              <Link
                href="/admin/integrations/routes"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Öppna communication routes
              </Link>

              <Link
                href="/admin/outbound"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Öppna outbound queue
              </Link>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Unresolved requests
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Här ser du exakt varför en request är unresolved, vilka routes som finns och vilken sida du bör öppna härnäst.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {requests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga unresolved requests just nu.
              </div>
            ) : (
              requests.map((request) => {
                const summary = buildResolutionSummary({ request, routes })
                const primaryLink = getPrimaryLink({
                  request,
                  switchRequests,
                  dataRequests,
                })
                const relatedDataRequest =
                  request.source_type === 'grid_owner_data_request' && request.source_id
                    ? dataRequests.find((row) => row.id === request.source_id) ?? null
                    : null
                const relatedSwitchRequest =
                  request.source_type === 'supplier_switch_request' && request.source_id
                    ? switchRequests.find((row) => row.id === request.source_id) ?? null
                    : null

                return (
                  <article
                    key={request.id}
                    className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone('unresolved')}`}>
                        unresolved
                      </span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(request.status)}`}>
                        {request.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {request.request_type}
                      </span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {request.source_type ?? 'manual'}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-base font-semibold text-slate-950 dark:text-white">
                            Outbound request {request.id}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            Skapad {formatDateTime(request.created_at)} · Senast uppdaterad {formatDateTime(request.updated_at)}
                          </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Kund</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.customer_id}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Anläggning</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {siteLabel(request.site_id, sites)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {meteringPointLabel(request.metering_point_id, meteringPoints)}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Nätägare</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.grid_owner_id ?? 'saknas'}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">
                              Varför fastnar den?
                            </div>
                            <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                              {summary.reasonTitle}
                            </div>
                            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                              {summary.reasonText}
                            </p>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                              {summary.recommendation}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">
                              Route-bild
                            </div>
                            <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                              <div>
                                Aktiv scoped route:{' '}
                                <span className="font-medium">
                                  {summary.scopedActiveRoute?.route_name ?? 'ingen'}
                                </span>
                              </div>
                              <div>
                                Aktiv global route:{' '}
                                <span className="font-medium">
                                  {summary.globalActiveRoute?.route_name ?? 'ingen'}
                                </span>
                              </div>
                              <div>
                                Inaktiva matchningar:{' '}
                                <span className="font-medium">
                                  {summary.inactiveRouteMatches.length}
                                </span>
                              </div>
                              <div>
                                Scope-träffar totalt:{' '}
                                <span className="font-medium">{summary.routeMatches.length}</span>
                              </div>
                              <div>
                                Manuellt valbara routes:{' '}
                                <span className="font-medium">
                                  {summary.assignableRoutes.length}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            Källkontext
                          </div>
                          <div className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                            <div>
                              Source type:{' '}
                              <span className="font-medium">
                                {request.source_type ?? 'manual'}
                              </span>
                            </div>
                            <div>
                              Source id:{' '}
                              <span className="font-medium">
                                {request.source_id ?? '—'}
                              </span>
                            </div>
                            <div>
                              Period:{' '}
                              <span className="font-medium">
                                {request.period_start ?? '—'} → {request.period_end ?? '—'}
                              </span>
                            </div>
                            <div>
                              Batch key:{' '}
                              <span className="font-medium">
                                {request.dispatch_batch_key ?? '—'}
                              </span>
                            </div>
                            {relatedSwitchRequest ? (
                              <div>
                                Switchstatus:{' '}
                                <span className="font-medium">
                                  {relatedSwitchRequest.status}
                                </span>
                              </div>
                            ) : null}
                            {relatedDataRequest ? (
                              <div>
                                Data request-status:{' '}
                                <span className="font-medium">
                                  {relatedDataRequest.status}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/10">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            Välj route nu
                          </div>
                          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                            Om du redan vet vilken route som ska användas kan du koppla den direkt härifrån utan att lämna unresolved-sidan.
                          </p>

                          {summary.assignableRoutes.length === 0 ? (
                            <div className="mt-3 rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              Inga aktiva routes att välja för detta scope ännu.
                            </div>
                          ) : (
                            <form
                              action={assignRouteToUnresolvedOutboundAction}
                              className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
                            >
                              <input type="hidden" name="outbound_request_id" value={request.id} />
                              <input type="hidden" name="customer_id" value={request.customer_id} />

                              <select
                                name="communication_route_id"
                                required
                                defaultValue=""
                                className="h-11 rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                              >
                                <option value="" disabled>
                                  Välj aktiv route
                                </option>
                                {summary.assignableRoutes.map((route) => (
                                  <option key={route.id} value={route.id}>
                                    {route.route_name} • {route.route_type} •{' '}
                                    {route.grid_owner_id ?? 'global'}
                                  </option>
                                ))}
                              </select>

                              <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                                Sätt route och fortsätt
                              </button>
                            </form>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <form action={rerunUnresolvedRouteResolutionAction}>
                            <input type="hidden" name="outbound_request_id" value={request.id} />
                            <input type="hidden" name="customer_id" value={request.customer_id} />
                            <button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                              Kör route-upplösning igen
                            </button>
                          </form>

                          <Link
                            href={primaryLink.href}
                            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            {primaryLink.label}
                          </Link>

                          <Link
                            href="/admin/integrations/routes"
                            className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                          >
                            Communication routes
                          </Link>

                          <form action={updateOutboundRequestStatusAction}>
                            <input type="hidden" name="outbound_request_id" value={request.id} />
                            <input type="hidden" name="customer_id" value={request.customer_id} />
                            <input type="hidden" name="status" value="cancelled" />
                            <input
                              type="hidden"
                              name="response_payload_note"
                              value="Manuellt avbruten från unresolved-sidan."
                            />
                            <button className="rounded-2xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 dark:border-rose-800 dark:text-rose-300">
                              Avbryt request
                            </button>
                          </form>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            Vilken sida ska du öppna?
                          </div>
                          <div className="mt-3 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                            <div>
                              <div className="font-medium text-slate-900 dark:text-white">
                                1. {primaryLink.label}
                              </div>
                              <p className="mt-1">
                                Öppna den sida som bäst representerar källärendet bakom outbound-requesten.
                              </p>
                            </div>
                            <div>
                              <div className="font-medium text-slate-900 dark:text-white">
                                2. Communication routes
                              </div>
                              <p className="mt-1">
                                Gå hit om route saknas, är inaktiv eller måste läggas upp per nätägare eller som global fallback.
                              </p>
                            </div>
                            <div>
                              <div className="font-medium text-slate-900 dark:text-white">
                                3. Outbound queue
                              </div>
                              <p className="mt-1">
                                När route är löst går du tillbaka hit eller till outbound queue för att följa dispatchen vidare.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">
                            Matchande routes
                          </div>
                          <div className="mt-3 space-y-3">
                            {summary.routeMatches.length === 0 ? (
                              <div className="rounded-2xl bg-rose-50 px-3 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                                Inga routes finns alls för scope {request.request_type}.
                              </div>
                            ) : (
                              summary.routeMatches.slice(0, 8).map((route) => {
                                const isDirectMatch =
                                  route.is_active &&
                                  (route.grid_owner_id === request.grid_owner_id ||
                                    route.grid_owner_id === null)

                                return (
                                  <div
                                    key={route.id}
                                    className="rounded-2xl border border-slate-200 p-3 text-sm dark:border-slate-800"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`rounded-full px-3 py-1 text-xs font-semibold ${tone(
                                          route.is_active ? 'active' : 'inactive'
                                        )}`}
                                      >
                                        {route.is_active ? 'active' : 'inactive'}
                                      </span>
                                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                        {route.route_type}
                                      </span>
                                      {isDirectMatch ? (
                                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                                          valbar nu
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-2 font-medium text-slate-900 dark:text-white">
                                      {route.route_name}
                                    </div>
                                    <div className="mt-1 text-slate-600 dark:text-slate-300">
                                      Grid owner: {route.grid_owner_id ?? 'global'} · Target:{' '}
                                      {route.target_system}
                                    </div>
                                  </div>
                                )
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}