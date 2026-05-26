import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import {
  getPlatformWorkQueueStatusLabel,
  getPlatformWorkQueueTypeLabel,
  listPlatformWorkQueueItems,
  type PlatformWorkQueueItem,
  type PlatformWorkQueueType,
} from '@/lib/platform/workQueue'

export const dynamic = 'force-dynamic'

type PlatformWorkQueuePageProps = {
  searchParams: Promise<{
    type?: string
    status?: string
    q?: string
  }>
}

const TYPE_FILTERS: Array<{ id: 'all' | PlatformWorkQueueType; label: string }> = [
  { id: 'all', label: 'Alla' },
  { id: 'setup', label: 'Aktörsprofil' },
  { id: 'actor_testing', label: 'Aktörstest' },
  { id: 'go_live', label: 'Go-live' },
  { id: 'usage', label: 'Usage' },
  { id: 'billing', label: 'Fakturering' },
  { id: 'tenant_status', label: 'Tenantstatus' },
]

const STATUS_FILTERS: Array<{ id: 'all' | PlatformWorkQueueItem['status']; label: string }> = [
  { id: 'all', label: 'Alla statusar' },
  { id: 'critical', label: 'Kritisk' },
  { id: 'warning', label: 'Kräver åtgärd' },
  { id: 'ready', label: 'Redo' },
  { id: 'info', label: 'Info' },
]

function toneForStatus(status: PlatformWorkQueueItem['status']): string {
  if (status === 'critical') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function formatDate(value: string | null): string {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function countByStatus(items: PlatformWorkQueueItem[], status: PlatformWorkQueueItem['status']): number {
  return items.filter((item) => item.status === status).length
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${tone}`}>
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-2 text-3xl font-black tracking-tight">{value}</div>
    </div>
  )
}

export default async function PlatformWorkQueuePage({ searchParams }: PlatformWorkQueuePageProps) {
  const admin = await requireAdminPageKeyAccess('platform.work_queue')
  const resolvedSearchParams = await searchParams
  const selectedType = (resolvedSearchParams.type ?? 'all').trim()
  const selectedStatus = (resolvedSearchParams.status ?? 'all').trim()
  const query = (resolvedSearchParams.q ?? '').trim().toLowerCase()
  const items = await listPlatformWorkQueueItems()

  const filteredItems = items.filter((item) => {
    const matchesType = selectedType === 'all' || item.type === selectedType
    const matchesStatus = selectedStatus === 'all' || item.status === selectedStatus
    const haystack = [item.companyName, item.title, item.description, item.nextAction, item.status, item.type].join(' ').toLowerCase()
    const matchesQuery = !query || haystack.includes(query)
    return matchesType && matchesStatus && matchesQuery
  })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Plattformsarbetskö"
        subtitle="Superadmin-vy över tenants som behöver aktörsprofil, test, go-live, usage eller faktureringsuppföljning."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-900">Superadmin</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Vad behöver kontrolleras på plattformen?</h1>
              <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-slate-700">
                Här samlas bolag som saknar aktörsprofil, har blockerade aktörstester, väntar på live-kontroll eller har usage som kräver uppföljning. Det gör superadmin-flödet mer samlat än att hoppa mellan många tekniska sidor.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/platform/actor-testing" className="rounded-2xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-black text-emerald-800 hover:bg-emerald-50">Aktörstester</Link>
              <Link href="/admin/platform/usage" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Usage</Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Kritiska" value={countByStatus(items, 'critical')} tone="border-red-200 bg-red-50 text-red-800" />
          <StatCard label="Kräver åtgärd" value={countByStatus(items, 'warning')} tone="border-amber-200 bg-amber-50 text-amber-800" />
          <StatCard label="Redo" value={countByStatus(items, 'ready')} tone="border-emerald-200 bg-emerald-50 text-emerald-800" />
          <StatCard label="Totalt" value={items.length} tone="border-slate-200 bg-white text-slate-950" />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <form className="grid gap-4 lg:grid-cols-[1fr_220px_220px_auto]" action="/admin/platform/work-queue">
            <label className="grid gap-1 text-xs font-black uppercase tracking-[0.16em] text-slate-600">
              Sök
              <input name="q" defaultValue={resolvedSearchParams.q ?? ''} placeholder="Bolag, problem eller nästa åtgärd" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold normal-case tracking-normal text-slate-950" />
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-[0.16em] text-slate-600">
              Typ
              <select name="type" defaultValue={selectedType} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold normal-case tracking-normal text-slate-950">
                {TYPE_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-[0.16em] text-slate-600">
              Status
              <select name="status" defaultValue={selectedStatus} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold normal-case tracking-normal text-slate-950">
                {STATUS_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
              </select>
            </label>
            <button className="self-end rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">Filtrera</button>
          </form>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-black text-slate-950">Åtgärder</h2>
            <p className="mt-1 text-sm font-semibold text-slate-700">{filteredItems.length} av {items.length} poster visas.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="px-6 py-4">Bolag</th>
                  <th className="px-6 py-4">Problem</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Nästa åtgärd</th>
                  <th className="px-6 py-4">Senast</th>
                  <th className="px-6 py-4">Öppna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-6 py-4">
                      <Link href={`/admin/companies/${item.companyId}`} className="font-black text-emerald-800 hover:underline">{item.companyName}</Link>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{getPlatformWorkQueueTypeLabel(item.type)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-black text-slate-950">{item.title}</div>
                      <div className="mt-1 max-w-xl text-sm font-semibold leading-6 text-slate-700">{item.description}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${toneForStatus(item.status)}`}>{getPlatformWorkQueueStatusLabel(item.status)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold leading-6 text-slate-700">{item.nextAction}</td>
                    <td className="px-6 py-4 text-slate-700">{formatDate(item.updatedAt)}</td>
                    <td className="px-6 py-4">
                      <Link href={item.href} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-100">Öppna</Link>
                    </td>
                  </tr>
                ))}
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm font-semibold text-slate-600">Inga poster matchar filtret.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
