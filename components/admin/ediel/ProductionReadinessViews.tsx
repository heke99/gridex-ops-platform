import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  activateLiveEdielAction,
  approveFirstLiveSendAction,
  pauseProductionEdielAction,
  resumeProductionEdielAction,
  runProductionDryRunAction,
  runProductionReadinessAction,
} from '@/app/admin/platform/actor-testing/actions'
import type { ProductionReadinessIssue, ProductionReadinessResult, ProductionReadinessStatus } from '@/lib/ediel/productionReadiness'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function statusLabel(status: ProductionReadinessStatus) {
  const labels: Record<ProductionReadinessStatus, string> = {
    not_ready: 'Ej konfigurerad',
    warning: 'Varningar kvar',
    ready: 'Redo för production',
    live: 'Live i production',
    paused: 'Production pausad',
    blocked: 'Production blockerad',
  }
  return labels[status]
}

function toneForStatus(status: ProductionReadinessStatus) {
  if (status === 'ready' || status === 'live') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'warning' || status === 'paused') return 'border-amber-200 bg-amber-50 text-amber-900'
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{children}</span>
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-950">{value || '–'}</div>
    </div>
  )
}

function IssueList({ title, issues, tone }: { title: string; issues: ProductionReadinessIssue[]; tone: 'red' | 'amber' | 'emerald' }) {
  const styles = {
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }
  return (
    <div className={`rounded-2xl border p-5 ${styles[tone]}`}>
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6">
        {issues.length === 0 ? <li>Inga poster.</li> : issues.map((issue) => <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>)}
      </ul>
    </div>
  )
}

export function ProductionReadinessPanel({
  readiness,
  returnPath,
  canManageProduction,
}: {
  readiness: ProductionReadinessResult
  returnPath: string
  canManageProduction: boolean
}) {
  const s = readiness.summary
  const canActivate = canManageProduction && readiness.blockingIssues.length === 0 && readiness.status !== 'live'
  const canResume = canManageProduction && readiness.status === 'paused'
  const canPause = canManageProduction && (readiness.status === 'live' || s.productionEnabled)

  return (
    <section id="ediel-production" className="space-y-6">
      {readiness.status === 'paused' ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">
          Production sending är pausad. Inbound production-meddelanden kan fortfarande tas emot, loggas och granskas.
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Ediel & Production</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{s.companyName ?? 'Bolag'} · Go-Live</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Backend-kontroll av tenant, actor settings, test/production-route, mailbox, aktörstester, driftläge och send locks.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={toneForStatus(readiness.status)}>{statusLabel(readiness.status)}</Badge>
            <Badge tone={s.productionLockLocked ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}>
              {s.productionLockLocked ? 'Send lock aktiv' : 'Send lock upplåst'}
            </Badge>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Info label="Readiness score" value={`${readiness.score}%`} />
          <Info label="Miljö" value={`${s.environment ?? 'test'} → production`} />
          <Info label="Tenant ID" value={<span className="font-mono text-xs">{s.tenantId}</span>} />
          <Info label="Orgnummer" value={s.orgNumber} />
          <Info label="Ediel-ID" value={s.edielId} />
          <Info label="Sender subaddress" value={s.senderSubAddress} />
          <Info label="Receiver subaddress" value={s.receiverSubAddress} />
          <Info label="Actor role" value={s.actorRole} />
          <Info label="BRP" value={s.brpEdielId} />
          <Info label="Kontakt" value={s.contactEmail} />
          <Info label="Driftkontakt" value={s.operationsContactEmail} />
          <Info label="Senaste check" value={formatDate(readiness.latestCheck.checkedAt)} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <IssueList title="Detta saknas / blockerar" issues={readiness.blockingIssues} tone="red" />
        <IssueList title="Varningar att granska" issues={readiness.warnings} tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">Routes och mailbox</h3>
          <div className="mt-4 grid gap-3">
            <Info label="Test route profile" value={<span className="font-mono text-xs">{s.activeTestRouteProfileId ?? '–'}</span>} />
            <Info label="Production route profile" value={<span className="font-mono text-xs">{s.activeProductionRouteProfileId ?? '–'}</span>} />
            <Info label="Production mailbox" value={<span className="font-mono text-xs">{s.productionMailboxId ?? '–'}</span>} />
            <Info label="Latest poll" value={`${formatDate(s.latestPollAt)} · ${s.latestPollStatus ?? 'status saknas'}`} />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">Live operations</h3>
          <div className="mt-4 grid gap-3">
            <Info label="Latest inbound" value={s.latestInbound ? `${s.latestInbound.family} ${s.latestInbound.code} · ${s.latestInbound.status} · ${formatDate(s.latestInbound.createdAt)}` : '–'} />
            <Info label="Latest outbound" value={s.latestOutbound ? `${s.latestOutbound.family} ${s.latestOutbound.code} · ${s.latestOutbound.status} · ${formatDate(s.latestOutbound.createdAt)}` : '–'} />
            <Info label="Unresolved / Failed / Negative APERAK" value={`${s.unresolvedItems} / ${s.failedMessages} / ${s.negativeAperaks}`} />
            <Info label="Första live-send" value={s.firstLiveSendApprovedAt ? `Godkänd ${formatDate(s.firstLiveSendApprovedAt)}` : 'Väntar på godkännande'} />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">Nästa rekommenderade steg</h3>
          <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
            {readiness.nextActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
          {readiness.latestDryRun.createdAt ? (
            <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700">
              Senaste dry run: {readiness.latestDryRun.status ?? 'okänd'} · {formatDate(readiness.latestDryRun.createdAt)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-950">Guidade åtgärder</h3>
        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          <form action={runProductionReadinessAction} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input type="hidden" name="company_id" value={readiness.companyId} />
            <input type="hidden" name="redirect_to" value={returnPath} />
            <h4 className="font-semibold text-slate-950">Kör readiness check</h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">Sparar en backend-kontroll i audit/go-live historiken.</p>
            <button disabled={!canManageProduction} className="mt-4 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">Kör kontroll</button>
          </form>

          <form action={runProductionDryRunAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <input type="hidden" name="company_id" value={readiness.companyId} />
            <input type="hidden" name="redirect_to" value={returnPath} />
            <h4 className="font-semibold text-emerald-950">Run production dry run</h4>
            <p className="mt-2 text-sm leading-6 text-emerald-800">Simulerar production-send utan att skicka Ediel.</p>
            <button disabled={!canManageProduction} className="mt-4 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">Run dry run</button>
          </form>

          <form action={approveFirstLiveSendAction} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <input type="hidden" name="company_id" value={readiness.companyId} />
            <input type="hidden" name="redirect_to" value={returnPath} />
            <h4 className="font-semibold text-amber-950">Första live-send</h4>
            <p className="mt-2 text-sm leading-6 text-amber-900">Kräver explicit superadmin-godkännande innan första outbound production-send.</p>
            <input name="confirmation" placeholder="APPROVE FIRST LIVE SEND" className="mt-3 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm" />
            <button disabled={!canManageProduction || readiness.blockingIssues.length > 0} className="mt-3 rounded-xl bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">Godkänn första send</button>
          </form>

          <form action={activateLiveEdielAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <input type="hidden" name="company_id" value={readiness.companyId} />
            <input type="hidden" name="redirect_to" value={returnPath} />
            <h4 className="font-semibold text-emerald-950">Aktivera production</h4>
            <p className="mt-2 text-sm leading-6 text-emerald-800">Låser upp production-send när readiness saknar blockerare.</p>
            <input name="confirmation" placeholder="ACTIVATE PRODUCTION" className="mt-3 w-full rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm" />
            <button disabled={!canActivate} className="mt-3 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">{canActivate ? 'Aktivera production' : 'Aktivering blockerad'}</button>
          </form>

          <form action={pauseProductionEdielAction} className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <input type="hidden" name="company_id" value={readiness.companyId} />
            <input type="hidden" name="redirect_to" value={returnPath} />
            <h4 className="font-semibold text-red-950">Pausa production sending</h4>
            <p className="mt-2 text-sm leading-6 text-red-800">Stoppar nya outbound production-send men behåller inbound logging.</p>
            <input name="reason" placeholder="Anledning krävs" className="mt-3 w-full rounded-xl border border-red-300 bg-white px-3 py-2 text-sm" />
            <button disabled={!canPause} className="mt-3 rounded-xl bg-red-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">Pausa sending</button>
          </form>

          <form action={resumeProductionEdielAction} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input type="hidden" name="company_id" value={readiness.companyId} />
            <input type="hidden" name="redirect_to" value={returnPath} />
            <h4 className="font-semibold text-slate-950">Återuppta production</h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">Kör readiness igen och låser upp sending om allt fortfarande passerar.</p>
            <input name="confirmation" placeholder="RESUME PRODUCTION" className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            <button disabled={!canResume} className="mt-3 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-400">Återuppta</button>
          </form>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-950">Go-live historik</h3>
          <Link href={`/admin/platform/go-live/${readiness.companyId}/route-wizard`} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Production route-wizard</Link>
        </div>
        <div className="mt-4 space-y-3">
          {readiness.auditEvents.length === 0 ? <p className="text-sm text-slate-600">Ingen go-live historik ännu.</p> : null}
          {readiness.auditEvents.map((event) => (
            <article key={event.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="font-semibold text-slate-950">{event.eventType} · {event.fromStatus ?? '–'} → {event.toStatus ?? '–'}</div>
              <div className="mt-1 text-xs text-slate-500">{formatDate(event.createdAt)}</div>
              {event.reason ? <p className="mt-2 leading-6 text-slate-700">{event.reason}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
