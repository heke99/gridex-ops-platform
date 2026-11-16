import { getAdminPageRequirement } from '@/lib/admin/accessModel'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canPresentOperationalAction, canPresentAdminLink } from '@/lib/admin/actionPresentation'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminSelectedCompanyReadScope } from '@/lib/tenant/adminScope'
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
  const scope = await resolveAdminSelectedCompanyReadScope(admin, { allowMissing: true })
  const canWrite = await canPresentOperationalAction({ anyOf: ['metering.write', 'billing_underlay.export', 'cases.write'] }, scope.companyId)
  const queues = scope.companyId ? await listBatch2CDriftQueue(scope.companyId) : []
  const gaps = queues.filter((row) => row.queue_type === 'metering_period_gap')
  const canReadCustomers = canPresentAdminLink(admin, { anyOf: ['customers.read', 'masterdata.read'] })
  const canReadMetering = canPresentAdminLink(admin, { anyOf: ['metering.read', 'masterdata.read'] })
  const client = await createSupabaseServerClient()
  const customerIds = [...new Set(gaps.flatMap(row => row.customer_id ? [row.customer_id] : []))]
  const meterIds = [...new Set(gaps.flatMap(row => row.metering_point_id ? [row.metering_point_id] : []))]
  const [customerLabels, meterLabels] = await Promise.all([
    canReadCustomers && scope.companyId && customerIds.length ? client.from('customers').select('id,full_name,first_name,last_name,company_name,customer_number').eq('company_id', scope.companyId).in('id', customerIds) : Promise.resolve({ data: [], error: null }),
    canReadMetering && scope.companyId && meterIds.length ? client.from('metering_points').select('id,meter_point_id').eq('company_id', scope.companyId).in('id', meterIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (customerLabels.error) throw customerLabels.error
  if (meterLabels.error) throw meterLabels.error
  const customerById = new Map((customerLabels.data ?? []).map(row => [row.id, row]))
  const meterById = new Map((meterLabels.data ?? []).map(row => [row.id, row.meter_point_id]))
  const customerLabel = (id: string | null) => {
    const row = id ? customerById.get(id) : null
    return row ? [row.company_name || row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' '), row.customer_number].filter(Boolean).join(' · ') || 'Kunduppgifter saknas' : canReadCustomers ? 'Kunduppgifter saknas' : 'Kunduppgifter kräver kundläsbehörighet'
  }


  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Mätvärdesperioder"
        subtitle="Kontrollera vilka perioder som saknar mätvärden inför fakturering."
        userEmail={admin.email}
      />

      <div className="min-w-0 space-y-4 p-4 lg:p-6">
        <section className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          {canWrite ? <form action={runBatch2CPeriodMotorAction} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">Automatisk periodkontroll</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Kontrollera perioder</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Kontrollen går igenom bolagets mätpunkter och skapar uppgiftsbegäranden och uppföljningsärenden där värden saknas.</p>
            <div className="mt-5 grid gap-3">
              <label className="text-sm font-medium text-slate-700">Från period<input name="start_month" type="month" defaultValue={monthsBack(11)} className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" /></label>
              <label className="text-sm font-medium text-slate-700">Till period<input name="end_month" type="month" defaultValue={currentMonth()} className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" /></label>
              <button className="rounded-2xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800" disabled={!scope.companyId}>Starta periodkontroll</button>
            </div>
          </form> : <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">Du kan läsa periodkontrollen. En behörig handläggare behöver starta en ny kontroll.</p>}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Öppna mätvärdesluckor</h2>
            <p className="mt-2 text-sm text-slate-700">{gaps.length} luckor kräver komplettering eller inväntan på nätägare.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {canPresentAdminLink(admin, getAdminPageRequirement('outbound.missing_meter_values')) ? <Link href="/admin/outbound/missing-meter-values" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Saknade mätvärden</Link> : null}
              {canPresentAdminLink(admin, getAdminPageRequirement('operations.tasks')) ? <Link href="/admin/operations/tasks" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Driftuppgifter</Link> : null}
              {canPresentAdminLink(admin, getAdminPageRequirement('operations.control_tower')) ? <Link href="/admin/controltower" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Leveransöversikt</Link> : null}
            </div>
          </section>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Periodluckor</h2>
            <p className="mt-1 text-sm text-slate-700">Varje rad kan hanteras separat utan att fakturering för andra kunder stoppas.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {gaps.length === 0 ? <div className="px-6 py-10 text-center text-sm text-slate-600">Inga öppna mätvärdesluckor.</div> : gaps.map((gap) => (
              <div key={gap.source_id} className="grid gap-4 px-6 py-5 text-sm lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-center">
                <div>
                  <div className="font-semibold text-slate-950">{String(gap.payload?.period_month ?? 'Okänd period')}</div>
                  <div className="mt-1 text-xs text-slate-500">{customerLabel(gap.customer_id)}</div>
                </div>
                <div>Mätpunkt: <span className="font-medium text-slate-950">{gap.metering_point_id ? meterById.get(gap.metering_point_id) ?? (canReadMetering ? 'Uppgift saknas' : 'Kräver mätvärdesläsning') : 'Uppgift saknas'}</span></div>
                <div>Uppdaterad {formatDate(gap.updated_at)}{scope.isPlatformAdmin ? <details className="mt-2 text-xs"><summary className="cursor-pointer">Tekniska uppgifter</summary><p className="mt-1 break-all">Kund: {gap.customer_id} · Mätpunkt: {gap.metering_point_id} · Källa: {gap.source_id}</p></details> : null}</div>
                {gap.customer_id && canReadCustomers ? <Link href={`/admin/customers/${gap.customer_id}`} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Öppna kund</Link> : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
