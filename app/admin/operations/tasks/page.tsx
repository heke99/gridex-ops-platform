//app/admin/operations/tasks/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import { listAllOperationTasks } from '@/lib/operations/db'
import {
 runOperationsTaskAutoResolutionSweepAction,
 updateOperationTaskStatusFromAdminAction,
} from '@/app/admin/operations/actions'
import { isTaskLikelyResolved } from '@/lib/operations/taskResolution'
import type {
 CustomerSiteRow,
 MeteringPointRow,
} from '@/lib/masterdata/types'
import type {
 CustomerOperationTaskRow,
 PowerOfAttorneyRow,
} from '@/lib/operations/types'

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
 return 'bg-emerald-100 text-emerald-700 '
 }

 if (status === 'blocked' || status === 'cancelled') {
 return 'bg-red-100 text-red-700 '
 }

 return 'bg-amber-100 text-amber-700 '
}

function priorityStyle(priority: string): string {
 if (priority === 'critical') {
 return 'bg-red-100 text-red-700 '
 }

 if (priority === 'high') {
 return 'bg-orange-100 text-orange-700 '
 }

 if (priority === 'normal') {
 return 'bg-amber-100 text-amber-700 '
 }

 return 'bg-slate-100 text-slate-700 '
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
 <button className="inline-flex rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 ">
 {label}
 </button>
 </form>
 )
}

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
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="text-sm font-medium text-slate-700 ">
 {label}
 </div>
 <div className="mt-3 text-3xl font-semibold text-slate-950 ">
 {value}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
 {hint}
 </div>
 </div>
 )
}

function taskSiteLabel(
 task: CustomerOperationTaskRow,
 sites: CustomerSiteRow[]
): string {
 if (!task.site_id) return '—'
 return sites.find((site) => site.id === task.site_id)?.site_name ?? task.site_id
}

function taskMeteringPointLabel(
 task: CustomerOperationTaskRow,
 meteringPoints: MeteringPointRow[]
): string {
 if (!task.metering_point_id) return '—'
 return (
 meteringPoints.find((point) => point.id === task.metering_point_id)?.meter_point_id ??
 task.metering_point_id
 )
}

export default async function AdminOperationsTasksPage({
 searchParams,
}: TasksPageProps) {
 const context = await requireAdminPageKeyAccess('operations.tasks')
 const tenantScope = await resolveAdminTenantReadScope(context)
 const companyId = tenantScope.companyId

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
 companyId,
 })

 let sitesQueryBuilder = supabase
 .from('customer_sites')
 .select('*')

 if (companyId) {
 sitesQueryBuilder = sitesQueryBuilder.eq('company_id', companyId)
 }

 const sitesQuery = await sitesQueryBuilder.order('created_at', { ascending: false })

 if (sitesQuery.error) throw sitesQuery.error
 const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]

 const meteringPoints = await listMeteringPointsBySiteIds(
 supabase,
 sites.map((site) => site.id),
 { companyId }
 )

 let poaQueryBuilder = supabase
 .from('powers_of_attorney')
 .select('*')

 if (companyId) {
 poaQueryBuilder = poaQueryBuilder.eq('company_id', companyId)
 }

 const poaQuery = await poaQueryBuilder.order('created_at', { ascending: false })

 if (poaQuery.error) throw poaQuery.error
 const powersOfAttorney = (poaQuery.data ?? []) as PowerOfAttorneyRow[]

 const openTasks = tasks.filter((task) =>
 ['open', 'in_progress', 'blocked'].includes(task.status)
 )
 const blockedTasks = tasks.filter((task) => task.status === 'blocked')
 const criticalTasks = tasks.filter((task) => task.priority === 'critical')
 const likelyResolvedTasks = openTasks.filter((task) =>
 isTaskLikelyResolved({
 task,
 sites,
 meteringPoints,
 powersOfAttorney,
 })
 )

 const blockerFirst = [...openTasks].sort((a, b) => {
 const priorityRank = (value: string): number => {
 switch (value) {
 case 'critical':
 return 4
 case 'high':
 return 3
 case 'normal':
 return 2
 default:
 return 1
 }
 }

 const statusRank = (value: string): number => {
 switch (value) {
 case 'blocked':
 return 3
 case 'in_progress':
 return 2
 case 'open':
 return 1
 default:
 return 0
 }
 }

 const byStatus = statusRank(b.status) - statusRank(a.status)
 if (byStatus !== 0) return byStatus

 const byPriority = priorityRank(b.priority) - priorityRank(a.priority)
 if (byPriority !== 0) return byPriority

 return (
 new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
 )
 })

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Operations Tasks"
 subtitle="Hantera öppna, blockerade, prioriterade och sannolikt lösta uppgifter i driftkön."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <section className="grid gap-4 xl:grid-cols-4">
 <KpiCard
 label="Öppna tasks"
 value={openTasks.length}
 hint="Alla tasks som fortfarande kräver handläggning."
 />
 <KpiCard
 label="Blockerade"
 value={blockedTasks.length}
 hint="Tasks som stoppar nästa steg."
 />
 <KpiCard
 label="Kritiska"
 value={criticalTasks.length}
 hint="Högsta prioritet i arbetskön."
 />
 <KpiCard
 label="Kan sannolikt stängas"
 value={likelyResolvedTasks.length}
 hint="Datat ser ut att vara kompletterat redan."
 />
 </section>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Filter och synk
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Kör en tasksync för att auto-resolva blockers efter att masterdata, fullmakter eller CIS-data uppdaterats.
 </p>
 </div>

 <form action={runOperationsTaskAutoResolutionSweepAction}>
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Kör auto-resolution sweep
 </button>
 </form>
 </div>

 <form className="grid gap-4 xl:grid-cols-[1.3fr_220px_220px_auto]">
 <input
 name="q"
 defaultValue={query}
 placeholder="Sök på task, typ, kund eller site"
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm outline-none focus:border-emerald-700 "
 />

 <select
 name="status"
 defaultValue={status}
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
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
 className="h-11 rounded-2xl border border-slate-300 px-4 text-sm "
 >
 <option value="all">Alla prioriteter</option>
 <option value="low">Low</option>
 <option value="normal">Normal</option>
 <option value="high">High</option>
 <option value="critical">Critical</option>
 </select>

 <div className="flex gap-3">
 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Filtrera
 </button>
 <Link
 href="/admin/operations/tasks"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Rensa
 </Link>
 </div>
 </form>
 </section>

 <section className="grid gap-6 xl:grid-cols-2">
 <div className="rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Blocker-first
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Sorterad vy för det som bör hanteras först.
 </p>
 </div>

 <div className="space-y-3 p-6">
 {blockerFirst.slice(0, 10).map((task) => (
 <div
 key={task.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(task.status)}`}>
 {task.status}
 </span>
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityStyle(task.priority)}`}>
 {task.priority}
 </span>
 <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ">
 {task.task_type}
 </span>
 </div>

 <div className="mt-3 text-sm font-semibold text-slate-900 ">
 {task.title}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {task.description ?? '—'}
 </div>

 <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
 <div>Kund: {task.customer_id}</div>
 <div>Site: {taskSiteLabel(task, sites)}</div>
 <div>Mätpunkt: {taskMeteringPointLabel(task, meteringPoints)}</div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 {task.status !== 'open' ? (
 <ActionButton taskId={task.id} status="open" label="Open" />
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
 <ActionButton taskId={task.id} status="done" label="Done" />
 ) : null}
 </div>
 </div>
 ))}

 {blockerFirst.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-700 ">
 Inga tasks matchade filtret.
 </div>
 ) : null}
 </div>
 </div>

 <div className="rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kan sannolikt stängas
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Dessa tasks ser ut att redan vara lösta i datat och kan ofta markeras som done.
 </p>
 </div>

 <div className="space-y-3 p-6">
 {likelyResolvedTasks.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-700 ">
 Inga tydliga auto-resolve-kandidater just nu.
 </div>
 ) : (
 likelyResolvedTasks.slice(0, 10).map((task) => (
 <div
 key={task.id}
 className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 "
 >
 <div className="flex flex-wrap items-center gap-2">
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle(task.status)}`}>
 {task.status}
 </span>
 <span className={`rounded-full px-3 py-1 text-xs font-semibold ${priorityStyle(task.priority)}`}>
 {task.priority}
 </span>
 <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-800 ">
 auto-resolve kandidat
 </span>
 </div>

 <div className="mt-3 text-sm font-semibold text-slate-900 ">
 {task.title}
 </div>
 <div className="mt-1 text-sm text-slate-700 ">
 {task.description ?? '—'}
 </div>

 <div className="mt-3 grid gap-2 text-xs text-slate-700 sm:grid-cols-3">
 <div>Kund: {task.customer_id}</div>
 <div>Site: {taskSiteLabel(task, sites)}</div>
 <div>Mätpunkt: {taskMeteringPointLabel(task, meteringPoints)}</div>
 </div>

 <div className="mt-4 flex flex-wrap gap-2">
 <ActionButton taskId={task.id} status="done" label="Markera done" />
 {task.status !== 'in_progress' ? (
 <ActionButton
 taskId={task.id}
 status="in_progress"
 label="In progress"
 />
 ) : null}
 </div>
 </div>
 ))
 )}
 </div>
 </div>
 </section>

 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-950 ">
 Tasklista
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {tasks.length} träffar.
 </p>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="border-b border-slate-200 text-left ">
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Task
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Status
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Prioritet
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Kund
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Site
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Skapad
 </th>
 <th className="px-6 py-4 font-semibold text-slate-700 ">
 Åtgärder
 </th>
 </tr>
 </thead>

 <tbody>
 {tasks.length === 0 ? (
 <tr>
 <td
 colSpan={7}
 className="px-6 py-12 text-center text-sm text-slate-700 "
 >
 Inga tasks matchade filtret.
 </td>
 </tr>
 ) : (
 tasks.map((task) => {
 const likelyResolved = isTaskLikelyResolved({
 task,
 sites,
 meteringPoints,
 powersOfAttorney,
 })

 return (
 <tr
 key={task.id}
 className="border-b border-slate-100 align-top "
 >
 <td className="px-6 py-4">
 <div className="font-medium text-slate-900 ">
 {task.title}
 </div>
 <div className="mt-1 flex flex-wrap items-center gap-2">
 <span className="text-xs text-slate-700 ">
 {task.task_type}
 </span>
 {likelyResolved ? (
 <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ">
 sannolikt löst
 </span>
 ) : null}
 </div>
 <div className="mt-2 text-sm text-slate-700 ">
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

 <td className="px-6 py-4">
 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${priorityStyle(
 task.priority
 )}`}
 >
 {task.priority}
 </span>
 </td>

 <td className="px-6 py-4">
 <Link
 href={`/admin/customers/${task.customer_id}`}
 className="text-sm font-medium text-slate-700 underline-offset-4 hover:underline "
 >
 Öppna kundkort
 </Link>
 </td>

 <td className="px-6 py-4 text-xs text-slate-700 ">
 <div>{taskSiteLabel(task, sites)}</div>
 <div className="mt-1">
 {taskMeteringPointLabel(task, meteringPoints)}
 </div>
 </td>

 <td className="px-6 py-4 text-slate-700 ">
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
 label={likelyResolved ? 'Stäng som löst' : 'Done'}
 />
 ) : null}
 </div>
 </td>
 </tr>
 )
 })
 )}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 </div>
 )
}