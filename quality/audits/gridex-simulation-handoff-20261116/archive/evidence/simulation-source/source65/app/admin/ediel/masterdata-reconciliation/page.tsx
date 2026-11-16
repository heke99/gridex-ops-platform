import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'

export const dynamic = 'force-dynamic'

const items = [
  { title: 'AI-listimport', text: 'Importera AI-lista från nätägare och skapa snapshot för anläggningar/mätpunkter.' },
  { title: 'Masterdata-diff', text: 'Jämför nätägare, leverantör, kund, anläggning och mätpunkt innan negativ APERAK skickas i produktion.' },
  { title: 'Matchkandidater', text: 'Visa möjliga kund-/anläggningsmatchningar när engine har låg confidence.' },
  { title: 'Manual review', text: 'Skicka osäkra matchningar till manuell granskning i stället för att automatiskt avvisa.' },
]

export default async function EdielMasterdataReconciliationPage() {
  const context = await requirePlatformAdminAccess()

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Ediel masterdata"
        subtitle="Enkel grund för AI-lista och masterdata reconciliation. Full avancerad modul byggs senare."
        userEmail={context.email}
        workspaceName="Gridex Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-8">
        <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-6 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-900">Batch 4 · Foundation</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Minska manual review i produktion</h1>
          <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
            Den här ytan ska hjälpa engine att skilja mellan säkert fel och osäker matchning. Osäker produktion ska till manual review, inte automatiskt negativ APERAK.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/admin/ediel/rule-profiles" className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Regelprofiler</Link>
            <Link href="/admin/ediel/unresolved" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-900 hover:bg-slate-50">Manuell granskning</Link>
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-slate-950">{item.title}</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">{item.text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
