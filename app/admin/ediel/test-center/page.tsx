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
      </main>
    </div>
  )
}
