import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAutomationDashboard, type EdielAutomationRow } from '@/lib/ediel/operations/automationDashboard'
import { processEdielOutboxAction, sendSingleEdielOutboxItemAction } from '@/app/admin/ediel/outbox/actions'

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
  if (status === 'sent') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['prepared', 'queued', 'sending'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['failed', 'blocked'].includes(status)) return 'border-red-200 bg-red-50 text-red-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function canSend(row: EdielAutomationRow): boolean {
  return ['prepared', 'queued', 'failed'].includes(String(row.status ?? '').toLowerCase())
}

function OutboxRow({ row }: { row: EdielAutomationRow }) {
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-4 py-4"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(row.status)}`}>{text(row.status)}</span></td>
      <td className="px-4 py-4">
        <div className="font-black text-slate-950">{text(row.message_family)} {text(row.message_code)}</div>
        <div className="mt-1 text-xs text-slate-500">Outcome: {text(row.ack_outcome)} · Miljö: {text(row.environment)}</div>
      </td>
      <td className="px-4 py-4 text-sm text-slate-700">{text(row.attempts)}</td>
      <td className="px-4 py-4 text-sm text-slate-700">{dateText(row.created_at)}<br />{row.sent_at ? <span>Skickat: {dateText(row.sent_at)}</span> : null}</td>
      <td className="px-4 py-4 text-sm text-red-700">{text(row.last_error)}</td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {row.ediel_message_id ? <Link className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50" href={`/admin/ediel/messages/${row.ediel_message_id}`}>Meddelande</Link> : null}
          {canSend(row) ? (
            <form action={sendSingleEdielOutboxItemAction}>
              <input type="hidden" name="outboxItemId" value={text(row.id)} />
              <button type="submit" className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800">Skicka denna</button>
            </form>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

export default async function EdielOutboxPage() {
  const context = await requirePlatformAdminAccess()
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const dashboard = await getEdielAutomationDashboard({ companyId: isPlatformAdmin ? null : companyScope.companyId, limit: 100 })
  const queued = dashboard.outboxItems.filter((row) => ['prepared', 'queued', 'failed'].includes(String(row.status ?? '').toLowerCase()))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel outbox"
        subtitle="Backendkontrollerad kö för CONTRL, APERAK och UTILTS_ERR. Den skyddar mot dubbla ACK:ar och skickar bara via befintlig SMTP-/route-preflight."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Outbox processor</p>
              <h1 className="mt-2 text-2xl font-black text-slate-950">{queued.length} poster redo för kontroll/skick</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-700">
                Kör detta efter inbound-synk eller via cron/API-runner. Själva SMTP-skicket använder samma transport- och certifikatskydd som vanliga Ediel-send.
              </p>
            </div>
            <form action={processEdielOutboxAction} className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                Miljö
                <select name="environment" className="mt-1 block rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal">
                  <option value="">Alla</option>
                  <option value="test">Test</option>
                  <option value="production">Produktion</option>
                </select>
              </label>
              <label className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
                Limit
                <input name="limit" defaultValue="10" className="mt-1 block w-20 rounded-2xl border border-slate-300 px-3 py-2 text-sm normal-case tracking-normal" />
              </label>
              <button type="submit" className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">Processa kö</button>
            </form>
          </div>
        </section>

        {dashboard.warnings.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {dashboard.warnings.join(' · ')}
          </section>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-black text-slate-950">Outbox-poster</h2>
            <p className="mt-1 text-sm text-slate-600">Statusar: prepared/queued/sending/sent/failed/blocked/superseded.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                <tr><th className="px-4 py-3">Status</th><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Försök</th><th className="px-4 py-3">Tid</th><th className="px-4 py-3">Fel</th><th className="px-4 py-3">Åtgärd</th></tr>
              </thead>
              <tbody>
                {dashboard.outboxItems.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={6}>Inga outbox-poster.</td></tr> : null}
                {dashboard.outboxItems.map((row) => <OutboxRow key={text(row.id)} row={row} />)}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
