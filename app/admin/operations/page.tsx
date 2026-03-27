import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import {
  listAllOperationTasks,
  listAllSupplierSwitchRequests,
  listRecentSupplierSwitchEvents,
} from '@/lib/operations/db'

export const dynamic = 'force-dynamic'

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number
  hint: string
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  )
}

function statusStyle(status: string): string {
  if (['completed', 'accepted', 'done'].includes(status)) {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (['failed', 'rejected', 'blocked', 'cancelled'].includes(status)) {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

export default async function AdminOperationsPage() {
  await requirePermissionServer('masterdata.read')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [tasks, switchRequests, events] = await Promise.all([
    listAllOperationTasks(supabase),
    listAllSupplierSwitchRequests(supabase),
    listRecentSupplierSwitchEvents(supabase, 12),
  ])

  const openTasks = tasks.filter((task) =>
    ['open', 'in_progress', 'blocked'].includes(task.status)
  )

  const blockedTasks = tasks.filter((task) => task.status === 'blocked')

  const activeSwitches = switchRequests.filter((request) =>
    ['queued', 'submitted', 'accepted'].includes(request.status)
  )

  const failedSwitches = switchRequests.filter((request) =>
    ['failed', 'rejected'].includes(request.status)
  )

  const completedSwitches = switchRequests.filter(
    (request) => request.status === 'completed'
  )

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Operations"
        subtitle="Central kö för drift, tasks och leverantörsbyten."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Öppna tasks"
            value={openTasks.length}
            hint="Alla uppgifter som kräver handläggning."
          />
          <KpiCard
            label="Blockerade tasks"
            value={blockedTasks.length}
            hint="Kritiska stopp i flödet."
          />
          <KpiCard
            label="Aktiva switchar"
            value={activeSwitches.length}
            hint="Köade, skickade eller accepterade ärenden."
          />
          <KpiCard
            label="Misslyckade switchar"
            value={failedSwitches.length}
            hint="Behöver uppföljning eller omtag."
          />
          <KpiCard
            label="Avslutade switchar"
            value={completedSwitches.length}
            hint="Slutförda leverantörsbyten."
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Tasks som kräver åtgärd
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Senaste öppna eller blockerade uppgifter.
                </p>
              </div>

              <Link
                href="/admin/operations/tasks"
                className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Öppna tasklistan
              </Link>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-950/50">
                  <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                    <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                      Task
                    </th>
                    <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                      Status
                    </th>
                    <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                      Prioritet
                    </th>
                    <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                      Kund
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {openTasks.slice(0, 10).map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-slate-100 dark:border-slate-800"
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {task.title}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {task.task_type}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                            task.status
                          )}`}
                        >
                          {task.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {task.priority}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/admin/customers/${task.customer_id}`}
                          className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline dark:text-slate-200"
                        >
                          Öppna kundkort
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {openTasks.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        Inga öppna tasks just nu.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
                  Senaste switch-events
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Tidslinje över de senaste operationerna.
                </p>
              </div>

              <Link
                href="/admin/operations/switches"
                className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Öppna switchlistan
              </Link>
            </div>

            <div className="space-y-3 p-6">
              {events.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Inga switch-events ännu.
                </div>
              ) : (
                events.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(
                          event.event_status
                        )}`}
                      >
                        {event.event_status}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {event.event_type}
                      </span>
                    </div>

                    <div className="mt-2 text-sm font-medium text-slate-900 dark:text-white">
                      {event.message ?? 'Ingen meddelandetext'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(event.created_at).toLocaleString('sv-SE')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}