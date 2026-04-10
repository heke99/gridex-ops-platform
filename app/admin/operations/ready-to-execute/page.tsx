import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  bulkFinalizeReadySupplierSwitchesAction,
  finalizeSupplierSwitchExecutionAction,
} from '@/app/admin/operations/actions'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'
import { listOutboundRequests } from '@/lib/cis/db'
import { getSwitchLifecycle } from '@/lib/operations/controlTower'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

export const dynamic = 'force-dynamic'

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function badgeTone(status: string): string {
  if (['completed', 'accepted', 'acknowledged', 'ready_to_execute'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'cancelled', 'blocked'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  if (['sent', 'submitted'].includes(status)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function siteLabel(siteId: string, sites: CustomerSiteRow[]): string {
  return sites.find((site) => site.id === siteId)?.site_name ?? siteId
}

export default async function ReadyToExecuteSwitchesPage() {
  await requirePermissionServer('masterdata.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [requests, outboundRequests, sitesQuery] = await Promise.all([
    listAllSupplierSwitchRequests(supabase, {
      status: 'all',
      requestType: 'all',
      query: '',
    }),
    listOutboundRequests({
      status: 'all',
      requestType: 'supplier_switch',
      channelType: 'all',
      query: '',
    }),
    supabase.from('customer_sites').select('*'),
  ])

  if (sitesQuery.error) {
    throw sitesQuery.error
  }

  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

  const acceptedRequests = requests.filter((request) => request.status === 'accepted')

  const readyRows = acceptedRequests
    .map((request) => {
      const outbound =
        outboundRequests.find(
          (row) =>
            row.request_type === 'supplier_switch' &&
            row.source_type === 'supplier_switch_request' &&
            row.source_id === request.id
        ) ?? null

      const lifecycle = getSwitchLifecycle({
        request,
        readiness: null,
        outboundRequest: outbound,
      })

      return {
        request,
        outbound,
        lifecycle,
      }
    })
    .filter((row) => row.lifecycle.stage === 'ready_to_execute')
    .sort((a, b) => {
      const aTime = new Date(
        a.outbound?.acknowledged_at ??
          a.request.submitted_at ??
          a.request.created_at
      ).getTime()
      const bTime = new Date(
        b.outbound?.acknowledged_at ??
          b.request.submitted_at ??
          b.request.created_at
      ).getTime()

      return aTime - bTime
    })

  const acceptedButNotReady = acceptedRequests.length - readyRows.length
  const acknowledgedOutboundCount = outboundRequests.filter(
    (row) =>
      row.request_type === 'supplier_switch' && row.status === 'acknowledged'
  ).length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Ready to execute"
        subtitle="Dedikerad kö för accepted + acknowledged switchar som väntar på sista interna execution-steget. Här kan du slutföra enskilt eller i bulk."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Redo att slutföra</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {readyRows.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Switchar som kan köras till completed nu.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Accepted totalt</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {acceptedRequests.length}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Alla accepted switchar oavsett om de är redo eller ej.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Accepted men ej redo</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {acceptedButNotReady}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Kräver mer än bara accepted-status, oftast outbound-läge.
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm text-slate-500 dark:text-slate-400">Ackade outbound</div>
            <div className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">
              {acknowledgedOutboundCount}
            </div>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Supplier switch-outbound som redan är kvitterade.
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                Bulk execution
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Kör detta när du vill slutföra hela kön av acknowledged switchar i ett steg.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/operations/switches"
                className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                Öppna switchlistan
              </Link>

              <form action={bulkFinalizeReadySupplierSwitchesAction}>
                <button className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
                  Slutför alla redo
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              Ready-to-execute-kö
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Endast switchar där lifecycle nu är redo för intern execution.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {readyRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Inga switchar är redo att slutföras just nu.
              </div>
            ) : (
              readyRows.map(({ request, outbound, lifecycle }) => (
                <article
                  key={request.id}
                  className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800"
                >
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
                            request.status
                          )}`}
                        >
                          {request.status}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
                            lifecycle.stage
                          )}`}
                        >
                          {lifecycle.label}
                        </span>
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
                            outbound?.status ?? 'queued'
                          )}`}
                        >
                          outbound: {outbound?.status ?? '—'}
                        </span>
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
                            {siteLabel(request.site_id, sites)}
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

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 p-4 text-sm dark:border-slate-800">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            Lifecycle reason
                          </div>
                          <div className="mt-2 text-slate-600 dark:text-slate-300">
                            {lifecycle.reason}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-slate-200 p-4 text-sm dark:border-slate-800">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            Ack / submitted
                          </div>
                          <div className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
                            <div>
                              Submitted:{' '}
                              <span className="font-medium">
                                {formatDateTime(request.submitted_at)}
                              </span>
                            </div>
                            <div>
                              Ack:{' '}
                              <span className="font-medium">
                                {formatDateTime(outbound?.acknowledged_at)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 p-5 dark:border-slate-800">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Åtgärder
                      </h4>

                      <div className="mt-4 space-y-3">
                        <form action={finalizeSupplierSwitchExecutionAction}>
                          <input type="hidden" name="request_id" value={request.id} />
                          <button className="w-full rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
                            Slutför switch nu
                          </button>
                        </form>

                        <Link
                          href={`/admin/operations/switches/${request.id}`}
                          className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Öppna switch detail
                        </Link>

                        <Link
                          href={`/admin/customers/${request.customer_id}`}
                          className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Öppna kundkort
                        </Link>

                        <Link
                          href="/admin/outbound"
                          className="block rounded-2xl border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                        >
                          Öppna outbound
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}