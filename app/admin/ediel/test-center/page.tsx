import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { prepareEdielTestCenterRunAction } from '@/app/admin/ediel/test-center/actions'

export const dynamic = 'force-dynamic'

const tabs = [
  { title: 'Leverantör PRODAT', cases: 'L1, L2, L3, L4, L5, L7', href: '/admin/ediel/agt' },
  { title: 'Leverantör UTILTS', cases: 'UL1, UL2, UL3, UL4, UL6', href: '/admin/ediel/system-tests' },
  { title: 'Energitjänsteföretag PRODAT', cases: 'E3, E4, E5, E6, E7, E8', href: '/admin/ediel/system-tests' },
  { title: 'Energitjänsteföretag UTILTS', cases: 'UE1, UE2', href: '/admin/ediel/system-tests' },
  { title: 'Transport & kryptering', cases: 'Okrypterat testläge och S/MIME testläge', href: '/admin/ediel/routes' },
]

const testCases = [
  { group: 'Leverantör AGT', cases: 'L1, L2, L3, L4, L5, L7', family: 'PRODAT' },
  { group: 'Leverantör UTILTS', cases: 'UL1, UL2, UL3, UL4, UL6', family: 'UTILTS' },
  { group: 'Energitjänsteföretag PRODAT', cases: 'E3, E4, E5, E6, E7, E8', family: 'PRODAT' },
  { group: 'Energitjänsteföretag UTILTS', cases: 'UE1, UE2', family: 'UTILTS' },
]

type TestCenterPageProps = {
  searchParams?: Promise<{
    runStatus?: string
    runMessage?: string
  }>
}

type RecentRunRow = {
  id: string
  company_id?: string | null
  test_case_code: string
  test_suite: string
  role_code: string
  status: string
  environment_type?: string | null
  encryption_mode?: string | null
  certificate_fingerprint_sha256?: string | null
  route_profile_id?: string | null
  created_at?: string | null
  failure_reason?: string | null
}

async function listRecentRuns(): Promise<{
  runs: RecentRunRow[]
  warning: string | null
}> {
  const rich = await supabaseService
    .from('ediel_test_runs')
    .select('id,company_id,test_case_code,test_suite,role_code,status,environment_type,encryption_mode,certificate_fingerprint_sha256,route_profile_id,created_at,failure_reason')
    .order('created_at', { ascending: false })
    .limit(8)

  if (!rich.error) return { runs: (rich.data ?? []) as RecentRunRow[], warning: null }

  const legacy = await supabaseService
    .from('ediel_test_runs')
    .select('id,company_id,test_case_code,test_suite,role_code,status,created_at,failure_reason')
    .order('created_at', { ascending: false })
    .limit(8)

  if (legacy.error) {
    return { runs: [], warning: `Kunde inte läsa senaste test-runs: ${legacy.error.message}` }
  }

  return {
    runs: (legacy.data ?? []) as RecentRunRow[],
    warning: 'Databasen saknar nya test-run transportkolumner. Gamla AGT/Systemtester fungerar, men kör senaste migrationen för att visa krypteringsmetadata här.',
  }
}

export default async function EdielTestCenterPage({ searchParams }: TestCenterPageProps) {
  const context = await requirePlatformAdminAccess()
  const resolvedSearchParams = await searchParams
  const runStatus = resolvedSearchParams?.runStatus === 'success' ? 'success' : resolvedSearchParams?.runStatus === 'error' ? 'error' : null
  const runMessage = resolvedSearchParams?.runMessage ?? null
  const [{ data: companies }, recentRunsResult] = await Promise.all([
    supabaseService
      .from('companies')
      .select('id,name')
      .order('name', { ascending: true })
      .limit(100),
    listRecentRuns(),
  ])
  const recentRuns = recentRunsResult.runs

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel Test Center"
        subtitle="Superadmin-yta för TGT/AGT, regression och transport/kryptering. Testerna använder samma backend-builders och parsers som produktion."
        userEmail={context.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-8">
        {runStatus && runMessage ? (
          <section className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
            runStatus === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {runMessage}
          </section>
        ) : null}
        {recentRunsResult.warning ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {recentRunsResult.warning}
          </section>
        ) : null}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black text-slate-950">Testfamiljer</h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-700">
            Välj flöde nedan. Rå EDIFACT, parsed view, CONTRL, APERAK, UTILTS-ERR och felorsak visas i respektive befintlig test-/AGT-arbetsyta.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tabs.map((tab) => (
              <Link key={tab.title} href={tab.href} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">{tab.cases}</p>
                <h2 className="mt-2 text-lg font-black text-slate-950">{tab.title}</h2>
                <p className="mt-2 text-sm font-medium text-slate-700">Öppna testarbetsyta</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Rekommenderat arbetssätt</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Kör fortsatt från gamla AGT/Systemtester</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-900">
            Det gamla flödet är fortfarande primärt för själva körningen. Test Center är en kontroll-/transportyta där du kan förbereda krypteringsmetadata och se status. För smidig körning: öppna AGT för L1-L7 eller Systemtester för TGT/UTILTS och kör testen därifrån.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/admin/ediel/agt" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Öppna AGT</Link>
            <Link href="/admin/ediel/system-tests" className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800">Öppna Systemtester</Link>
          </div>
        </section>

        <section className="rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Starta test-run</p>
          <h2 className="mt-2 text-xl font-black text-slate-950">Enkelt testval, backend äger Ediel-reglerna</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
            Välj bolag, roll, testfall och transportläge. Backend hämtar route/certifikat från konfigurationen, lagrar expected flow och använder befintliga builders/parsers när testfallet kan förbereda outbound EDIFACT.
          </p>
          <form action={prepareEdielTestCenterRunAction} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select name="companyId" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" required>
              <option value="">Välj bolag/tenant</option>
              {(companies ?? []).map((company) => (
                <option key={company.id} value={company.id}>{company.name ?? company.id}</option>
              ))}
            </select>
            <select name="roleCode" defaultValue="supplier" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="supplier">Elleverantör</option>
              <option value="esco">Energitjänsteföretag / DGI</option>
            </select>
            <select name="testSuite" defaultValue="PRODAT" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="PRODAT">PRODAT</option>
              <option value="UTILTS">UTILTS</option>
            </select>
            <select name="testCaseCode" defaultValue="L1" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="L1">L1 - Z03</option>
              <option value="L2">L2 - Z04</option>
              <option value="L3">L3 - Z05</option>
              <option value="L4">L4 - Z06</option>
              <option value="L5">L5 - Z10</option>
              <option value="L7">L7 - Z09</option>
              <option value="UL1">UL1 - S03</option>
              <option value="UL2">UL2 - E66-KVART</option>
              <option value="UL3">UL3 - E66-SCH</option>
              <option value="UL4">UL4 - S02</option>
              <option value="UL6">UL6 - E31-SCH</option>
              <option value="E3">E3</option>
              <option value="E4">E4</option>
              <option value="E5">E5</option>
              <option value="E6">E6</option>
              <option value="E7">E7</option>
              <option value="E8">E8</option>
              <option value="UE1">UE1</option>
              <option value="UE2">UE2</option>
            </select>
            <select name="environmentType" defaultValue="agt_test" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="tgt_test">TGT / systemtest</option>
              <option value="agt_test">AGT / aktörtest</option>
              <option value="bilateral_test">Bilateralt test</option>
              <option value="production">Produktion</option>
            </select>
            <select name="encryptionMode" defaultValue="none" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="none">Kör okrypterat test</option>
              <option value="smime">Kör krypterat test</option>
            </select>
            <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input type="checkbox" name="productionLike" value="true" className="h-4 w-4 rounded border-slate-300" />
              Produktionslikt test
            </label>
            <button className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white">
              Förbered test-run
            </button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Transport security</p>
              <h2 className="mt-2 text-xl font-black text-slate-950">Krypterade och okrypterade testlägen</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-700">
                Test Center ska köra samma canonical EDIFACT-builder, parser och validator som produktion. Transportläget väljs efter att EDIFACT är byggd och validerad: okrypterat test skickar raw EDIFACT via SMTP/TLS, krypterat test paketerar samma payload med S/MIME och lagrar certifikatfingerprint.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">Kör okrypterat test</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">Kör krypterat test</span>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {testCases.map((item) => (
              <div key={item.group} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-black text-slate-950">{item.group}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-600">{item.family}</div>
                <div className="mt-3 text-sm text-slate-700">{item.cases}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">Progress UI</div>
              <ol className="mt-3 space-y-1 text-sm text-slate-700">
                <li>1. Förbereder EDIFACT</li>
                <li>2. Validerar EDIFACT</li>
                <li>3. Krypterar med S/MIME vid valt läge</li>
                <li>4. Skickar via SMTP/TLS</li>
                <li>5. Väntar på CONTRL och APERAK</li>
              </ol>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="text-sm font-black text-amber-950">Route/certifikat guard</div>
              <p className="mt-3 text-sm leading-6 text-amber-800">
                Route saknar certifikat, certifikat saknas eller har gått ut blockerar krypterat test. Subadress kontrolleras bara när routeprofilen kräver den.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-black text-slate-950">Lagring per test run</div>
              <p className="mt-3 text-sm leading-6 text-slate-700">
                `ediel_test_runs` lagrar encryption_mode, certificate_id, certificate_fingerprint_sha256, route_profile_id, expected_flow, actual_flow, raw_edifact och encrypted_payload_ref.
              </p>
            </div>
          </div>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-slate-950">Senaste test-runs</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr><th className="p-3">Test</th><th className="p-3">Miljö</th><th className="p-3">Transport</th><th className="p-3">Route</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id} className="border-t border-slate-100">
                    <td className="p-3 font-semibold">{run.test_suite} {run.test_case_code}<div className="text-xs font-normal text-slate-500">{run.role_code}</div></td>
                    <td className="p-3">{run.environment_type ?? 'legacy test/prod'}</td>
                    <td className="p-3">{run.encryption_mode ?? 'none'}<div className="font-mono text-xs text-slate-500">{run.certificate_fingerprint_sha256 ?? 'utan certfingerprint'}</div></td>
                    <td className="p-3 font-mono text-xs">{run.route_profile_id ?? 'route ej vald'}</td>
                    <td className="p-3">{run.status}{run.failure_reason ? <div className="text-xs text-red-700">{run.failure_reason}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
