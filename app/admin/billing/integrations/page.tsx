import AdminDisclosurePanel from "@/components/admin/ui/AdminDisclosurePanel"
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'
import {
  reprocessInvoiceProviderEventsAction,
  saveNordfinClientIdAction,
  selectInvoiceProviderAction,
  setInvoiceDispatchEnabledAction,
  testCapwayConnectionAction,
} from './actions'
import { listInvoiceProviderCatalog, loadTenantInvoiceProviderSelection } from '@/lib/billing/providers/registry'

export const dynamic = 'force-dynamic'

function envStatus(name: string) {
  return process.env[name] ? 'Konfigurerad' : 'Saknas'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const PROVIDER_NOTICES: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  selected: { tone: 'ok', text: 'Fakturaleverantören är sparad. Testa kopplingen och aktivera sedan utskick.' },
  enabled: { tone: 'ok', text: 'Utskick via fakturaleverantören är aktiverat.' },
  disabled: { tone: 'ok', text: 'Utskick via fakturaleverantören är avstängt.' },
  invoice_provider_not_available: { tone: 'error', text: 'Leverantören går inte att välja ännu.' },
  invoice_provider_switch_blocked_open_exports: { tone: 'error', text: 'Det finns pågående fakturaexporter. Byt leverantör eller miljö när de är klara.' },
  invoice_provider_not_selected: { tone: 'error', text: 'Välj en fakturaleverantör först.' },
  invoice_provider_connection_not_ready: { tone: 'error', text: 'Kopplingen måste testas med godkänt resultat innan utskick kan aktiveras.' },
  nordfin_client_id_saved: { tone: 'ok', text: 'Nordfins ClientId är sparat.' },
  nordfin_client_id_invalid: { tone: 'error', text: 'ClientId får bara innehålla bokstäver, siffror, - och _ (högst 40 tecken).' },
}

export default async function BillingIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string }>
}) {
  const notice = PROVIDER_NOTICES[(await searchParams).provider ?? ''] ?? null
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const connections = await safeListRows(
    'billing_provider_connections',
    scope?.companyId ?? null,
    '*',
    80,
  )
  const runs = await safeListRows(
    'invoice_export_runs',
    scope?.companyId ?? null,
    '*',
    40,
  )
  const deadLetters = await safeListRows(
    'invoice_dead_letters',
    scope?.companyId ?? null,
    '*',
    20,
  )
  const reviewEvents = (
    await safeListRows(
      'invoice_provider_events',
      scope?.companyId ?? null,
      '*',
      200,
    )
  ).filter((row) => String(row.status ?? '') === 'needs_review')
  const [catalog, selection] = scope?.companyId
    ? await Promise.all([
        listInvoiceProviderCatalog(scope.companyId).catch(() => []),
        loadTenantInvoiceProviderSelection(scope.companyId).catch(() => null),
      ])
    : [[], null]
  const selectedConnection = selection?.invoice_export_target_system
    ? connections.find(
        (row) =>
          String(row.provider ?? '') === selection.invoice_export_target_system &&
          String(row.environment ?? '') === (selection.billing_provider_environment ?? ''),
      )
    : undefined
  const selectedConnectionReady = ['ready', 'active'].includes(String(selectedConnection?.status ?? ''))
  const capwayTest = connections.find(
    (row) =>
      String(row.provider ?? '') === 'capway_aptic' &&
      String(row.environment ?? '') === 'test',
  )
  const capwayLastTest = isObject(capwayTest?.last_test_result)
    ? capwayTest.last_test_result
    : {}
  const capwayIssues = Array.isArray(capwayTest?.readiness_issues)
    ? capwayTest.readiness_issues
    : []

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Fakturaintegrationer"
        subtitle="Styr fakturaexport, Capway/Aptic, fakturaköp och providerstatus per elhandelsbolag."
        userEmail={admin.email}
        workspaceName={scope?.companyName}
      />
      <main className="min-w-0 space-y-4 p-4 lg:p-6 [&_input:not([type=radio])]:min-w-0 [&_select]:min-w-0 [&_select]:w-full [&_label]:min-w-0 [&_label]:grid-cols-1">
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="rounded-2xl border bg-white p-3">
            <div className="text-sm text-slate-600">Providerkopplingar</div>
            <div className="mt-1 text-2xl font-semibold">{connections.length}</div>
          </div>
          <div className="rounded-2xl border bg-white p-3">
            <div className="text-sm text-slate-600">Exportkörningar</div>
            <div className="mt-1 text-2xl font-semibold">{runs.length}</div>
          </div>
          <div className="rounded-2xl border bg-white p-3">
            <div className="text-sm text-slate-600">Misslyckade poster</div>
            <div className="mt-1 text-2xl font-semibold">
              {deadLetters.filter((row) => row.status === 'open').length}
            </div>
          </div>
          <div className="rounded-2xl border bg-white p-3">
            <div className="text-sm text-slate-600">Capway test-env</div>
            <div className="mt-2 text-sm font-semibold text-slate-950">
              {envStatus('CAPWAY_APTIC_TEST_BASE_URL')} /{' '}
              {envStatus('CAPWAY_APTIC_TEST_CLIENT_ID')}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border bg-white p-6 shadow-sm" aria-labelledby="invoice-provider-heading">
          <h2 id="invoice-provider-heading" className="text-lg font-semibold text-slate-950">Fakturaleverantör</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Godkända fakturor skickas via den leverantör bolaget väljer här. Byte av leverantör eller miljö
            stänger av utskick tills den nya kopplingen är testad och utskick aktiveras igen.
          </p>
          {notice ? (
            <p role="status" className={`mt-4 rounded-2xl border p-3 text-sm ${notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
              {notice.text}
            </p>
          ) : null}
          <AdminDisclosurePanel id="billing-select-provider" title="Välj eller byt leverantör och miljö" defaultOpen={!selection?.invoice_export_target_system} className="mt-4 rounded-xl border border-slate-200 p-3"><form action={selectInvoiceProviderAction} className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,160px)_auto] lg:items-end">
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium text-slate-800">Leverantör</legend>
              {catalog.map((entry) => (
                <label key={entry.provider} className={`flex items-start gap-3 rounded-2xl border p-3 text-sm ${entry.selectable ? 'border-slate-200' : 'border-slate-100 bg-slate-50 text-slate-500'}`}>
                  <input
                    type="radio"
                    name="provider"
                    value={entry.provider}
                    required
                    disabled={!entry.selectable}
                    defaultChecked={selection?.invoice_export_target_system === entry.provider}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-semibold">{entry.label}</span>
                    {!entry.selectable && entry.unavailable_reason ? (
                      <span className="block text-xs">{entry.unavailable_reason}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1 text-sm font-medium text-slate-800">
              Miljö
              <select
                name="environment"
                aria-label="Miljö"
                defaultValue={selection?.billing_provider_environment === 'production' ? 'production' : 'test'}
                className="rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="test">Test</option>
                <option value="production">Produktion</option>
              </select>
            </label>
            <button type="submit" className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
              Spara leverantör
            </button>
          </form></AdminDisclosurePanel>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-2xl border p-3">
              <dt className="text-slate-600">Vald leverantör</dt>
              <dd className="mt-1 font-semibold">
                {catalog.find((entry) => entry.provider === selection?.invoice_export_target_system)?.label ?? 'Ingen vald'}
                {selection?.billing_provider_environment ? ` (${selection.billing_provider_environment === 'production' ? 'produktion' : 'test'})` : ''}
              </dd>
            </div>
            <div className="rounded-2xl border p-3">
              <dt className="text-slate-600">Koppling</dt>
              <dd className="mt-1 font-semibold">{selectedConnectionReady ? 'Testad och godkänd' : selectedConnection ? 'Behöver testas' : '—'}</dd>
            </div>
            <div className="rounded-2xl border p-3">
              <dt className="text-slate-600">Utskick</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-3 font-semibold">
                {selection?.invoice_export_enabled ? 'Aktiverat' : 'Avstängt'}
                <form action={setInvoiceDispatchEnabledAction}>
                  <input type="hidden" name="enabled" value={selection?.invoice_export_enabled ? 'false' : 'true'} />
                  <button
                    type="submit"
                    disabled={!selection?.invoice_export_enabled && !selectedConnectionReady}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selection?.invoice_export_enabled ? 'Stäng av utskick' : 'Aktivera utskick'}
                  </button>
                </form>
              </dd>
            </div>
          </dl>
          {selection?.invoice_export_target_system === 'nordfin' ? (
            <form action={saveNordfinClientIdAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 p-3">
              <label className="grid gap-1 text-sm font-medium text-slate-800">
                Nordfin ClientId ({selection.billing_provider_environment === 'production' ? 'produktion' : 'test'})
                <input
                  name="client_id"
                  required
                  maxLength={40}
                  pattern="[A-Za-z0-9_\-]{1,40}"
                  defaultValue={typeof (selectedConnection?.settings as Record<string, unknown> | undefined)?.client_id === 'string' ? String((selectedConnection?.settings as Record<string, unknown>).client_id) : ''}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <button type="submit" className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">Spara ClientId</button>
              <p className="w-full text-xs text-slate-600">Det id Nordfin har gett ert bolag. Det skrivs in i varje fakturafil till Nordfin.</p>
            </form>
          ) : null}
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                Capway/Aptic readiness
              </h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-amber-950">
                Export är blockerad tills tenantens auth och Aptic API faktiskt är
                verifierade. Testet kör dokumenterade GET /v1/Invoices/Ping från
                Gridex OPS-runtime och sparar bara status/resultat, aldrig
                credentials. Ett lyckat test aktiverar inte billing eller
                fakturaexport.
              </p>
            </div>
            <form action={testCapwayConnectionAction}>
              <button
                type="submit"
                className="rounded-2xl bg-amber-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-950"
              >
                Testa Aptic-anslutning
              </button>
            </form>
          </div>

          <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4">
            {[
              'CAPWAY_APTIC_TEST_TOKEN_URL',
              'CAPWAY_APTIC_TEST_BASE_URL',
              'CAPWAY_APTIC_TEST_CLIENT_ID',
              'CAPWAY_APTIC_TEST_CLIENT_SECRET',
            ].map((name) => (
              <div
                key={name}
                className="rounded-2xl border border-amber-200 bg-white p-4 text-sm"
              >
                <div className="break-all font-mono text-xs text-slate-600">{name}</div>
                <div className="mt-1 font-semibold text-slate-950">
                  {envStatus(name)}
                </div>
              </div>
            ))}
          </div>

          {capwayTest ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-950">
                    {fmt(capwayTest.display_name) || 'Capway/Aptic test'}
                  </div>
                  <div className="mt-1 text-slate-600">
                    Status: {fmt(capwayTest.status)} · senast testad{' '}
                    {fmt(capwayTest.last_tested_at) || 'aldrig'}
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(capwayTest.status)}`}
                >
                  {fmt(capwayTest.status)}
                </span>
              </div>
              {Object.keys(capwayLastTest).length > 0 ? (
                <div className="mt-3 text-xs text-slate-600">
                  Senaste test: {capwayLastTest.ok === true ? 'godkänt' : 'ej godkänt'}
                  {typeof capwayLastTest.error === 'string'
                    ? ` · ${capwayLastTest.error}`
                    : ''}
                </div>
              ) : null}
              {capwayIssues.length > 0 ? (
                <div className="mt-3 space-y-1 text-xs text-amber-900">
                  {capwayIssues.map((issue, index) => {
                    const row = isObject(issue) ? issue : {}
                    return (
                      <div key={`${String(row.code ?? 'issue')}-${index}`}>
                        • {String(row.message ?? row.code ?? 'Readiness blocker')}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              Ingen tenant-specifik Capway/Aptic testkoppling finns för valt bolag.
            </div>
          )}
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-3xl border bg-white shadow-sm">
            <div className="border-b px-6 py-5">
              <h2 className="text-lg font-semibold">Providerkopplingar</h2>
              <p className="mt-1 text-sm text-slate-700">
                Tekniska credentials ligger i env/secret manager. Databasen sparar
                bara koppling, readiness och provider-koder.
              </p>
            </div>
            <div className="divide-y">
              {connections.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  Ingen Capway-koppling finns ännu.
                </div>
              ) : null}
              {connections.map((row) => (
                <div key={String(row.id)} className="min-w-0 break-words p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-semibold">
                      {fmt(row.display_name) || fmt(row.provider)}
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}
                    >
                      {fmt(row.status)}
                    </span>
                  </div>
                  <div className="mt-2 text-slate-600">
                    {fmt(row.provider)} · {fmt(row.environment)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border bg-white shadow-sm">
            <div className="border-b px-6 py-5">
              <h2 className="text-lg font-semibold">Senaste fakturaexporter</h2>
              <p className="mt-1 text-sm text-slate-700">
                Här visas exportkörningar mot Capway/Aptic och andra fakturapartners.
              </p>
            </div>
            <div className="divide-y">
              {runs.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  Inga exportkörningar finns ännu.
                </div>
              ) : null}
              {runs.map((row) => (
                <div key={String(row.id)} className="min-w-0 break-words p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-semibold">
                      {fmt(row.billing_month)} · {fmt(row.provider)}
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}
                    >
                      {fmt(row.status)}
                    </span>
                  </div>
                  <div className="mt-2 text-slate-600">
                    Poster: {fmt(row.total_items)} · skickade: {fmt(row.sent_items)} ·
                    fel: {fmt(row.failed_items)}
                  </div>
                  <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Körnings-id</summary><p className="mt-1 break-all font-mono">{String(row.id)}</p></details>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold">
                Providerhändelser som kräver granskning
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                Webhookhändelser som inte kunde matchas mot en fakturaexport
                automatiskt. Ombearbetning matchar om händelser där underliggande
                data har kommit på plats.
              </p>
            </div>
            <form action={reprocessInvoiceProviderEventsAction}>
              <button
                type="submit"
                className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
              >
                Ombearbeta händelser
              </button>
            </form>
          </div>
          <div className="divide-y">
            {reviewEvents.length === 0 ? (
              <div className="p-6 text-sm text-slate-600">
                Inga händelser väntar på granskning.
              </div>
            ) : null}
            {reviewEvents.slice(0, 25).map((row) => (
              <div key={String(row.id)} className="min-w-0 break-words p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="font-semibold">
                    {fmt(row.event_type)} · {fmt(row.provider)}
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}
                  >
                    {fmt(row.status)}
                  </span>
                </div>
                <div className="mt-2 text-slate-600">
                  Faktura-GUID: {fmt(row.provider_invoice_guid) || 'saknas'} ·
                  mottagen {fmt(row.received_at)}
                </div>
              </div>
            ))}
            {reviewEvents.length > 25 ? (
              <div className="p-4 text-xs text-slate-500">
                Visar 25 av {reviewEvents.length} händelser.
              </div>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  )
}
