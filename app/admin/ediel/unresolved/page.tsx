import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAutomationDashboard } from '@/lib/ediel/operations/automationDashboard'

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

export default async function EdielUnresolvedPage() {
  const context = await requirePlatformAdminAccess()
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const dashboard = await getEdielAutomationDashboard({ companyId: companyScope.companyId, limit: 100 })

  const unresolved = dashboard.unresolvedItems
  const unresolvedOpen = dashboard.metrics.unresolvedOpen
  const traceManualReviews = dashboard.decisionTraces.filter((row) => {
    const decision = String(row.decision ?? '').toLowerCase()
    return decision.includes('manual') || row.can_auto_send === false
  })
  const failedOutbox = dashboard.outboxItems.filter((row) => ['failed', 'blocked'].includes(String(row.status ?? '').toLowerCase()))
  const criticalSlaCount = dashboard.metrics.slaCritical

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Osäkra matchningar"
        subtitle="Meddelanden där bolag, route, kund eller mätpunkt inte kunde avgöras säkert. De skickas inte automatiskt."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <main className="space-y-6 p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><p className="text-xs font-black uppercase tracking-[0.18em]">Unresolved</p><p className="mt-2 text-3xl font-black">{unresolvedOpen ?? 'Okänt'}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-white p-5 text-slate-950"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Manual decisions</p><p className="mt-2 text-3xl font-black">{traceManualReviews.length}</p></div>
          <Link href="/admin/ediel/outbox" className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950"><p className="text-xs font-black uppercase tracking-[0.18em]">Outbox stopp</p><p className="mt-2 text-3xl font-black">{failedOutbox.length}</p></Link>
          <Link href="/admin/ediel/automation" className={`rounded-3xl border bg-white p-5 text-slate-950 ${criticalSlaCount ? 'border-red-200' : 'border-slate-200'}`}>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">SLA kritisk</p>
            <p className="mt-2 text-3xl font-black">{criticalSlaCount ?? 'Okänt'}</p>
          </Link>
        </section>

        {dashboard.warnings.length > 0 ? <section role="status" className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">{dashboard.warnings.join(' · ')}</section> : null}

        <div className="flex flex-wrap gap-2 text-sm font-bold">
          <Link className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50" href="/admin/ediel/portal-feedback">Portalfeedback</Link>
        </div>

        <section className="space-y-4">
          {unresolvedOpen === 0 ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950"><h2 className="font-black">Inga osäkra matchningar just nu.</h2></div> : null}
          {unresolved.map((item) => {
            const messageId = item.source_message_id ?? item.ediel_message_id
            return (
              <article key={text(item.id)} className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900">{text(item.issue_type)} · {text(item.status)}</span>
                    <h2 className="mt-3 text-lg font-black text-slate-950">Behöver granskas</h2>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-700">Säker automatisk matchning saknas.</p>
                  </div>
                  {typeof messageId === 'string' && messageId ? <Link className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white" href={`/admin/ediel/messages/${messageId}`}>Öppna meddelande</Link> : null}
                </div>
                <p className="mt-3 text-xs text-slate-500">Bolag: {text(item.company_id)} · Miljö: {text(item.environment)} · {dateText(item.created_at)}</p>
              </article>
            )
          })}
        </section>
      </main>
    </div>
  )
}
