import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listBatch2BControlTower } from '@/lib/operations/batch2bAutomation'
import { listBatch2CControlTowerSummary } from '@/lib/operations/batch2cAutomation'
import {
  createBatch2CQueueCasesAction,
  createBillingBlockerCasesAction,
  runBatch2BAutomationAction,
  runBatch2CPeriodMotorAction,
} from './actions'

export const dynamic = 'force-dynamic'

function numberValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function tone(value: number) {
  return value > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function monthsBack(count: number) {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1)).toISOString().slice(0, 7)
}

export default async function OperationsAutomationPage({ searchParams }: { searchParams?: Promise<{ status?: string; message?: string }> }) {
  const admin = await requireAdminPageKeyAccess('operations.automation')
  const scope = await getOperationalCompanyScope(admin.userId)
  const [batch2BRows, batch2CRows] = scope.companyId
    ? await Promise.all([listBatch2BControlTower(scope.companyId), listBatch2CControlTowerSummary(scope.companyId)])
    : [[], []]
  const row = batch2BRows[0] ?? null
  const summary = batch2CRows[0] ?? null
  const notice = searchParams ? await searchParams : {}

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Automationsmotor"
        subtitle="Kör kund-, avtals-, mätvärdes-, blocker- och exportautomation utan att stoppa hela driftflödet när en enskild rad har fel."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        {notice?.message ? (
          <div className={`rounded-3xl border p-5 text-sm font-semibold ${notice.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {notice.message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Operativt bolag</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">{scope.companyName ?? 'Bolagskoppling saknas'}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Automation körs tenant-säkert mot ett bolag. Batch 2C skannar valfria perioder, skapar mätvärdesluckor, köar requests och kopplar alla blockerare till driftuppgifter.
          </p>
          {scope.message ? <p className="mt-3 text-sm font-semibold text-amber-800">{scope.message}</p> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(summary?.open_queue_count))}`}>
            <div className="text-sm font-medium">Öppna driftköer</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(summary?.open_queue_count)}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(summary?.critical_queue_count))}`}>
            <div className="text-sm font-medium">Kritiska köer</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(summary?.critical_queue_count)}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(summary?.open_metering_gap_count))}`}>
            <div className="text-sm font-medium">Mätvärdesluckor</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(summary?.open_metering_gap_count)}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(summary?.blocked_export_row_count))}`}>
            <div className="text-sm font-medium">Blockerade exportrader</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(summary?.blocked_export_row_count)}</div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <form action={runBatch2BAutomationAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Batch 2B</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Kör grundautomation</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Skannar avtal/kunder, skapar uppgiftsbegäran, köar saknade mätvärden för standardperioden och skapar driftuppgifter för blockerade faktureringsrader.
            </p>
            <button className="mt-5 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!scope.companyId}>
              Kör grundautomation
            </button>
          </form>

          <form action={runBatch2CPeriodMotorAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800">Batch 2C</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Kör full periodmotor</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Skannar alla mätpunkter över valt intervall, skapar en lucka per saknad period, köar outbound request och kopplar blockerare till kundärende.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Från period
                <input name="start_month" type="month" defaultValue={monthsBack(11)} className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Till period
                <input name="end_month" type="month" defaultValue={currentMonth()} className="mt-2 h-11 w-full rounded-2xl border border-slate-300 px-4 text-sm" />
              </label>
            </div>
            <button className="mt-5 rounded-2xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!scope.companyId}>
              Kör periodmotor
            </button>
          </form>

          <form action={createBillingBlockerCasesAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Blockerare till driftuppgifter</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Skapa driftuppgifter för blockerade exportrader</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Läser blockerade export-/underlagsrader och skapar driftuppgifter som ekonomi och driftansvariga kan följa upp utan att övriga kunder blockeras.
            </p>
            <button className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={!scope.companyId}>
              Skapa driftuppgifter
            </button>
          </form>

          <form action={createBatch2CQueueCasesAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-800">Driftköer</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Koppla alla driftköer till driftuppgifter</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Skapar eller återanvänder driftuppgifter för mätvärdesluckor, partnerexportfel, externa avtalsintag och övriga blockerare i Batch 2C Control Tower.
            </p>
            <button className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={!scope.companyId}>
              Koppla driftköer
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Nästa steg i drift</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Link href="/admin/controltower" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Control Tower</Link>
            <Link href="/admin/operations/perioder" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Periodluckor</Link>
            <Link href="/admin/billing/export-center" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Exportcenter</Link>
            <Link href="/admin/operations/tasks" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Driftuppgifter</Link>
          </div>
        </section>

        {row ? (
          <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">
            Äldre Batch 2B-status: {numberValue(row.open_outbound_count)} öppna outbound, {numberValue(row.open_case_count)} öppna driftuppgifter, {numberValue(row.failed_import_rows)} importfel.
          </section>
        ) : null}
      </div>
    </div>
  )
}
