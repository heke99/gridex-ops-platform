import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { listAllOperationTasks } from '@/lib/operations/db'
import { updateOperationTaskStatusFromAdminAction } from '@/app/admin/operations/actions'

export const dynamic = 'force-dynamic'

type TasksPageProps = {
  searchParams: Promise<{
    status?: string
    priority?: string
    q?: string
  }>
}

function statusStyle(status: string): string {
  if (status === 'done') {
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
  }

  if (status === 'blocked' || status === 'cancelled') {
    return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
  }

  return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
}

function ActionButton({
  taskId,
  status,
  label,
}: {
  taskId: string
  status: string
  label: string
}) {
  return (
    <form action={updateOperationTaskStatusFromAdminAction}>
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="status" value={status} />
      <button className="inline-flex rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
        {label}
      </button>
    </form>
  )
}

export default async function AdminOperationsTasksPage({
  searchParams,
}: TasksPageProps) {
  await requirePermissionServer('masterdata.read')

  const resolvedSearchParams = await searchParams
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const status = (resolvedSearchParams.status ?? 'all').trim()
  const priority = (resolvedSearchParams.priority ?? 'all').trim()
  const query = (resolvedSearchParams.q ?? '').trim()

  const tasks = await listAllOperationTasks(supabase, {
    status,
    priority,
    query,
  })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Operations Tasks"
        subtitle="Hantera öppna, blockerade och klara uppgifter i driftkön."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_220px_auto]">
            <input
              name="q"
              defaultValue={query}
              placeholder="Sök på task, typ, kund eller site"
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />

            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="all">Alla statusar</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <select
              name="priority"
              defaultValue={priority}
              className="h-11 rounded-2xl border border-slate-300 px-4 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="all">Alla prioriteter</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <div className="flex gap-3">
              <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
                Filtrera
              </button>
              <Link
                href="/admin/operations/tasks"
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
              Tasklista
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {tasks.length} träffar.
            </p>
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
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Site
                  </th>
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Skapad
                  </th>
                  <th className="px-6 py-4 font-semibold text-slate-600 dark:text-slate-300">
                    Åtgärder
                  </th>
                </tr>
              </thead>

              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400"
                    >
                      Inga tasks matchade filtret.
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => (
                    <tr
                      key={task.id}
                      className="border-b border-slate-100 align-top dark:border-slate-800"
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {task.title}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {task.task_type}
                        </div>
                        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                          {task.description ?? '—'}
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

                      <td className="px-6 py-4 text-xs text-slate-500 dark:text-slate-400">
                        {task.site_id ?? '—'}
                      </td>

                      <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                        {new Date(task.created_at).toLocaleString('sv-SE')}
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {task.status !== 'open' ? (
                            <ActionButton
                              taskId={task.id}
                              status="open"
                              label="Open"
                            />
                          ) : null}
                          {task.status !== 'in_progress' ? (
                            <ActionButton
                              taskId={task.id}
                              status="in_progress"
                              label="In progress"
                            />
                          ) : null}
                          {task.status !== 'blocked' ? (
                            <ActionButton
                              taskId={task.id}
                              status="blocked"
                              label="Blocked"
                            />
                          ) : null}
                          {task.status !== 'done' ? (
                            <ActionButton
                              taskId={task.id}
                              status="done"
                              label="Done"
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}