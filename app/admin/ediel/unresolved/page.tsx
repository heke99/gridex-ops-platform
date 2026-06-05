import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAutomationDashboard, type EdielAutomationRow } from '@/lib/ediel/operations/automationDashboard'

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

function tone(value: unknown): string {
  const status = String(value ?? '').toLowerCase()
  if (['resolved', 'closed', 'done'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['failed', 'blocked', 'error'].includes(status)) return 'border-red-200 bg-red-50 text-red-900'
  return 'border-amber-200 bg-amber-50 text-amber-900'
}

function normalizedReason(row: EdielAutomationRow): string {
  return text(row.issue_type ?? row.reason ?? row.status ?? 'manual_review')
}

export default async function EdielUnresolvedPage() {
  const context = await requirePlatformAdminAccess()
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const dashboard = await getEdielAutomationDashboard({ companyId: isPlatformAdmin ? null : companyScope.companyId, limit: 100 })

  const unresolved = dashboard.unresolvedItems
  const traceManualReviews = dashboard.decisionTraces.filter((row) => {
    const decision = String(row.decision ?? '').toLowerCase()
    return decision.includes('manual') || row.can_auto_send === false
  })
  const failedOutbox = dashboard.outboxItems.filter((row) => ['failed', 'blocked'].includes(String(row.status ?? '').toLowerCase()))
  const criticalSla = dashboard.slaTimers.filter((row) => {
    const status = String(row.status ?? '').toLowerCase()
    const dueAt = typeof row.due_at === 'string' ? Date.parse(row.due_at) : NaN
    return ['critical', 'expired'].includes(status) || (!Number.isNaN(dueAt) && dueAt <= Date.now())
  })

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel unresolved"
        subtitle="Osäker tenant, route, certifikat, kund, mätpunkt, process, portal-diff eller ACK-konflikt ska stoppas här – inte autoskickas."
        userEmail={context.email}
        workspaceName={isPlatformAdmin ? 'Gridex Platform' : companyScope.companyName}
        workspaceMode={isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <main className="space-y-6 p-8">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950"><p className="text-xs font-black uppercase tracking-[0.18em]">Unresolved</p><p className="mt-2 text-3xl font-black">{unresolved.length}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-white p-5 text-slate-950"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Manual decisions</p><p className="mt-2 text-3xl font-black">{traceManualReviews.length}</p></div>
          <Link href="/admin/ediel/outbox" className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950"><p className="text-xs font-black uppercase tracking-[0.18em]">Outbox stopp</p><p className="mt-2 text-3xl font-black">{failedOutbox.length}</p></Link>
          <Link href="/admin/ediel/automation" className="rounded-3xl border border-red-200 bg-white p-5 text-slate-950"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">SLA kritisk</p><p className="mt-2 text-3xl font-black">{criticalSla.length}</p></Link>
        </section>

        {dashboard.warnings.length > 0 ? <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">{dashboard.warnings.join(' · ')}</section> : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-black text-slate-950">Köer som ska granskas</h1>
          <p className="mt-2 max-w-4xl text-sm font-medium leading-6 text-slate-700">
            Tenant-admin får bara se sådant som säkert tillhör bolaget. Platform-only unresolved ska ligga hos superadmin tills tenant, route och affärskoppling är säker.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold">
            <Link className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50" href="/admin/ediel/automation">Automation</Link>
            <Link className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50" href="/admin/ediel/outbox">Outbox</Link>
            <Link className="rounded-full border border-slate-200 px-3 py-1 text-slate-700 hover:bg-slate-50" href="/admin/ediel/portal-feedback">Portal-feedback</Link>
          </div>
        </section>

        <section className="space-y-4">
          {unresolved.length === 0 ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950"><h2 className="font-black">Ingen unresolved tenant-/route-post hittad.</h2></div> : null}
          {unresolved.map((item) => (
            <article key={text(item.id)} className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tone(item.status)}`}>{normalizedReason(item)} · {text(item.status ?? 'open')}</span>
                  <h2 className="mt-3 text-lg font-black text-slate-950">{text(item.title ?? 'Behöver granskas')}</h2>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-700">{text(item.description ?? 'Säker automatisk matchning saknas.')}</p>
                </div>
                {item.ediel_message_id ? <Link className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-bold text-white" href={`/admin/ediel/messages/${item.ediel_message_id}`}>Öppna meddelande</Link> : null}
              </div>
              <p className="mt-3 text-xs text-slate-500">Bolag: {text(item.company_id)} · Miljö: {text(item.environment)} · {dateText(item.created_at)}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
