import type { TenantWebsiteGoLiveSummary } from '@/lib/integrations/tenantWebsiteGoLive'
import { verifyTenantWebsiteGoLiveAction } from '@/app/admin/platform/go-live/actions'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE')
}

export function TenantWebsiteGoLivePanel({
  summary,
}: {
  summary: TenantWebsiteGoLiveSummary
}) {
  const readiness = summary.readiness
  const launchReady = Boolean(summary.client?.launch_ready) && Boolean(readiness?.complete_tenant_website_ready)
  const blockerMessages = readiness?.blockers.map((blocker) => blocker.message) ?? [
    'Ingen verifierad hemsideintegration finns ännu.',
  ]
  const launchBlockers = Array.isArray(summary.client?.launch_blockers)
    ? summary.client?.launch_blockers ?? []
    : []

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
            Webb & Mina sidor
          </p>
          <h2 className="mt-2 text-xl font-black text-slate-950">
            Hemsida, kundintag och kundportal
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Samma repeterbara kontroll används för varje bolag. Befintlig production-nyckel
            återanvänds när den kan identifieras säkert; en pausad credential aktiveras aldrig
            genom en manuell statusändring.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-black ${launchReady ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {launchReady ? 'Webb redo' : 'Webb blockerad'}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Bolagsstatus</div>
          <div className="mt-1 text-sm font-black text-slate-950">{summary.company.status}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">API-klient</div>
          <div className="mt-1 break-words text-sm font-black text-slate-950">{summary.client?.name ?? 'Saknas'}</div>
          <div className="mt-1 text-xs text-slate-600">{summary.client?.status ?? 'ej skapad'}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Senaste kvitto</div>
          <div className="mt-1 text-sm font-black text-slate-950">{summary.latestReceipt?.state ?? 'Saknas'}</div>
          <div className="mt-1 text-xs text-slate-600">{formatDate(summary.latestReceipt?.completed_at ?? summary.latestReceipt?.created_at)}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Försäljning</div>
          <div className="mt-1 text-sm font-black text-slate-950">
            {readiness?.checks.operation_contract_channel_allowed ? 'Tillåten' : 'Stängd'}
          </div>
          <div className="mt-1 text-xs text-slate-600">Öppnas endast när production-gaten tillåter nya avtal.</div>
        </div>
      </div>

      {!launchReady ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="font-black">Blockerare</div>
          <ul className="mt-2 space-y-1.5 font-semibold leading-6">
            {blockerMessages.map((message) => <li key={message}>{message}</li>)}
            {launchBlockers.map((blocker, index) => (
              <li key={`launch-${index}`}>{typeof blocker === 'string' ? blocker : JSON.stringify(blocker)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
          Hemsida och Mina sidor har ett komplett installationskvitto. Nya elavtal är dessutom runtime-gated av production-status.
        </div>
      )}

      <form action={verifyTenantWebsiteGoLiveAction} className="mt-6 grid gap-4 rounded-2xl border border-blue-200 bg-blue-50 p-5">
        <input type="hidden" name="company_id" value={summary.company.id} />
        <div>
          <h3 className="font-black text-blue-950">Verifiera integrationen</h3>
          <p className="mt-1 text-sm leading-6 text-blue-900">
            Kör provisioning, smoke-test, capability-reconciliation och installationskvitto på nytt. Flödet är idempotent och tenant-separerat.
          </p>
        </div>
        <label className="grid gap-1 text-xs font-bold text-blue-950">
          Tillåtna hemsideadresser
          <textarea
            name="allowed_origins"
            defaultValue={summary.suggestedOrigins.join('\n')}
            placeholder="https://exempel.se"
            rows={Math.max(summary.suggestedOrigins.length, 2)}
            className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-slate-950"
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-bold text-blue-950">
          Kundportal efter inloggning
          <input
            name="customer_portal_url"
            defaultValue={summary.company.customerPortalUrl ?? ''}
            placeholder="https://exempel.se/dashboard"
            className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-slate-950"
            required
          />
        </label>
        <button className="justify-self-start rounded-xl bg-blue-800 px-4 py-2 text-xs font-black text-white hover:bg-blue-900">
          Verifiera webb & Mina sidor
        </button>
      </form>
    </section>
  )
}
