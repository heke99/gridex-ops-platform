import Link from 'next/link'
import type { ReactNode } from 'react'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAutomationDashboard, type EdielAutomationRow } from '@/lib/ediel/operations/automationDashboard'

export const dynamic = 'force-dynamic'

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function dateText(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE')
}

function tone(status: unknown): string {
  const value = String(status ?? '').toLowerCase()
  if (['sent', 'completed', 'success', 'tenant_resolved'].includes(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['queued', 'prepared', 'running', 'manual_review', 'warning'].includes(value)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['failed', 'blocked', 'expired', 'error'].includes(value)) return 'border-red-200 bg-red-50 text-red-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Metric({ label, value, href, severity = 'neutral' }: { label: string; value: number; href?: string; severity?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  const classes = severity === 'bad'
    ? 'border-red-200 bg-red-50 text-red-950'
    : severity === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : severity === 'ok'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
        : 'border-slate-200 bg-white text-slate-950'
  const body = (
    <>
      <p className="text-xs font-black uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </>
  )
  return href ? <Link href={href} className={`rounded-3xl border p-5 shadow-sm ${classes}`}>{body}</Link> : <div className={`rounded-3xl border p-5 shadow-sm ${classes}`}>{body}</div>
}

function Pill({ children, status }: { children: ReactNode; status: unknown }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone(status)}`}>{children}</span>
}

function TraceCard({ row }: { row: EdielAutomationRow }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{text(row.ack_family)} · {text(row.outcome)}</p>
          <h3 className="mt-2 text-lg font-black text-slate-950">{text(row.decision)}</h3>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-700">Regel: {text(row.rule_profile)} · Confidence: {text(row.confidence)}</p>
        </div>
        <Pill status={row.can_auto_send === true ? 'completed' : 'manual_review'}>{row.can_auto_send === true ? 'Auto OK' : 'Review'}</Pill>
      </div>
      <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-3"><span className="font-bold">Källa:</span> {row.source_message_id ? <Link className="text-emerald-700 underline" href={`/admin/ediel/messages/${row.source_message_id}`}>{text(row.source_message_id).slice(0, 8)}</Link> : '—'}</div>
        <div className="rounded-2xl bg-slate-50 p-3"><span className="font-bold">Rule keys:</span> {text(row.backend_rule_keys)}</div>
        <div className="rounded-2xl bg-slate-50 p-3"><span className="font-bold">Skapad:</span> {dateText(row.created_at)}</div>
      </div>
    </article>
  )
}

function QueueRow({ row }: { row: EdielAutomationRow }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-4 py-3"><Pill status={row.status}>{text(row.status)}</Pill></td>
      <td className="px-4 py-3 font-semibold text-slate-950">{text(row.message_family)} {text(row.message_code)}</td>
      <td className="px-4 py-3">{text(row.ack_outcome)}</td>
      <td className="px-4 py-3">{text(row.environment)}</td>
      <td className="px-4 py-3">{text(row.attempts)}</td>
      <td className="px-4 py-3">{row.ediel_message_id ? <Link className="text-emerald-700 underline" href={`/admin/ediel/messages/${row.ediel_message_id}`}>Öppna</Link> : '—'}</td>
    </tr>
  )
}

export default async function EdielAutomationPage() {
  const context = await requirePlatformAdminAccess()
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const dashboard = await getEdielAutomationDashboard({ companyId: isPlatformAdmin ? null : companyScope.companyId, limit: 50 })

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel automation"
        subtitle="Backendbeslut, outbox, SLA, portalfeedback och unresolved i en samlad driftvy. UI visar vad backend har beslutat – inte tvärtom."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <main className="space-y-6 p-8">
        {dashboard.warnings.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            <h2 className="font-black">Migration/åtkomst behöver kontrolleras</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-semibold">
              {dashboard.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
          <Metric label="Decision traces" value={dashboard.metrics.decisionTraces} severity="ok" />
          <Metric label="Manual review" value={dashboard.metrics.manualReviews} severity={dashboard.metrics.manualReviews > 0 ? 'warn' : 'ok'} />
          <Metric label="Outbox kö" value={dashboard.metrics.outboxQueued} href="/admin/ediel/outbox" severity={dashboard.metrics.outboxQueued > 0 ? 'warn' : 'ok'} />
          <Metric label="Outbox fel" value={dashboard.metrics.outboxFailed} href="/admin/ediel/outbox" severity={dashboard.metrics.outboxFailed > 0 ? 'bad' : 'ok'} />
          <Metric label="SLA kritisk" value={dashboard.metrics.slaCritical} severity={dashboard.metrics.slaCritical > 0 ? 'bad' : 'ok'} />
          <Metric label="Portaldiff" value={dashboard.metrics.portalMismatches} href="/admin/ediel/portal-feedback" severity={dashboard.metrics.portalMismatches > 0 ? 'warn' : 'ok'} />
          <Metric label="Unresolved" value={dashboard.metrics.unresolvedOpen} href="/admin/ediel/unresolved" severity={dashboard.metrics.unresolvedOpen > 0 ? 'warn' : 'ok'} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Link href="/admin/ediel/outbox" className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm hover:bg-emerald-50">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Outbox</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Skicka säkra köade ACK</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">CONTRL, APERAK och UTILTS_ERR skickas via backend-controlled queue med dedupe och final-ACK-skydd.</p>
          </Link>
          <Link href="/admin/ediel/portal-feedback" className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm hover:bg-amber-50">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">Portal feedback</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Importera expected/actual</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">Använd när Edielportalen säger godkänt men UI eller regression visar annan diff.</p>
          </Link>
          <Link href="/admin/ediel/unresolved" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm hover:bg-slate-50">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-700">Manual review</p>
            <h2 className="mt-2 text-xl font-black text-slate-950">Unresolved och stopp</h2>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-700">Osäker tenant, route, certifikat, kund eller mätpunkt ska hit och inte autoskickas.</p>
          </Link>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-lg font-black text-slate-950">Senaste backendbeslut</h2>
            {dashboard.decisionTraces.length === 0 ? <p className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Inga decision traces ännu.</p> : null}
            {dashboard.decisionTraces.slice(0, 8).map((row) => <TraceCard key={text(row.id)} row={row} />)}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-950">Outbox snapshot</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500">
                  <tr><th className="px-4 py-3">Status</th><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Miljö</th><th className="px-4 py-3">Försök</th><th className="px-4 py-3">Meddelande</th></tr>
                </thead>
                <tbody>{dashboard.outboxItems.slice(0, 12).map((row) => <QueueRow key={text(row.id)} row={row} />)}</tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
