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
import {
  finalizeSupplierSwitchExecutionAction,
  updateSupplierSwitchStatusFromAdminAction,
  validateSupplierSwitchBeforeProcessingAction,
} from '@/app/admin/operations/actions'
import { queueSupplierSwitchOutboundAction } from '@/app/admin/cis/actions'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

type SwitchesPageProps = {
  searchParams: Promise<{
    status?: string
    requestType?: string
    stage?: string
    q?: string
  }>
}

type SwitchRow = {
  request: Awaited<ReturnType<typeof listAllSupplierSwitchRequests>>[number]
  readiness: ReturnType<typeof evaluateSiteSwitchReadiness> | null
  outbound: Awaited<ReturnType<typeof listOutboundRequests>>[number] | null
  lifecycle: ReturnType<typeof getSwitchLifecycle>
}

export const dynamic = 'force-dynamic'

function statusStyle(status: string): string {
  if (
    ['completed', 'accepted', 'done', 'acknowledged', 'ready_to_execute'].includes(
      status
    )
  ) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'blocked', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['sent', 'submitted', 'awaiting_response'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
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

function buildSwitchesHref(params: {
  status?: string
  requestType?: string
  stage?: string
  q?: string
}): string {
  const searchParams = new URLSearchParams()

  if (params.status && params.status !== 'all') {
    searchParams.set('status', params.status)
  }

  if (params.requestType && params.requestType !== 'all') {
    searchParams.set('requestType', params.requestType)
  }

  if (params.stage && params.stage !== 'all') {
    searchParams.set('stage', params.stage)
  }

  if (params.q && params.q.trim()) {
    searchParams.set('q', params.q.trim())
  }

  const queryString = searchParams.toString()
  return queryString
    ? `/admin/operations/switches?${queryString}`
    : '/admin/operations/switches'
}

function matchesStageFilter(row: SwitchRow, stage: string): boolean {
  if (stage === 'all') return true
  return row.lifecycle.stage === stage
}

function KpiCard({
  label,
  value,
  href,
  active = false,
}: {
  label: string
  value: number
  href: string
  active?: boolean
}) {
  return (
    <Link
      href={href}
      className={[
        'rounded-3xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
        active
          ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/15'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      ].join(' ')}
    >
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
        {value}
      </div>
      <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        Öppna filtrerad vy
      </div>
    </Link>
  )
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
  const stage = (resolvedSearchParams.stage ?? 'all').trim()
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
      meteringPoints: meteringPoints.filter((point) => point.site_id === site.id),
      powersOfAttorney,
    })

    readinessMap.set(site.id, readiness)
  }

  const allRows: SwitchRow[] = requests.map((request) => {
    const readiness = readinessMap.get(request.site_id) ?? null
    const outbound =
      outboundRequests.find(
        (row) =>
          row.source_type === 'supplier_switch_request' &&
          row.source_id === request.id
      ) ?? null

    const lifecycle = getSwitchLifecycle({
      request,
      readiness,
      outboundRequest: outbound,
    })

    return {
      request,
      readiness,
      outbound,
      lifecycle,
    }
  })

  const blockedCount = allRows.filter(
    (row) => row.lifecycle.stage === 'blocked'
  ).length
  const queuedForOutboundCount = allRows.filter(
    (row) => row.lifecycle.stage === 'queued_for_outbound'
  ).length
  const awaitingDispatchCount = allRows.filter(
    (row) => row.lifecycle.stage === 'awaiting_dispatch'
  ).length
  const awaitingResponseCount = allRows.filter(
    (row) => row.lifecycle.stage === 'awaiting_response'
  ).length
  const readyToExecuteCount = allRows.filter(
    (row) => row.lifecycle.stage === 'ready_to_execute'
  ).length
  const failedCount = allRows.filter(
    (row) => row.lifecycle.stage === 'failed'
  ).length
  const completedCount = allRows.filter(
    (row) => row.lifecycle.stage === 'completed'
  ).length

  const filteredRows = allRows.filter((row) => matchesStageFilter(row, stage))

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Switchar"
        subtitle="Hantera leverantörsbyten, validering, outboundkoppling och intern slutföring av switchar."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 lg:grid-cols-3 xl:grid-cols-7">
          <KpiCard
            label="Blockerade"
            value={blockedCount}
            href={buildSwitchesHref({
              status,
              requestType,
              stage: 'blocked',
              q: query,
            })}
            active={stage === 'blocked'}
          />
          <KpiCard
            label="Saknar outbound"
            value={queuedForOutboundCount}
            href={buildSwitchesHref({
              status,
              requestType,
              stage: 'queued_for_outbound',
              q: query,
            })}
            active={stage === 'queued_for_outbound'}
          />
          <KpiCard
            label="Väntar dispatch"
            value={awaitingDispatchCount}
            href={buildSwitchesHref({
              status,
              requestType,
              stage: 'awaiting_dispatch',
              q: query,
            })}
            active={stage === 'awaiting_dispatch'}
          />
          <KpiCard
            label="Väntar kvittens"
            value={awaitingResponseCount}
            href={buildSwitchesHref({
              status,
              requestType,
              stage: 'awaiting_response',
              q: query,
            })}
            active={stage === 'awaiting_response'}
          />
          <KpiCard
            label="Redo att slutföra"
            value={readyToExecuteCount}
            href="/admin/operations/ready-to-execute"
            active={stage === 'ready_to_execute'}
          />
          <KpiCard
            label="Failed"
            value={failedCount}
            href={buildSwitchesHref({
              status,
              requestType,
              stage: 'failed',
              q: query,
            })}
            active={stage === 'failed'}
          />
          <KpiCard
            label="Completed"
            value={completedCount}
            href={buildSwitchesHref({
              status,
              requestType,
              stage: 'completed',
              q: query,
            })}
            active={stage === 'completed'}
          />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Filter och arbetsläge
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Filtrera både på rå status och faktisk lifecycle. Ready-to-execute går till den dedikerade slutföringskön.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/operations/ready-to-execute"
                className="rounded-2xl border border-emerald-300 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
              >
                Öppna ready-to-execute
              </Link>

              <Link
                href="/admin/outbound"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Öppna outbound
              </Link>
            </div>
          </div>

          <form className="mt-6 grid gap-4 xl:grid-cols-[1.2fr_190px_190px_220px_auto]">
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

            <select
              name="stage"
              defaultValue={stage}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="all">Alla lifecycle-steg</option>
              <option value="blocked">Blocked</option>
              <option value="queued_for_outbound">Queued for outbound</option>
              <option value="awaiting_dispatch">Awaiting dispatch</option>
              <option value="awaiting_response">Awaiting response</option>
              <option value="ready_to_execute">Ready to execute</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
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
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Switchlista
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {filteredRows.length} träffar.
                </p>
              </div>

              {stage === 'ready_to_execute' ? (
                <Link
                  href="/admin/operations/ready-to-execute"
                  className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Gå till slutföringskön
                </Link>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 p-6">
            {filteredRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga switchärenden matchade filtret.
              </div>
            ) : (
              filteredRows.map((row) => {
                const { request, readiness, outbound, lifecycle } = row

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
                          {outbound ? (
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                                outbound.status
                              )}`}
                            >
                              outbound: {outbound.status}
                            </span>
                          ) : null}
                        </div>

                        <h3 className="mt-3 text-base font-semibold text-slate-950 dark:text-white">
                          Switchärende {request.id}
                        </h3>

                        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Kund</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.customer_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Site</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.site_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                            <div className="mt-1 font-medium text-slate-900 dark:text-white">
                              {request.metering_point_id}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm dark:bg-slate-950">
                            <div className="text-slate-500 dark:text-slate-400">Startdatum</div>
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

                          {readiness && !readiness.isReady ? (
                            <div className="text-rose-700 dark:text-rose-300">
                              Blockers:{' '}
                              <span className="font-medium">
                                {summarizeReadinessIssues(readiness)}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <Link
                            href={`/admin/operations/switches/${request.id}`}
                            className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                          >
                            Öppna detail view
                          </Link>

                          <Link
                            href={`/admin/customers/${request.customer_id}`}
                            className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                          >
                            Öppna kundkort
                          </Link>

                          <form action={validateSupplierSwitchBeforeProcessingAction}>
                            <input type="hidden" name="request_id" value={request.id} />
                            <button className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                              {request.status === 'draft'
                                ? 'Validera & markera redo'
                                : 'Kör validering'}
                            </button>
                          </form>

                          {['queued', 'submitted', 'accepted'].includes(request.status) ? (
                            outbound ? (
                              <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                                Outbound finns redan
                              </span>
                            ) : (
                              <form action={queueSupplierSwitchOutboundAction}>
                                <input type="hidden" name="request_id" value={request.id} />
                                <button className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                                  Köa outbound manuellt
                                </button>
                              </form>
                            )
                          ) : null}

                          {lifecycle.stage === 'ready_to_execute' ? (
                            <>
                              <form action={finalizeSupplierSwitchExecutionAction}>
                                <input type="hidden" name="request_id" value={request.id} />
                                <button className="rounded-2xl border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                                  Slutför switch
                                </button>
                              </form>

                              <Link
                                href="/admin/operations/ready-to-execute"
                                className="rounded-2xl border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                              >
                                Öppna ready-kö
                              </Link>
                            </>
                          ) : null}
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