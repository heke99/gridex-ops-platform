import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAutomationDashboard, type EdielAutomationRow } from '@/lib/ediel/operations/automationDashboard'
import { importPortalValidationFeedbackAction } from '@/app/admin/ediel/portal-feedback/actions'

export const dynamic = 'force-dynamic'

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function dateText(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE')
}

function statusTone(value: unknown): string {
  const status = String(value ?? '').toLowerCase()
  if (status === 'passed') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'warning' || status === 'unknown') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function FeedbackRow({ row }: { row: EdielAutomationRow }) {
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(row.status)}`}>{text(row.status)}</span></td>
      <td className="px-4 py-4 font-black text-slate-950">{text(row.test_case_code)}<div className="mt-1 text-xs font-medium text-slate-500">Steg {text(row.step)}</div></td>
      <td className="px-4 py-4 text-sm text-slate-700">{text(row.expected_ack_type)} · {text(row.expected_outcome)}<br />ERC {text(row.expected_erc)} · FTX {text(row.expected_ftx)}</td>
      <td className="px-4 py-4 text-sm text-slate-700">{text(row.actual_ack_type)} · {text(row.actual_outcome)}<br />ERC {text(row.actual_erc)} · FTX {text(row.actual_ftx)}</td>
      <td className="px-4 py-4 text-sm text-red-700">{text(row.diff)}</td>
      <td className="px-4 py-4 text-sm text-slate-600">{dateText(row.created_at)}{row.ediel_message_id ? <><br /><Link className="text-emerald-700 underline" href={`/admin/ediel/messages/${row.ediel_message_id}`}>Öppna meddelande</Link></> : null}</td>
    </tr>
  )
}

export default async function EdielPortalFeedbackPage() {
  const context = await requirePlatformAdminAccess()
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const dashboard = await getEdielAutomationDashboard({ companyId: isPlatformAdmin ? null : companyScope.companyId, limit: 100 })

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel portal-feedback"
        subtitle="Importera Edielportalens expected/actual-rapport och låt systemet spara facit, diff och regression-kandidater."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <main className="space-y-6 p-8">
        <section className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <form action={importPortalValidationFeedbackAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">Import</p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">Klistra in portalrapport</h1>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
              Använd detta när portalen säger godkänt/misslyckat och vi vill jämföra expected/actual mot backendbeslut. Det här är hur E6-lärdomen ska sparas framåt.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <label className="text-sm font-bold text-slate-700">Meddelande-ID, frivilligt<input name="edielMessageId" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 font-normal" /></label>
              <label className="text-sm font-bold text-slate-700">Test run-ID, frivilligt<input name="testRunId" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 font-normal" /></label>
            </div>
            {isPlatformAdmin ? <label className="mt-3 block text-sm font-bold text-slate-700">Company-ID, frivilligt<input name="companyId" className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 font-normal" /></label> : <input type="hidden" name="companyId" value={companyScope.companyId ?? ''} />}
            <label className="mt-4 block text-sm font-bold text-slate-700">
              Portalrapport
              <textarea name="rawReport" rows={14} className="mt-1 w-full rounded-2xl border border-slate-300 px-3 py-2 font-mono text-xs font-normal" placeholder="Klistra in tabellen/loggen från Edielportalen här..." />
            </label>
            <button type="submit" className="mt-4 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">Importera feedback</button>
          </form>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-950 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em]">Så ska detta användas</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Portalen kan vara facit när UI diffar fel</h2>
            <p className="mt-3 text-sm font-semibold leading-6">
              Om portalen godkänner ett meddelande men Gridex UI visar mismatch ska det inte lösas med hårdkodning. Importera rapporten, skapa rule_conflict/portal_expected_actual_mismatch och uppdatera regression/facit så backendbeslut vinner framåt.
            </p>
            <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-2xl bg-white/70 p-4"><strong>Skyddar:</strong><br />E6, Z14/Z15/Z18, UTILTS APERAK/UTILTS_ERR.</div>
              <div className="rounded-2xl bg-white/70 p-4"><strong>Blockerar:</strong><br />UI som tvingar positive/negative mot backend.</div>
            </div>
          </section>
        </section>

        {dashboard.warnings.length > 0 ? <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">{dashboard.warnings.join(' · ')}</section> : null}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-black text-slate-950">Importerad portalfeedback</h2>
            <p className="mt-1 text-sm text-slate-600">Expected/actual sparas per steg och kan användas som regression-kandidat.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr><th className="px-4 py-3">Status</th><th className="px-4 py-3">Test</th><th className="px-4 py-3">Expected</th><th className="px-4 py-3">Actual</th><th className="px-4 py-3">Diff</th><th className="px-4 py-3">Tid</th></tr>
              </thead>
              <tbody>
                {dashboard.portalFeedback.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={6}>Ingen portalfeedback importerad ännu.</td></tr> : null}
                {dashboard.portalFeedback.map((row) => <FeedbackRow key={text(row.id)} row={row} />)}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
