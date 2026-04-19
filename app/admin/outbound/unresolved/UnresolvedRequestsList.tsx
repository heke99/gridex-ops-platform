import Link from 'next/link'
import { updateOutboundRequestStatusAction } from '@/app/admin/cis/actions'
import {
  assignRouteToUnresolvedOutboundAction,
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
import {
  buildResolutionSummary,
  formatDateTime,
  getPrimaryLink,
  meteringPointLabel,
  siteLabel,
  tone,
} from './helpers'

export default function UnresolvedRequestsList({
  requests,
  routes,
  switchRequests,
  dataRequests,
  sites,
  meteringPoints,
}: {
  requests: OutboundRequestRow[]
  routes: CommunicationRouteRow[]
  switchRequests: SupplierSwitchRequestRow[]
  dataRequests: GridOwnerDataRequestRow[]
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
}) {
  return (
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
  )
}