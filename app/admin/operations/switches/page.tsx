import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import {
  listAllSupplierSwitchRequests,
  listPowersOfAttorneyByCustomerId,
  listSupplierSwitchEventsByRequestIds,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { listOutboundRequests } from '@/lib/cis/db'
import {
  getSwitchLifecycle,
  summarizeReadinessIssues,
} from '@/lib/operations/controlTower'
import { updateSupplierSwitchStatusFromAdminAction } from '@/app/admin/operations/actions'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

type SwitchesPageProps = {
  searchParams: Promise<{
    status?: string
    requestType?: string
    q?: string
  }>
}

export const dynamic = 'force-dynamic'

function statusStyle(status: string): string {
  if (['completed', 'accepted', 'done', 'acknowledged'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'blocked', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function latestEventText(
  requestId: string,
  events: Array<{
    switch_request_id: string
    message: string | null
    event_type: string
    event_status: string
  }>
): string {
  const latest = events.find((event) => event.switch_request_id === requestId)
  if (!latest) return 'Inga events ännu'
  return latest.message ?? `${latest.event_type} — ${latest.event_status}`
}

export default async function AdminOperationsSwitchesPage({
  searchParams,
}: SwitchesPageProps) {
  await requirePermissionServer('masterdata.read')

  const resolvedSearchParams = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const status = (resolvedSearchParams.status ?? 'all').trim()
  const requestType = (resolvedSearchParams.requestType ?? 'all').trim()
  const query = (resolvedSearchParams.q ?? '').trim()

  const requests = await listAllSupplierSwitchRequests(supabase, {
    status,
    requestType,
    query,
  })

  const siteIds = Array.from(new Set(requests.map((request) => request.site_id)))

  let sites: CustomerSiteRow[] = []
  if (siteIds.length > 0) {
    const sitesQuery = await supabase
      .from('customer_sites')
      .select('*')
      .in('id', siteIds)

    if (sitesQuery.error) throw sitesQuery.error
    sites = (sitesQuery.data ?? []) as CustomerSiteRow[]
  }

  const [events, outboundRequests, meteringPoints] = await Promise.all([
    listSupplierSwitchEventsByRequestIds(
      supabase,
      requests.map((request) => request.id)
    ),
    listOutboundRequests({
      status: 'all',
      requestType: 'supplier_switch',
      channelType: 'all',
      query: '',
    }),
    listMeteringPointsBySiteIds(supabase, siteIds),
  ])

  const readinessMap = new Map<
    string,
    ReturnType<typeof evaluateSiteSwitchReadiness>
  >()

  for (const site of sites) {
    const powersOfAttorney = await listPowersOfAttorneyByCustomerId(
      supabase,
      site.customer_id
    )

    const readiness = evaluateSiteSwitchReadiness({
      site,
      meteringPoints: meteringPoints.filter(
        (point) => point.site_id === site.id
      ),
      powersOfAttorney,
    })

    readinessMap.set(site.id, readiness)
  }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Switchar"
        subtitle="Hantera leverantörsbyten, blockers, outboundkoppling och statuskedjor."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på kund, site, mätpunkt, leverantör eller referens"
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />

            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="all">Alla statusar</option>
              <option value="draft">Draft</option>
              <option value="queued">Queued</option>
              <option value="submitted">Submitted</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>

            <select
              name="requestType"
              defaultValue={requestType}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="all">Alla typer</option>
              <option value="switch">Switch</option>
              <option value="move_in">Move in</option>
              <option value="move_out_takeover">Move out takeover</option>
            </select>

            <div className="flex gap-3">
              <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                Filtrera
              </button>
              <Link
                href="/admin/operations/switches"
                className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Rensa
              </Link>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Switchlista
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {requests.length} träffar.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {requests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga switchärenden matchade filtret.
              </div>
            ) : (
              requests.map((request) => {
                const readiness = readinessMap.get(request.site_id) ?? null
                const outbound = outboundRequests.find(
                  (row) =>
                    row.source_type === 'supplier_switch_request' &&
                    row.source_id === request.id
                )

                const lifecycle = getSwitchLifecycle({
                  request,
                  readiness,
                  outboundRequest: outbound ?? null,
                })

                return (
                  <article
                    key={request.id}
                    className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                  >
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                              request.status
                            )}`}
                          >
                            {request.status}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {request.request_type}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                              lifecycle.stage
                            )}`}
                          >
                            {lifecycle.label}
                          </span>
                        </div>

                        <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">
                          Switchärende {request.id}
                        </h3>

                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">
                              Kund
                            </div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.customer_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">
                              Site
                            </div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.site_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">
                              Mätpunkt
                            </div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.metering_point_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">
                              Startdatum
                            </div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.requested_start_date ?? '—'}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                          <div>
                            Nuvarande leverantör:{' '}
                            <span className="font-medium">
                              {request.current_supplier_name ?? '—'}
                            </span>
                          </div>
                          <div>
                            Inkommande leverantör:{' '}
                            <span className="font-medium">
                              {request.incoming_supplier_name}
                            </span>
                          </div>
                          <div>
                            Extern referens:{' '}
                            <span className="font-medium">
                              {request.external_reference ?? '—'}
                            </span>
                          </div>
                          <div>
                            Senaste event:{' '}
                            <span className="font-medium">
                              {latestEventText(request.id, events)}
                            </span>
                          </div>
                          <div>
                            Lifecycle:{' '}
                            <span className="font-medium">{lifecycle.reason}</span>
                          </div>
                          <div>
                            Outbound status:{' '}
                            <span className="font-medium">
                              {outbound?.status ?? 'Ingen outbound ännu'}
                            </span>
                          </div>
                          <div>
                            Outbound route:{' '}
                            <span className="font-medium">
                              {outbound?.communication_route_id ?? '—'}
                            </span>
                          </div>

                          {readiness && !readiness.isReady ? (
                            <div className="text-rose-700 dark:text-rose-300">
                              Blockers:{' '}
                              <span className="font-medium">
                                {summarizeReadinessIssues(readiness)}
                              </span>
                            </div>
                          ) : null}

                          {request.failure_reason ? (
                            <div className="text-rose-700 dark:text-rose-300">
                              Felorsak:{' '}
                              <span className="font-medium">
                                {request.failure_reason}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4">
                          <Link
                            href={`/admin/customers/${request.customer_id}`}
                            className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                          >
                            Öppna kundkort
                          </Link>
                        </div>
                      </div>

                      <div className="w-full rounded-3xl border border-slate-200 p-4 xl:max-w-sm dark:border-slate-800">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                          Uppdatera switchstatus
                        </h4>

                        <form
                          action={updateSupplierSwitchStatusFromAdminAction}
                          className="mt-4 space-y-3"
                        >
                          <input type="hidden" name="request_id" value={request.id} />

                          <select
                            name="status"
                            defaultValue={request.status}
                            className="h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          >
                            <option value="draft">Draft</option>
                            <option value="queued">Queued</option>
                            <option value="submitted">Submitted</option>
                            <option value="accepted">Accepted</option>
                            <option value="rejected">Rejected</option>
                            <option value="completed">Completed</option>
                            <option value="failed">Failed</option>
                          </select>

                          <input
                            name="external_reference"
                            defaultValue={request.external_reference ?? ''}
                            placeholder="Extern referens"
                            className="h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />

                          <textarea
                            name="failure_reason"
                            defaultValue={request.failure_reason ?? ''}
                            placeholder="Felorsak"
                            rows={4}
                            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />

                          <button className="w-full rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                            Spara status
                          </button>
                        </form>
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