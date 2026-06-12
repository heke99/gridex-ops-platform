import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listBatch2CDriftQueue } from '@/lib/operations/batch2cAutomation'
import { runBatch2CPeriodMotorAction } from '../automation/actions'

export const dynamic = 'force-dynamic'

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function monthsBack(count: number) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1)).toISOString().slice(0, 7)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default async function OperationsPeriodsPage() {
  const admin = await requireAdminPageKeyAccess('operations.automation')
  const scope = await getOperationalCompanyScope(admin.userId)
  const queues = scope.companyId ? await listBatch2CDriftQueue(scope.companyId) : []
  const gaps = queues.filter((row) => row.queue_type === 'metering_period_gap')

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Mätvärdesperioder"
        subtitle="Periodmotor för saknade mätvärden. En lucka skapas per mätpunkt och period, och övriga kunder kan fortsätta i faktureringsflödet."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form action={runBatch2CPeriodMotorAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">Batch 2C</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Skanna periodintervall</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Motor skannar alla mätpunkter i bolaget och skapar requests/cases för perioder där mätvärden saknas.</p>
            <div className="mt-5 grid gap-3">
              <label className="text-sm font-medium text-slate-700">Från period<input name="start_month" type="month" defaultValue={monthsBack(11)} className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" /></label>
              <label className="text-sm font-medium text-slate-700">Till period<input name="end_month" type="month" defaultValue={currentMonth()} className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" /></label>
              <button className="rounded-2xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800" disabled={!scope.companyId}>Kör periodmotor</button>
            </div>
          </form>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Öppna mätvärdesluckor</h2>
            <p className="mt-2 text-sm text-slate-700">{gaps.length} luckor kräver komplettering eller inväntan på nätägare.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Link href="/admin/outbound/missing-meter-values" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Saknade mätvärden</Link>
              <Link href="/admin/operations/tasks" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Driftuppgifter</Link>
              <Link href="/admin/controltower" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Control Tower</Link>
            </div>
          </section>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Periodluckor</h2>
            <p className="mt-1 text-sm text-slate-700">Varje rad kan hanteras separat utan att fakturering för andra kunder stoppas.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {gaps.length === 0 ? <div className="px-6 py-10 text-center text-sm text-slate-600">Inga öppna mätvärdesluckor.</div> : gaps.map((gap) => (
              <div key={gap.source_id} className="grid gap-4 px-6 py-5 text-sm lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <div className="font-semibold text-slate-950">{String(gap.payload?.period_month ?? 'Okänd period')}</div>
                  <div className="mt-1 text-xs text-slate-500">Kund {gap.customer_id ?? '—'}</div>
                </div>
                <div>Mätpunkt: <span className="font-medium text-slate-950">{gap.metering_point_id ?? '—'}</span></div>
                <div>Uppdaterad {formatDate(gap.updated_at)}</div>
                {gap.customer_id ? <Link href={`/admin/customers/${gap.customer_id}`} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Öppna kund</Link> : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
