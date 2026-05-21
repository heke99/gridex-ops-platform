import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { listBatch2BControlTower } from '@/lib/operations/batch2bAutomation'
import { createBillingBlockerCasesAction, runBatch2BAutomationAction } from './actions'

export const dynamic = 'force-dynamic'

function numberValue(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function tone(value: number) {
  return value > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
}

export default async function OperationsAutomationPage({ searchParams }: { searchParams?: Promise<{ status?: string; message?: string }> }) {
  const admin = await requireAdminPageKeyAccess('operations.automation')
  const scope = await getOperationalCompanyScope(admin.userId)
  const rows = scope.companyId ? await listBatch2BControlTower(scope.companyId) : []
  const row = rows[0] ?? null
  const notice = searchParams ? await searchParams : {}

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Automationsmotor"
        subtitle="Kör kund-, avtal-, fullmakts-, mätvärdes- och faktureringsautomation utan att stoppa hela driftflödet när en enskild rad har fel."
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
            Automation körs alltid tenant-säkert mot ett bolag. Den skapar inte live-utskick direkt, utan köar requests, flaggar blockerare och skapar ärenden för rader som behöver manuell granskning.
          </p>
          {scope.message ? <p className="mt-3 text-sm font-semibold text-amber-800">{scope.message}</p> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(row?.open_outbound_count))}`}>
            <div className="text-sm font-medium">Öppna outbound</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(row?.open_outbound_count)}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(row?.open_case_count))}`}>
            <div className="text-sm font-medium">Öppna ärenden</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(row?.open_case_count)}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(row?.blocked_export_rows))}`}>
            <div className="text-sm font-medium">Blockerade exportrader</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(row?.blocked_export_rows)}</div>
          </div>
          <div className={`rounded-3xl border p-5 shadow-sm ${tone(numberValue(row?.failed_import_rows))}`}>
            <div className="text-sm font-medium">Importfel</div>
            <div className="mt-2 text-3xl font-semibold">{numberValue(row?.failed_import_rows)}</div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <form action={runBatch2BAutomationAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Batch 2B</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Kör full automationspass</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Skannar avtal/kunder, skapar uppgiftsbegäran, köar saknade mätvärden och skapar kundärenden för blockerade faktureringsrader. Enstaka felrader stoppar inte hela perioden.
            </p>
            <button className="mt-5 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!scope.companyId}>
              Kör automationspass
            </button>
          </form>

          <form action={createBillingBlockerCasesAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Blockers till ärenden</p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">Skapa ärenden för blockerade rader</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Läser blockerade export-/underlagsrader och skapar kundärenden som ekonomi/kundservice kan följa upp utan att övriga kunder blockeras.
            </p>
            <button className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={!scope.companyId}>
              Skapa blockerärenden
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Nästa steg i drift</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Link href="/admin/outbound/missing-meter-values" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Saknade mätvärden</Link>
            <Link href="/admin/billing/export-center" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Exportcenter</Link>
            <Link href="/admin/customer-cases" className="rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Kundärenden</Link>
          </div>
        </section>
      </div>
    </div>
  )
}
