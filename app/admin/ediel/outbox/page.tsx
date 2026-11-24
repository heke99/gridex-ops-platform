import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { isPlatformAdminContext, requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listEdielOutboxBatches } from '@/lib/ediel/outbox/batchJournal'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { getEdielAutomationDashboard, getEdielOutboxWorkload, OUTBOX_PROBLEM_STATUSES, OUTBOX_READY_STATUSES, type EdielAutomationRow } from '@/lib/ediel/operations/automationDashboard'
import { sendSingleEdielOutboxItemAction } from '@/app/admin/ediel/outbox/actions'
import { DELIVERY_UNCERTAIN_OUTBOX_SECTION, isEdielOutboxArchiveHeld, readEdielOutboxReconciliation } from '@/lib/ediel/outbox/readDeliveryUncertain'

import ProcessOutboxForm from './queue-form'

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
  if (['prepared', 'queued', 'sending', 'delivery_uncertain'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (OUTBOX_PROBLEM_STATUSES.includes(status)) return 'border-red-200 bg-red-50 text-red-900'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function outboxEnvironment(row: EdielAutomationRow) {
  const { environment } = row
  return environment === 'production' || environment === 'test' ? environment : null
}

function canSend(row: EdielAutomationRow): boolean {
  return outboxEnvironment(row) !== null && typeof row.status === 'string' && OUTBOX_READY_STATUSES.includes(row.status)
}

function lockText(row: EdielAutomationRow): string | null {
  if (!row.locked_at) return null
  return `Låst ${dateText(row.locked_at)}${row.locked_by ? ` av ${text(row.locked_by)}` : ''}`
}

function OutboxRow({ row }: { row: EdielAutomationRow }) {
  const lock = lockText(row)
  const deliveryUncertain = row.status === 'delivery_uncertain'
  const archiveHeld = isEdielOutboxArchiveHeld(row)
  const statusLabel = archiveHeld ? 'Arkivspärr' : deliveryUncertain ? 'Leveransoviss' : text(row.status)
  const errorLabel = archiveHeld
    ? 'Arkivkopian för sändningsförsöket kunde inte verifieras. Kontrollera arkivet före avstämning.'
    : deliveryUncertain ? 'Leveransen behöver stämmas av.' : text(row.last_error)
  const messageLinkLabel = archiveHeld ? 'Öppna meddelandets arkiv'
    : deliveryUncertain ? 'Öppna meddelande för avstämning' : 'Meddelande'
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-4 py-4">
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone(row.status)}`}>{statusLabel}</span>
        {lock ? <div className="mt-1 text-[11px] font-medium text-slate-500">{lock}</div> : null}
      </td>
      <td className="px-4 py-4">
        <div className="font-black text-slate-950">{text(row.message_family)} {text(row.message_code)}</div>
        <div className="mt-1 text-xs text-slate-500">Outcome: {text(row.ack_outcome)} · Miljö: {text(row.environment)}</div>
      </td>
      <td className="px-4 py-4 text-sm text-slate-700">{text(row.attempts)}</td>
      <td className="px-4 py-4 text-sm text-slate-700">{deliveryUncertain || archiveHeld ? `Uppdaterad: ${dateText(row.updated_at)}` : <>{dateText(row.created_at)}<br />{row.sent_at ? <span>Skickat: {dateText(row.sent_at)}</span> : null}</>}</td>
      <td className="px-4 py-4 text-sm text-red-700">
        {errorLabel}
        {archiveHeld && typeof row.current_send_attempt_id === 'string'
          ? <p className="mt-1 break-all text-xs text-slate-700">Köförsök {row.current_send_attempt_id}</p> : null}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {row.ediel_message_id ? <Link className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50" href={`/admin/ediel/messages/${row.ediel_message_id}`}>{messageLinkLabel}</Link> : null}
          {deliveryUncertain && typeof row.id === 'string' && typeof row.current_send_attempt_id === 'string'
            ? <Link href={`/admin/ediel/outbox/${row.id}/attempt/${row.current_send_attempt_id}`} className="underline">Öppna sändningsförsök</Link> : null}
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

type Workload = Awaited<ReturnType<typeof getEdielOutboxWorkload>>['production']

function WorkloadStatus({ ready, problems }: Workload) {
  const listIsBounded = [ready, problems].some(work => !work.warning && work.count !== null && work.count > work.rows.length)
  return (
    <div className="mt-2 space-y-1 text-sm text-slate-700">
      <p>{ready.count === null ? 'Antalet i sändkön kunde inte läsas.' : `${ready.count} i sändkö`}</p>
      <p>{problems.count === null ? 'Antalet med fel eller spärr kunde inte läsas.' : `${problems.count} med fel eller spärr`}</p>
      {ready.warning ? <p role="status">{ready.warning}</p> : null}
      {problems.warning ? <p role="status">{problems.warning}</p> : null}
      {listIsBounded ? <p>Tabellen visar ett begränsat urval.</p> : null}
    </div>
  )
}

function OutboxSection({ id, title, subtitle, tone, rows, workload, emptyMessage = 'Inga outbox-poster i urvalet.' }: { id?: string; title: string; subtitle: string; tone: string; rows: EdielAutomationRow[]; workload?: Workload; emptyMessage?: string }) {
  const listIncomplete = workload?.ready.warning || workload?.problems.warning
  return (
    <section id={id} aria-label={title} className={`overflow-hidden rounded-3xl border ${tone} shadow-sm`}>
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        {workload ? <WorkloadStatus {...workload} /> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
            <tr><th className="px-4 py-3">Status</th><th className="px-4 py-3">Typ</th><th className="px-4 py-3">Försök</th><th className="px-4 py-3">Tid</th><th className="px-4 py-3">Fel / send-guard</th><th className="px-4 py-3">Åtgärd</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="px-4 py-6 text-slate-500" colSpan={6}><span role="status">{listIncomplete ? 'Urvalet av outbox-poster är ofullständigt.' : emptyMessage}</span></td></tr> : null}
            {rows.map((row) => <OutboxRow key={text(row.id)} row={row} />)}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function outcomeText(outcome: string | null, delivery: string | null) {
  switch (outcome) {
    case 'sent': return delivery === 'repaired_projection' ? 'Tidigare SMTP-status återställd' : 'SMTP accepterade utskicket'
    case 'delivery_uncertain': return 'Osäker leverans. Granska före ny sändning.'
    case 'blocked_tenant_state': return 'Blockerad av bolagets driftstatus'
    case 'blocked': return 'Sändning blockerad'
    case 'failed': return 'Sändningsförsöket misslyckades'
    case 'local_projection_held': return 'Lokalt fel. Posten kräver granskning.'
    case 'dependency_held': return 'Gemensamt fel. Posten kräver granskning.'
    case 'released_unstarted': return 'Åter i kön före sändning'
    case 'released_before_provider_entry': return 'Åter i kön efter verifierad frigivning före SMTP-inträde'
    default: return 'Utfall ännu ej bekräftat'
  }
}

export default async function EdielOutboxPage() {
  const context = await requirePlatformAdminAccess()
  const isPlatformAdmin = isPlatformAdminContext(context)
  const companyScope = await getOperationalCompanyScope(context.userId)
  const [dashboard, reconciliation, workload, runs] = await Promise.all([
    getEdielAutomationDashboard({ companyId: companyScope.companyId, limit: 100 }),
    readEdielOutboxReconciliation(companyScope.companyId),
    getEdielOutboxWorkload(companyScope.companyId),
    listEdielOutboxBatches(context.userId, companyScope.companyId).catch(() => null),
  ])
  const reconciliationIds = new Set(reconciliation?.rows.map((row) => row.id))
  const recentById = new Map(dashboard.outboxItems.map(row => [row.id, row]))
  const recentHistory = dashboard.outboxItems.filter(row => {
    const environment = outboxEnvironment(row)
    if (!environment) return true
    const { ready, problems } = workload[environment]
    if (canSend(row)) return Boolean(ready.warning)
    if (typeof row.status === 'string' && OUTBOX_PROBLEM_STATUSES.includes(row.status)) return Boolean(problems.warning)
    return true
  })
  const readyRows = [...workload.production.ready.rows, ...workload.test.ready.rows].map(row => {
    const recent = recentById.get(row.id)
    return recent && !canSend(recent) ? recent : row
  })
  // Separate reads may see different statuses for one ID. Keep reconciliation
  // first. Give problems precedence over ready and recent rows in this view.
  const visible = new Map<unknown, EdielAutomationRow>()
  for (const row of [
    ...workload.production.problems.rows, ...workload.test.problems.rows,
    ...readyRows, ...recentHistory,
  ]) {
    if (!visible.has(row.id) && (typeof row.id !== 'string' || !reconciliationIds.has(row.id))) visible.set(row.id, row)
  }
  const recentItems = Array.from(visible.values())
  const productionReady = workload.production.ready.count
  const testReady = workload.test.ready.count
  const readyCount = productionReady === null || testReady === null ? null : productionReady + testReady
  const productionItems = recentItems.filter(row => outboxEnvironment(row) === 'production')
  const testItems = recentItems.filter(row => outboxEnvironment(row) === 'test')
  const otherItems = recentItems.filter(row => outboxEnvironment(row) === null)
  const reconciliationCount = reconciliation?.rows.length ?? 0
  const reconciliationSubtitle = reconciliation?.truncated
    ? reconciliation.count != null
      ? `Visar ${reconciliationCount} av ${reconciliation.count} poster för avstämning.`
      : `Visar de ${reconciliationCount} senast uppdaterade posterna.`
    : reconciliationCount > 0
      ? `${reconciliationCount} ${reconciliationCount === 1 ? 'post visas' : 'poster visas'} för avstämning.`
      : 'Leveransovissa och arkivspärrade kvittenser behöver avstämning.'

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
              <h1 className="mt-2 text-2xl font-black text-slate-950">{readyCount === null ? 'Antalet redo för kontroll/skick är okänt' : `${readyCount} poster redo för kontroll/skick`}</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-700">
                Kör detta efter inbound-synk eller via cron/API-runner. Själva SMTP-skicket använder samma transport- och certifikatskydd som vanliga Ediel-send.
              </p>
            </div>
            <ProcessOutboxForm />
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">Dina senaste utkörningar</h2>
          {runs === null ? <p role="status">Körningskvittona kunde inte hämtas.</p> : runs.length === 0 ? (
            <p>Inga utkörningar i aktuell omfattning.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {runs.map(run => (
                <li key={run.runId}>
                  <details>
                    <summary>
                      <time dateTime={run.startedAt}>{run.startedAt}</time>{' · '}
                      {run.environment === 'production' ? 'Produktion' : run.environment === 'test' ? 'Test' : 'Alla miljöer'}{' · '}
                      {run.stoppedBy === 'dependency_failure' ? 'Avbruten vid gemensamt fel' : run.finishedAt ? 'Avslutad' : 'Avslut ej bekräftat'}
                      {run.remainingReady === null ? '' : ` · ${run.remainingReady} kvar i kön`}
                    </summary>
                    <p>Körningsreferens <code>{run.runId}</code></p>
                    {run.items.length > 0 ? <ul>
                      {run.items.map(item => (
                        <li key={item.attemptId}>
                          <code>{item.outboxId}</code>{' · '}
                          {outcomeText(item.outcome, item.delivery)}
                        </li>
                      ))}
                    </ul> : null}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        {dashboard.warnings.length > 0 ? (
          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {dashboard.warnings.join(' · ')}
          </section>
        ) : null}

        <OutboxSection
          id={DELIVERY_UNCERTAIN_OUTBOX_SECTION}
          title="Avstämningsbehov"
          subtitle={reconciliationSubtitle}
          tone="border-amber-200 bg-amber-50/40"
          rows={reconciliation?.rows ?? []}
          emptyMessage={reconciliation ? 'Inga leveransovissa eller arkivspärrade poster att stämma av.' : 'Avstämningsbehovet kunde inte läsas.'}
        />

        <OutboxSection
          title="Produktions-outbox"
          subtitle="Produktionsskick är låst tills send-guard passerar (företagsscope, produktions-route, produktions-avsändare, produktionsgodkännande, certifikat). Send-guardens orsak visas i felkolumnen. Produktionsgodkännande sker på route-readiness, inte här."
          tone="border-amber-200 bg-amber-50/40"
          rows={productionItems}
          workload={workload.production}
        />

        <OutboxSection
          title="Test-outbox"
          subtitle="Testskick använder enbart test-route och test-avsändare och kräver aldrig produktionsgodkännande."
          tone="border-sky-200 bg-sky-50/40"
          rows={testItems}
          workload={workload.test}
        />

        {otherItems.length > 0 ? (
          <OutboxSection
            title="Outbox utan tydlig miljö"
            subtitle="Poster utan giltig miljö behöver granskas före sändning."
            tone="border-slate-200 bg-white"
            rows={otherItems}
          />
        ) : null}
      </main>
    </div>
  )
}
