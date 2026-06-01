//components/admin/ediel/ActorTestingViews.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ACTOR_TEST_CASES,
  getActorTestStatusLabel,
  getActorTestStatusTone,
  getActorTestingStatusLabel,
  getProductionReadinessLabel,
  groupActorTestsByPackage,
  type ActorTestingSummary,
} from '@/lib/ediel/actorTesting'
import {
  activateLiveEdielAction,
  prepareProductionAction,
  saveActorProfileAction,
  saveActorTestResultAction,
  startActorTestAction,
  syncActorTestsAction,
} from '@/app/admin/platform/actor-testing/actions'

function formatDate(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Badge({ tone, children }: { tone: string; children?: ReactNode }) {
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>{children}</span>
}

function statusTone(status: ActorTestingSummary['actorTestStatus'] | ActorTestingSummary['productionReadiness']) {
  if (status === 'approved' || status === 'ready' || status === 'live') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'in_progress' || status === 'ready_for_tests') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      <p className="mt-2 break-words text-3xl font-black text-slate-950">{value}</p>
      {hint ? <p className="mt-2 text-xs font-semibold leading-5 text-slate-600">{hint}</p> : null}
    </div>
  )
}

export function ActorTestingStats({ summaries }: { summaries: ActorTestingSummary[] }) {
  const approved = summaries.filter((summary) => summary.actorTestStatus === 'approved').length
  const readyForLive = summaries.filter((summary) => summary.productionReadiness === 'ready').length
  const live = summaries.filter((summary) => summary.productionReadiness === 'live').length
  const blocked = summaries.filter((summary) => summary.goLiveBlockers.length > 0 || summary.actorTestStatus === 'blocked').length

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Bolag" value={summaries.length} />
      <Stat label="Aktörstest godkänt" value={approved} />
      <Stat label="Redo för live-kontroll" value={readyForLive} />
      <Stat label="Live / blockerade" value={`${live} / ${blocked}`} />
    </section>
  )
}

export function ActorTestingCompanyTable({
  summaries,
  basePath,
}: {
  summaries: ActorTestingSummary[]
  basePath: string
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-5">
        <h2 className="text-lg font-semibold text-slate-950">Bolag och teststatus</h2>
        <p className="mt-1 text-sm text-slate-700">Varje bolag har egen aktörsprofil, egna testresultat och egen produktionsaktivering.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
            <tr>
              <th className="px-6 py-4">Bolag</th>
              <th className="px-6 py-4">Ediel-id</th>
              <th className="px-6 py-4">BRP</th>
              <th className="px-6 py-4">PRODAT</th>
              <th className="px-6 py-4">UTILTS</th>
              <th className="px-6 py-4">Senast körd</th>
              <th className="px-6 py-4">Produktion</th>
              <th className="px-6 py-4">Åtgärd</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summaries.map((summary) => (
              <tr key={summary.company.id} className="align-top">
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-950">{summary.company.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{summary.company.org_number ?? 'Orgnummer saknas'}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={statusTone(summary.actorTestStatus)}>{getActorTestingStatusLabel(summary.actorTestStatus)}</Badge>
                    {summary.company.status ? <Badge tone="border-slate-200 bg-slate-50 text-slate-700">{summary.company.status}</Badge> : null}
                  </div>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-700">{summary.company.ediel_id ?? summary.company.test_ediel_id ?? '–'}</td>
                <td className="px-6 py-4">
                  <div>{summary.company.brp_name ?? '–'}</div>
                  <div className="mt-1 text-xs text-slate-500">{summary.company.brp_ediel_id ?? 'BRP Ediel-id saknas'}</div>
                  <div className="mt-2"><Badge tone={String(summary.company.brp_status).toLowerCase() === 'active' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}>{summary.company.brp_status ?? 'BRP ej aktiv'}</Badge></div>
                </td>
                <td className="px-6 py-4 font-semibold text-slate-900">{summary.prodatPassed}/{summary.prodatTotal}</td>
                <td className="px-6 py-4 font-semibold text-slate-900">{summary.utiltsPassed}/{summary.utiltsTotal}</td>
                <td className="px-6 py-4 text-slate-700">{formatDate(summary.latestRunAt)}</td>
                <td className="px-6 py-4"><Badge tone={statusTone(summary.productionReadiness)}>{getProductionReadinessLabel(summary.productionReadiness)}</Badge></td>
                <td className="px-6 py-4">
                  <Link href={`${basePath}/${summary.company.id}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Öppna</Link>
                </td>
              </tr>
            ))}
            {summaries.length === 0 ? <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-600">Inga bolag hittades i detta scope.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function ActorCompanyIdentityCard({ summary }: { summary: ActorTestingSummary }) {
  const c = summary.company
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Bolagets ID-kort</div>
          <h2 className="mt-2 text-2xl font-black text-slate-950">{c.name}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">Company ID: <span className="font-mono">{c.id}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(summary.actorTestStatus)}>{getActorTestingStatusLabel(summary.actorTestStatus)}</Badge>
          <Badge tone={statusTone(summary.productionReadiness)}>{getProductionReadinessLabel(summary.productionReadiness)}</Badge>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Info label="Orgnummer" value={c.org_number} />
        <Info label="White-label plattform" value={c.white_label_platform_id} />
        <Info label="Ediel-id" value={c.ediel_id ?? c.test_ediel_id} />
        <Info label="Roll" value={c.market_role ?? c.actor_role} />
        <Info label="BRP" value={c.brp_name} />
        <Info label="BRP Ediel-id" value={c.brp_ediel_id} />
        <Info label="Teknisk kontakt" value={c.technical_contact_email ?? c.primary_contact_email} />
        <Info label="Mailbox" value={c.ediel_mailbox ?? c.test_mailbox} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
          <h3 className="font-semibold text-emerald-950">Aktörstester</h3>
          <p className="mt-2 text-sm text-emerald-800">PRODAT: {summary.prodatPassed}/{summary.prodatTotal} godkända · UTILTS: {summary.utiltsPassed}/{summary.utiltsTotal} godkända</p>
          <p className="mt-1 text-sm text-emerald-800">Senast körd: {formatDate(summary.latestRunAt)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="font-semibold text-slate-950">Produktionssättning</h3>
          <p className="mt-2 text-sm text-slate-700">BRP: {c.brp_status ?? '–'} · Produktionsaktör: {summary.hasProductionActorProfile ? 'Aktiv' : 'Saknas'} · Routes: {summary.hasProductionRoute ? 'Klara' : 'Saknas'} · Mailbox: {summary.hasVerifiedMailbox ? 'Verifierad' : 'Saknas'}</p>
          <p className="mt-1 text-sm text-slate-700">Live-status: {c.live_ediel_enabled ? 'Aktiverad' : 'Ej aktiverad'}</p>
        </div>
      </div>
    </section>
  )
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-1 break-all text-sm font-semibold text-slate-950">{value?.trim() || '–'}</div>
    </div>
  )
}

export function ActorTestPackageCards({ summary, readonly = false }: { summary: ActorTestingSummary; readonly?: boolean }) {
  const resultsByKey = new Map(summary.results.map((result) => [result.test_key, result]))
  const agtHref = (testKey: string) => `/admin/ediel/agt/${testKey}?companyId=${summary.company.id}`

  return (
    <section className="space-y-5">
      {!readonly ? (
        <form action={syncActorTestsAction} className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <input type="hidden" name="company_id" value={summary.company.id} />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-emerald-950">Synka från verkliga Ediel-meddelanden</h2>
              <p className="mt-1 text-sm leading-6 text-emerald-800">Läser inbound/outbound, kopplar CONTRL, APERAK och UTILTS_ERR till rätt testfall och uppdaterar bevispaketet. Skick görs inte blint här; öppna testflödet för att förhandsgranska payload innan du skickar.</p>
            </div>
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800">Synka testmotor</button>
          </div>
        </form>
      ) : null}
      {groupActorTestsByPackage().map((group) => (
        <div key={group.key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{group.label}</h2>
              <p className="mt-1 text-sm text-slate-700">Testpaketets status sparas per bolag och får inte ärvas från annan tenant.</p>
            </div>
            <Badge tone="border-slate-200 bg-slate-50 text-slate-700">{group.tests.length} tester</Badge>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {group.tests.map((testCase) => {
              const result = resultsByKey.get(testCase.key)
              return (
                <article key={testCase.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={getActorTestStatusTone(result?.status)}>{getActorTestStatusLabel(result?.status)}</Badge>
                        <Badge tone="border-slate-200 bg-white text-slate-700">{testCase.testId ?? 'ID saknas'}</Badge>
                      </div>
                      <h3 className="mt-3 text-base font-black text-slate-950">{testCase.label}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-700">{testCase.description}</p>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                        <div>Meddelande: <span className="font-semibold text-slate-900">{testCase.messageFamily} {testCase.messageCode}</span></div>
                        <div>Riktning: <span className="font-semibold text-slate-900">{testCase.direction === 'actor_to_portal' ? 'Skickas av aktör' : 'Tas emot från portal'}</span></div>
                        <div>Senaste körning: <span className="font-semibold text-slate-900">{formatDate(result?.latest_run_at)}</span></div>
                        <div>Portalstatus: <span className="font-semibold text-slate-900">{result?.portal_status ?? '–'}</span></div>
                      </div>
                      {result?.failure_reason ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-800">{result.failure_reason}</p> : null}
                    </div>
                  </div>

                  {!readonly ? (
                    <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4">
                      <div className="flex flex-wrap gap-2">
                        <Link href={agtHref(testCase.key)} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100">Öppna testflöde</Link>
                        <form action={startActorTestAction}>
                          <input type="hidden" name="company_id" value={summary.company.id} />
                          <input type="hidden" name="test_key" value={testCase.key} />
                          <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Förbered/synka utan skick</button>
                        </form>
                      </div>

                      <form action={saveActorTestResultAction} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                        <input type="hidden" name="company_id" value={summary.company.id} />
                        <input type="hidden" name="test_key" value={testCase.key} />
                        <input type="hidden" name="ediel_test_run_id" value={result?.ediel_test_run_id ?? ''} />
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="grid gap-1 text-xs font-semibold text-slate-700">
                            Status
                            <select name="status" defaultValue={result?.status ?? 'passed'} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                              <option value="passed">Godkänd</option>
                              <option value="manual_verified">Manuellt verifierad</option>
                              <option value="failed">Nekad</option>
                              <option value="blocked">Blockerad</option>
                              <option value="running">Pågår</option>
                            </select>
                          </label>
                          <label className="grid gap-1 text-xs font-semibold text-slate-700 md:col-span-2">
                            Portalstatus / kommentar
                            <input name="portal_status" defaultValue={result?.portal_status ?? ''} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Ex. Godkänt i Edielportalen" />
                          </label>
                        </div>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700">
                          Felorsak vid nekad/blockerad
                          <input name="failure_reason" defaultValue={result?.failure_reason ?? ''} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Ange felorsak om testet inte är godkänt" />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-slate-700">
                          Rå payload / bevisnotering
                          <textarea name="raw_payload" defaultValue={result?.raw_payload ?? ''} className="min-h-24 rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs" placeholder="Klistra in payload eller portalnotering vid behov" />
                        </label>
                        <button className="w-fit rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">Spara testresultat</button>
                      </form>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}


export function ActorProfileGuide({ summary }: { summary: ActorTestingSummary }) {
  const c = summary.company
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Aktörsprofil och test-/produktionsmiljö</h2>
        <p className="mt-1 text-sm leading-6 text-slate-700">Fyll i tenantens egna identiteter. BRP Ediel-id sparas både på bolaget och aktörsprofilen och används som NAD+Z02 i relevanta PRODAT-flöden. Dessa värden används av AGT-motorn och go-live-spärrarna, inte Div3rsa eller global testdata.</p>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
          Testmiljö: {summary.hasActiveActorProfile ? 'aktörsprofil finns' : 'saknar aktörsprofil'} · {summary.hasTestRoute ? 'test-route finns' : 'test-route saknas'}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-700">
          Produktion: {summary.hasProductionActorProfile ? 'aktörsprofil finns' : 'saknar aktörsprofil'} · {summary.hasProductionRoute ? 'route finns' : 'route saknas'}
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-semibold leading-6 text-emerald-900">
          Nästa steg: spara profil, synka testmotor och kontrollera go-live-spärrar per bolag.
        </div>
      </div>
      <form action={saveActorProfileAction} className="mt-5 grid gap-4">
        <input type="hidden" name="company_id" value={c.id} />
        <input type="hidden" name="company_name" value={c.name} />
        <div className="grid gap-3 md:grid-cols-3">
          <TextInput label="Orgnummer" name="org_number" value={c.org_number} />
          <TextInput label="Marknadsroll" name="market_role" value={c.market_role ?? c.actor_role} />
          <TextInput label="Actor role" name="actor_role" value={c.actor_role ?? c.market_role} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <TextInput label="Ediel-id bas" name="ediel_id" value={c.ediel_id} />
          <TextInput label="Test Ediel-id" name="test_ediel_id" value={c.test_ediel_id ?? c.ediel_id} />
          <TextInput label="Produktions Ediel-id" name="production_ediel_id" value={c.production_ediel_id ?? c.ediel_id} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="Test sender subaddress" name="test_sender_sub_address" value={c.test_sender_sub_address ?? c.sender_sub_address} />
          <TextInput label="Produktion sender subaddress" name="production_sender_sub_address" value={c.production_sender_sub_address} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="Test mailbox/SMTP" name="test_mailbox" value={c.test_mailbox ?? c.ediel_mailbox} />
          <TextInput label="Produktions mailbox/SMTP" name="production_mailbox" value={c.production_mailbox ?? c.ediel_mailbox} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="Test Application Reference" name="test_application_reference" value={c.test_application_reference} />
          <TextInput label="Produktions Application Reference" name="production_application_reference" value={c.production_application_reference} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="Test motpart Ediel-id" name="test_counterparty_ediel_id" value={c.test_counterparty_ediel_id} />
          <TextInput label="Produktionsmotpart Ediel-id" name="production_counterparty_ediel_id" value={c.production_counterparty_ediel_id} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="SMTP avsändare" name="smtp_from_email" value={c.support_email ?? c.technical_contact_email ?? c.primary_contact_email} />
          <Info label="Synk till runtime" value={summary.hasActiveActorProfile ? 'Test/aktörsprofil finns' : 'Saknas – spara profilen'} />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <TextInput label="BRP namn" name="brp_name" value={c.brp_name} />
          <TextInput label="BRP Ediel-id / balansansvarig" name="brp_ediel_id" value={c.brp_ediel_id} />
          <SelectInput label="BRP-status" name="brp_status" value={c.brp_status} options={[['missing', 'Saknas'], ['pending', 'Väntar'], ['active', 'Aktiv']]} />
          <SelectInput label="eSett-status" name="esett_status" value={c.esett_status} options={[['missing', 'Saknas'], ['pending', 'Väntar'], ['ready', 'Klar']]} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="Teknisk kontakt namn" name="technical_contact_name" value={c.technical_contact_name} />
          <TextInput label="Teknisk kontakt email" name="technical_contact_email" value={c.technical_contact_email ?? c.primary_contact_email} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <TextInput label="Supportmail" name="support_email" value={c.support_email} />
          <TextInput label="Fakturamail" name="billing_contact_email" value={c.billing_contact_email} />
        </div>
        <button className="w-fit rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800">Spara aktörsprofil</button>
      </form>
    </section>
  )
}

function TextInput({ label, name, value }: { label: string; name: string; value?: string | null }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-slate-700">
      {label}
      <input name={name} defaultValue={value ?? ''} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950" />
    </label>
  )
}

function SelectInput({ label, name, value, options }: { label: string; name: string; value?: string | null; options: Array<[string, string]> }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-slate-700">
      {label}
      <select name={name} defaultValue={value ?? options[0]?.[0]} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

export function GoLiveChecklist({
  summary,
  canActivateLive,
  canPrepareProduction = false,
  returnPath,
}: {
  summary: ActorTestingSummary
  canActivateLive: boolean
  canPrepareProduction?: boolean
  returnPath?: string
}) {
  const c = summary.company
  const redirectPath = returnPath ?? `/admin/platform/go-live/${summary.company.id}`
  const productionCounterparty = String(c.production_counterparty_ediel_id ?? '').trim()
  const testApplicationReference = String(c.test_application_reference ?? '').trim()
  const productionApplicationReference = String(c.production_application_reference ?? '').trim()
  const routesAreSeparated = Boolean(
    summary.hasTestRoute &&
    summary.hasProductionRoute &&
    productionApplicationReference &&
    (!testApplicationReference || testApplicationReference !== productionApplicationReference) &&
    productionCounterparty &&
    productionCounterparty !== '91100'
  )
  const checks = [
    { label: 'Bolagsprofil komplett', ok: Boolean(c.name && c.org_number) },
    { label: 'Orgnummer verifierat', ok: Boolean(c.org_number) },
    { label: 'Ediel-id registrerat', ok: Boolean(c.production_ediel_id ?? c.ediel_id) },
    { label: 'Marknadsroll vald', ok: Boolean(c.market_role ?? c.actor_role) },
    { label: 'BRP Ediel-id registrerat', ok: Boolean(c.brp_ediel_id) },
    { label: 'BRP aktiv', ok: String(c.brp_status ?? '').toLowerCase() === 'active' },
    { label: 'eSett-status klar', ok: String(c.esett_status ?? '').toLowerCase() === 'ready' },
    { label: 'Produktionsaktör aktiv', ok: summary.hasProductionActorProfile },
    { label: 'Produktionsroutes skapade', ok: summary.hasProductionRoute },
    { label: 'Test/AGT-routes separerade från production route', ok: routesAreSeparated },
    { label: 'Mailbox/SMTP verifierad', ok: summary.hasVerifiedMailbox },
    { label: 'Godkända PRODAT-tester', ok: summary.prodatPassed === summary.prodatTotal },
    { label: 'Godkända UTILTS-tester', ok: summary.utiltsPassed === summary.utiltsTotal },
    { label: 'Inga blockerade Ediel-flöden', ok: summary.blockedTests === 0 },
    { label: 'Inga blockerade faktureringsflöden', ok: true },
    { label: 'Audit aktiverad', ok: true },
    { label: 'Superadmin-godkännande krävs', ok: Boolean(c.live_approved_at || canActivateLive) },
  ]

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Go-live checklista</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">Live aktiveras aldrig automatiskt. Superadmin måste göra sista bekräftelsen.</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">Historiska externa godkännanden är endast evidens. Bolaget måste vara verifierat i aktuell Gridex-runtime via actor_test_results innan live kan aktiveras.</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">“Test/AGT-routes separerade från production route” betyder att testflöden mot Edielportalen/TGT, exempelvis 91100, 23-DDQ och testmailbox, inte får återanvändas när live aktiveras. Production route ska ha egen motpart, egen Application Reference, egen mailbox och miljö production.</p>
        </div>
        <Badge tone={statusTone(summary.productionReadiness)}>{getProductionReadinessLabel(summary.productionReadiness)}</Badge>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {checks.map((check) => (
          <div key={check.label} className={`rounded-2xl border p-4 text-sm font-semibold ${check.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {check.ok ? '✓' : '✕'} {check.label}
          </div>
        ))}
      </div>

      {summary.goLiveBlockers.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5">
          <h3 className="font-semibold text-red-950">Live-spärrar</h3>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-red-800">
            {summary.goLiveBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      ) : null}

      {summary.routeValidationIssues.length > 0 ? (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="font-semibold text-amber-950">Djup route-validering</h3>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-amber-900">
            {summary.routeValidationIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {canPrepareProduction ? (
          <form action={prepareProductionAction} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input type="hidden" name="company_id" value={summary.company.id} />
            <input type="hidden" name="redirect_to" value={redirectPath} />
            <h3 className="font-semibold text-slate-950">Förbered produktion</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">Superadmin eller behörig white-label admin kan förbereda status. Om något saknas sätts bolaget som blockerat med tydlig orsak.</p>
            <button className="mt-4 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Kontrollera och förbered</button>
          </form>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            Produktionsförberedelse görs av superadmin eller behörig white-label admin. Bolaget kan följa status, komplettera aktörsprofilen och köra aktörstester tills live godkänns.
          </div>
        )}

        {canActivateLive ? (
          <form action={activateLiveEdielAction} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <input type="hidden" name="company_id" value={summary.company.id} />
            <input type="hidden" name="redirect_to" value={redirectPath} />
            <h3 className="font-semibold text-emerald-950">Aktivera live Ediel</h3>
            <p className="mt-2 text-sm leading-6 text-emerald-800">Du är på väg att aktivera riktiga marknadsmeddelanden för {summary.company.name}. Kontrollera Ediel-id, BRP Ediel-id, routes, actor_test_results och produktionsmailbox.</p>
            <label className="mt-4 grid gap-1 text-xs font-semibold text-emerald-900">
              Bekräftelse: skriv “ACTIVATE PRODUCTION”
              <input name="confirmation" className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm text-slate-900" />
            </label>
            <button disabled={summary.goLiveBlockers.length > 0} className="mt-4 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400">{summary.goLiveBlockers.length > 0 ? 'Live blockerat – åtgärda spärrar först' : 'Aktivera live Ediel'}</button>
          </form>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Slutlig live-aktivering kräver superadmin. Den här ytan kan användas för att följa status och förbereda kontroller.
          </div>
        )}
      </div>
    </section>
  )
}

export function EvidencePackage({
  summary,
  basePath = '/admin/platform/actor-testing',
  showEvidenceLink = true,
}: {
  summary: ActorTestingSummary
  basePath?: string
  showEvidenceLink?: boolean
}) {
  const resultsByKey = new Map(summary.results.map((result) => [result.test_key, result]))

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Bevispaket</h2>
          <p className="mt-1 text-sm text-slate-700">Audit-underlag per testfall med payload, portalstatus och kvittensreferenser där de finns.</p>
        </div>
        {showEvidenceLink ? (
          <div className="flex flex-wrap gap-2">
            <Link href={`${basePath}/${summary.company.id}/evidence/pdf`} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Ladda ner PDF</Link>
            <Link href={`${basePath}/${summary.company.id}/evidence/csv`} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Ladda ner CSV</Link>
            <Link href={`${basePath}/${summary.company.id}/evidence/raw`} className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Rå payload/JSON</Link>
          </div>
        ) : null}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-3">Test</th>
              <th className="px-3 py-3">ID</th>
              <th className="px-3 py-3">Meddelande</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Portal</th>
              <th className="px-3 py-3">Tidpunkt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ACTOR_TEST_CASES.map((testCase) => {
              const result = resultsByKey.get(testCase.key)
              return (
                <tr key={testCase.key}>
                  <td className="px-3 py-3 font-semibold text-slate-950">{testCase.label}</td>
                  <td className="px-3 py-3">{testCase.testId ?? '–'}</td>
                  <td className="px-3 py-3">{testCase.messageFamily} {testCase.messageCode}</td>
                  <td className="px-3 py-3"><Badge tone={getActorTestStatusTone(result?.status)}>{getActorTestStatusLabel(result?.status)}</Badge></td>
                  <td className="px-3 py-3">{result?.portal_status ?? '–'}</td>
                  <td className="px-3 py-3">{formatDate(result?.latest_run_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
