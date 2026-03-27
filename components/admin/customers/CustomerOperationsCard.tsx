'use client'

import { useFormStatus } from 'react-dom'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import type {
  CustomerOperationTaskRow,
  PowerOfAttorneyRow,
  SupplierSwitchEventRow,
  SupplierSwitchRequestRow,
  SwitchReadinessResult,
} from '@/lib/operations/types'
import {
  createPowerOfAttorneyAction,
  createSupplierSwitchRequestAction,
  runSwitchReadinessAction,
  updateOperationTaskStatusAction,
} from '@/app/admin/customers/[id]/actions'

type CustomerOperationsCardProps = {
  customerId: string
  sites: CustomerSiteRow[]
  meteringPoints: MeteringPointRow[]
  powersOfAttorney: PowerOfAttorneyRow[]
  tasks: CustomerOperationTaskRow[]
  switchRequests: SupplierSwitchRequestRow[]
  switchEvents: SupplierSwitchEventRow[]
  readinessResults: SwitchReadinessResult[]
}

function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string
  pendingLabel: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('sv-SE')
}

function getLatestPowerOfAttorneyForSite(
  siteId: string,
  powersOfAttorney: PowerOfAttorneyRow[]
): PowerOfAttorneyRow | null {
  const siteScoped = powersOfAttorney.filter((poa) => poa.site_id === siteId)
  const globalScoped = powersOfAttorney.filter((poa) => poa.site_id === null)

  return [...siteScoped, ...globalScoped].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )[0] ?? null
}

function getTasksForSite(
  siteId: string,
  tasks: CustomerOperationTaskRow[]
): CustomerOperationTaskRow[] {
  return tasks.filter((task) => task.site_id === siteId)
}

function getSwitchRequestsForSite(
  siteId: string,
  switchRequests: SupplierSwitchRequestRow[]
): SupplierSwitchRequestRow[] {
  return switchRequests.filter((request) => request.site_id === siteId)
}

function getEventsForRequest(
  requestId: string,
  events: SupplierSwitchEventRow[]
): SupplierSwitchEventRow[] {
  return events.filter((event) => event.switch_request_id === requestId)
}

function getMeteringPointLabel(
  meteringPointId: string | null,
  meteringPoints: MeteringPointRow[]
): string {
  if (!meteringPointId) return '—'
  return (
    meteringPoints.find((point) => point.id === meteringPointId)?.meter_point_id ??
    '—'
  )
}

function StatusBadge({
  value,
  variant = 'default',
}: {
  value: string
  variant?: 'default' | 'success' | 'warning' | 'danger'
}) {
  const styles = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    success:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning:
      'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    danger:
      'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${styles[variant]}`}
    >
      {value}
    </span>
  )
}

export default function CustomerOperationsCard({
  customerId,
  sites,
  meteringPoints,
  powersOfAttorney,
  tasks,
  switchRequests,
  switchEvents,
  readinessResults,
}: CustomerOperationsCardProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Leverantörsbyte & operations
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Fullmakt, readiness, operativa tasks och switchärenden per anläggning.
        </p>
      </div>

      <div className="space-y-6">
        {sites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Lägg först upp minst en anläggning för att aktivera operationsflödet.
          </div>
        ) : (
          sites.map((site) => {
            const readiness = readinessResults.find(
              (result) => result.siteId === site.id
            )
            const latestPowerOfAttorney = getLatestPowerOfAttorneyForSite(
              site.id,
              powersOfAttorney
            )
            const siteTasks = getTasksForSite(site.id, tasks)
            const siteRequests = getSwitchRequestsForSite(site.id, switchRequests)

            return (
              <article
                key={site.id}
                className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                      {site.site_name}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {site.facility_id ?? 'Inget anläggnings-ID'}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {site.price_area_code ?? 'Elområde saknas'}
                      </span>
                      {readiness?.isReady ? (
                        <StatusBadge value="Redo för byte" variant="success" />
                      ) : (
                        <StatusBadge value="Ej redo" variant="warning" />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Tasks</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                        {
                          siteTasks.filter((task) =>
                            ['open', 'in_progress', 'blocked'].includes(task.status)
                          ).length
                        }
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Switchärenden</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                        {siteRequests.length}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-950">
                      <div className="text-slate-500 dark:text-slate-400">Mätpunkt</div>
                      <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-white">
                        {getMeteringPointLabel(
                          readiness?.candidateMeteringPointId ?? null,
                          meteringPoints
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Fullmakt
                      </h4>

                      <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                        <div>
                          Senaste status:{' '}
                          <span className="font-medium">
                            {latestPowerOfAttorney?.status ?? 'saknas'}
                          </span>
                        </div>
                        <div>
                          Giltig från:{' '}
                          <span className="font-medium">
                            {latestPowerOfAttorney?.valid_from ?? '—'}
                          </span>
                        </div>
                        <div>
                          Giltig till:{' '}
                          <span className="font-medium">
                            {latestPowerOfAttorney?.valid_to ?? '—'}
                          </span>
                        </div>
                        <div>
                          Referens:{' '}
                          <span className="font-medium">
                            {latestPowerOfAttorney?.reference ?? '—'}
                          </span>
                        </div>
                      </div>

                      <form
                        action={createPowerOfAttorneyAction}
                        className="mt-4 space-y-3"
                      >
                        <input type="hidden" name="customer_id" value={customerId} />
                        <input type="hidden" name="site_id" value={site.id} />
                        <input
                          type="hidden"
                          name="id"
                          value={latestPowerOfAttorney?.id ?? ''}
                        />
                        <input
                          type="hidden"
                          name="scope"
                          value="supplier_switch"
                        />

                        <label className="grid gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Status
                          </span>
                          <select
                            name="status"
                            defaultValue={latestPowerOfAttorney?.status ?? 'draft'}
                            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          >
                            <option value="draft">Draft</option>
                            <option value="sent">Skickad</option>
                            <option value="signed">Signerad</option>
                            <option value="expired">Expired</option>
                            <option value="revoked">Revoked</option>
                          </select>
                        </label>

                        <label className="grid gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Giltig från
                          </span>
                          <input
                            name="valid_from"
                            type="date"
                            defaultValue={
                              latestPowerOfAttorney?.valid_from?.slice(0, 10) ?? ''
                            }
                            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                        </label>

                        <label className="grid gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Giltig till
                          </span>
                          <input
                            name="valid_to"
                            type="date"
                            defaultValue={
                              latestPowerOfAttorney?.valid_to?.slice(0, 10) ?? ''
                            }
                            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                        </label>

                        <label className="grid gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Referens
                          </span>
                          <input
                            name="reference"
                            defaultValue={latestPowerOfAttorney?.reference ?? ''}
                            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                        </label>

                        <label className="grid gap-2">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Notering
                          </span>
                          <textarea
                            name="notes"
                            rows={3}
                            defaultValue={latestPowerOfAttorney?.notes ?? ''}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                        </label>

                        <SubmitButton
                          idleLabel="Spara fullmakt"
                          pendingLabel="Sparar fullmakt..."
                        />
                      </form>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Readiness & switch
                      </h4>

                      <div className="mt-3 space-y-3">
                        <form action={runSwitchReadinessAction}>
                          <input type="hidden" name="customer_id" value={customerId} />
                          <input type="hidden" name="site_id" value={site.id} />
                          <SubmitButton
                            idleLabel="Kör readiness"
                            pendingLabel="Kör readiness..."
                          />
                        </form>

                        <form
                          action={createSupplierSwitchRequestAction}
                          className="space-y-3"
                        >
                          <input type="hidden" name="customer_id" value={customerId} />
                          <input type="hidden" name="site_id" value={site.id} />

                          <label className="grid gap-2">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              Ärendetyp
                            </span>
                            <select
                              name="request_type"
                              defaultValue="switch"
                              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            >
                              <option value="switch">Byte av leverantör</option>
                              <option value="move_in">Inflytt</option>
                              <option value="move_out_takeover">Övertag vid utflytt</option>
                            </select>
                          </label>

                          <label className="grid gap-2">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              Önskat startdatum
                            </span>
                            <input
                              name="requested_start_date"
                              type="date"
                              defaultValue={site.move_in_date ?? ''}
                              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                          </label>

                          <SubmitButton
                            idleLabel="Skapa switchärende"
                            pendingLabel="Skapar switchärende..."
                          />
                        </form>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Readinessresultat
                      </h4>

                      <div className="mt-3">
                        {readiness?.isReady ? (
                          <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            Anläggningen är redo för byte.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {(readiness?.issues ?? []).map((issue) => (
                              <div
                                key={issue.code}
                                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10"
                              >
                                <div className="font-semibold text-amber-800 dark:text-amber-300">
                                  {issue.title}
                                </div>
                                <div className="mt-1 text-amber-700 dark:text-amber-200">
                                  {issue.description}
                                </div>
                              </div>
                            ))}

                            {!readiness || readiness.issues.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                Inget readinessresultat ännu.
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Operativa tasks
                      </h4>

                      <div className="mt-3 space-y-3">
                        {siteTasks.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Inga tasks för denna anläggning.
                          </div>
                        ) : (
                          siteTasks.map((task) => (
                            <div
                              key={task.id}
                              className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge
                                  value={task.status}
                                  variant={
                                    task.status === 'done'
                                      ? 'success'
                                      : task.status === 'blocked'
                                        ? 'danger'
                                        : 'warning'
                                  }
                                />
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {task.priority}
                                </span>
                              </div>

                              <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                                {task.title}
                              </div>
                              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                {task.description ?? '—'}
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                {task.status !== 'done' ? (
                                  <form action={updateOperationTaskStatusAction}>
                                    <input type="hidden" name="customer_id" value={customerId} />
                                    <input type="hidden" name="task_id" value={task.id} />
                                    <input type="hidden" name="status" value="done" />
                                    <SubmitButton
                                      idleLabel="Markera klar"
                                      pendingLabel="Uppdaterar..."
                                    />
                                  </form>
                                ) : null}

                                {task.status !== 'blocked' ? (
                                  <form action={updateOperationTaskStatusAction}>
                                    <input type="hidden" name="customer_id" value={customerId} />
                                    <input type="hidden" name="task_id" value={task.id} />
                                    <input type="hidden" name="status" value="blocked" />
                                    <SubmitButton
                                      idleLabel="Blockera"
                                      pendingLabel="Uppdaterar..."
                                    />
                                  </form>
                                ) : null}

                                {task.status !== 'open' ? (
                                  <form action={updateOperationTaskStatusAction}>
                                    <input type="hidden" name="customer_id" value={customerId} />
                                    <input type="hidden" name="task_id" value={task.id} />
                                    <input type="hidden" name="status" value="open" />
                                    <SubmitButton
                                      idleLabel="Öppna igen"
                                      pendingLabel="Uppdaterar..."
                                    />
                                  </form>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Switchärenden
                      </h4>

                      <div className="mt-3 space-y-4">
                        {siteRequests.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            Inga switchärenden för denna anläggning ännu.
                          </div>
                        ) : (
                          siteRequests.map((request) => {
                            const requestEvents = getEventsForRequest(
                              request.id,
                              switchEvents
                            )

                            return (
                              <div
                                key={request.id}
                                className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge
                                    value={request.status}
                                    variant={
                                      request.status === 'completed' ||
                                      request.status === 'accepted'
                                        ? 'success'
                                        : request.status === 'failed' ||
                                            request.status === 'rejected'
                                          ? 'danger'
                                          : 'warning'
                                    }
                                  />
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {request.request_type}
                                  </span>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    Start: {request.requested_start_date ?? '—'}
                                  </span>
                                </div>

                                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                                  Mätpunkt:{' '}
                                  <span className="font-medium">
                                    {getMeteringPointLabel(
                                      request.metering_point_id,
                                      meteringPoints
                                    )}
                                  </span>
                                </div>

                                <div className="mt-3 space-y-2">
                                  {requestEvents.length === 0 ? (
                                    <div className="text-sm text-slate-500 dark:text-slate-400">
                                      Inga events ännu.
                                    </div>
                                  ) : (
                                    requestEvents.slice(0, 5).map((event) => (
                                      <div
                                        key={event.id}
                                        className="rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-950"
                                      >
                                        <div className="font-medium text-slate-900 dark:text-white">
                                          {event.event_type} — {event.event_status}
                                        </div>
                                        <div className="mt-1 text-slate-600 dark:text-slate-300">
                                          {event.message ?? '—'}
                                        </div>
                                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                          {formatDateTime(event.created_at)}
                                        </div>
                                      </div>
                                    ))
                                  )}
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