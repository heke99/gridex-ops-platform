import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { prepareEdielTestCenterRunAction } from '@/app/admin/ediel/test-center/actions'
import { listEdielAgt2026Cases } from '@/lib/ediel/agtRegistry'

export const dynamic = 'force-dynamic'

const testCaseGroups = [
  { key: 'supplier-prodat', title: 'Leverantör PRODAT', roleCode: 'supplier', suite: 'PRODAT', href: '/admin/ediel/agt' },
  { key: 'supplier-utilts', title: 'Leverantör UTILTS', roleCode: 'supplier', suite: 'UTILTS', href: '/admin/ediel/system-tests' },
  { key: 'dgi-prodat', title: 'Energitjänsteföretag PRODAT', roleCode: 'esco', suite: 'PRODAT', href: '/admin/ediel/system-tests' },
  { key: 'dgi-utilts', title: 'Energitjänsteföretag UTILTS', roleCode: 'esco', suite: 'UTILTS', href: '/admin/ediel/system-tests' },
].map((group) => ({
  ...group,
  cases: listEdielAgt2026Cases({ roleCode: group.roleCode, suite: group.suite as 'PRODAT' | 'UTILTS' }),
}))

const transportGroup = {
  title: 'Transport & kryptering',
  cases: 'Okrypterat testläge och S/MIME testläge',
  href: '/admin/ediel/routes',
}

const testCaseOptions = listEdielAgt2026Cases().map((testCase) => ({
  value: testCase.testCaseCode,
  label: `${testCase.testCaseCode} - ${testCase.messageCode}${testCase.messageVariant ? ` ${testCase.messageVariant}` : ''}`,
  roleCode: testCase.roleCode,
  suite: testCase.suite,
  title: testCase.title,
}))

const roleOptions = [
  { value: 'supplier', label: 'Elleverantör / DDQ' },
  { value: 'esco', label: 'Energitjänsteföretag / DGI' },
]

export default async function EdielTestCenterPage() {
  const context = await requirePlatformAdminAccess()
  const [{ data: companies }, { data: recentRuns }] = await Promise.all([
    supabaseService
      .from('companies')
      .select('id,name')
      .order('name', { ascending: true })
      .limit(100),
    supabaseService
      .from('ediel_test_runs')
      .select('id,company_id,test_case_code,test_suite,role_code,actor_subrole,environment_type,status,encryption_mode,certificate_fingerprint_sha256,route_profile_id,created_at,failure_reason')
      .order('created_at', { ascending: false })
      .limit(8),
  ])

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
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black text-slate-950">Testfamiljer</h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-700">
            Välj flöde nedan. Rå EDIFACT, parsed view, CONTRL, APERAK, UTILTS-ERR och felorsak visas i respektive befintlig test-/AGT-arbetsyta.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {testCaseGroups.map((group) => (
              <Link key={group.key} href={group.href} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">{group.cases.map((testCase) => testCase.testCaseCode).join(', ')}</p>
                <h2 className="mt-2 text-lg font-black text-slate-950">{group.title}</h2>
                <p className="mt-2 text-sm font-medium text-slate-700">{group.roleCode} · {group.suite} · {group.cases.length} testfall</p>
              </Link>
            ))}
            <Link href={transportGroup.href} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">{transportGroup.cases}</p>
              <h2 className="mt-2 text-lg font-black text-slate-950">{transportGroup.title}</h2>
              <p className="mt-2 text-sm font-medium text-slate-700">Routes, S/MIME och dry-run transport</p>
            </Link>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {testCaseGroups.map((group) => (
              <div key={`${group.key}-expected`} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-black text-slate-950">{group.title}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-600">{group.roleCode} · {group.suite}</div>
                <ol className="mt-3 space-y-1 text-xs font-semibold text-slate-700">
                  {group.cases.slice(0, 4).map((testCase) => (
                    <li key={testCase.testCaseCode}>{testCase.testCaseCode}: {testCase.direction === 'actor_to_portal' ? 'actor skickar' : 'portal skickar'} · {testCase.applicationReference}</li>
                  ))}
                  {group.cases.length > 4 ? <li>+ {group.cases.length - 4} fler</li> : null}
                </ol>
                {group.roleCode === 'esco' ? (
                  <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-800">BRP krävs inte för DGI-flöden</p>
                ) : null}
              </div>
            ))}
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
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select name="testSuite" defaultValue="PRODAT" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="PRODAT">PRODAT</option>
              <option value="UTILTS">UTILTS</option>
            </select>
            <select name="testCaseCode" defaultValue="L1" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              {testCaseOptions.map((option) => (
                <option key={`${option.roleCode}-${option.suite}-${option.value}`} value={option.value}>
                  {option.label} · {option.roleCode} · {option.suite}
                </option>
              ))}
            </select>
            <select name="environment" defaultValue="test" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
              <option value="test">test</option>
              <option value="production">production-like test</option>
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
            {testCaseGroups.map((group) => (
              <div key={`${group.key}-transport`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-black text-slate-950">{group.title}</div>
                <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-600">{group.suite}</div>
                <div className="mt-3 text-sm text-slate-700">{group.cases.map((testCase) => testCase.testCaseCode).join(', ')}</div>
                <div className="mt-2 text-xs font-semibold text-slate-600">{group.cases.filter((testCase) => testCase.scenario === 'actor_sends_and_receives_ack').length} outbound-preflight · {group.cases.filter((testCase) => testCase.scenario === 'portal_sends_actor_answers').length} inboundväntande</div>
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
                <tr><th className="p-3">Test</th><th className="p-3">Transport</th><th className="p-3">Route</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody>
                {(recentRuns ?? []).map((run) => (
                  <tr key={run.id} className="border-t border-slate-100">
                    <td className="p-3 font-semibold">{run.test_suite} {run.test_case_code}<div className="text-xs font-normal text-slate-500">{run.role_code} / {run.actor_subrole ?? 'subroll saknas'} · {run.environment_type ?? 'env_type saknas'}</div></td>
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
