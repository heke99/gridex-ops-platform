import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'

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

export default async function EdielTestCenterPage() {
  const context = await requirePlatformAdminAccess()

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
            {tabs.map((tab) => (
              <Link key={tab.title} href={tab.href} className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">{tab.cases}</p>
                <h2 className="mt-2 text-lg font-black text-slate-950">{tab.title}</h2>
                <p className="mt-2 text-sm font-medium text-slate-700">Öppna testarbetsyta</p>
              </Link>
            ))}
          </div>
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
      </main>
    </div>
  )
}
