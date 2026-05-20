import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'

export const dynamic = 'force-dynamic'

const CHECKS = [
  {
    title: 'Company admin blockerad från /admin/companies',
    status: 'Krav täcks av middleware + requirePlatformAdminAccess på sidan.',
  },
  {
    title: 'Globala user-actions är superadmin-only',
    status: 'app/admin/users/actions.ts och app/admin/users/[id]/actions.ts använder requirePlatformAdminActionAccess.',
  },
  {
    title: 'Globala Ediel-regler separerade',
    status: '/admin/platform/ediel/rules, /versions och /routes finns som plattformsrutter.',
  },
  {
    title: 'Company settings är company-scoped',
    status: 'Bolagsuppgifter sparas via requireCompanyScopedActionAccess och company_id-kontroll.',
  },
  {
    title: 'Pausade/stängda bolag stoppar writes',
    status: 'Governance-flöden använder operational status och migrationen lägger RLS-/helpergrund.',
  },
  {
    title: 'Statisk RBAC-testsvit',
    status: 'Kör npm run security:rbac lokalt/CI för att kontrollera guards, platform-routes och company settings-fält.',
  },
]

export default async function PlatformSecurityPage() {
  const admin = await requirePlatformAdminAccess()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="RBAC säkerhetskontroll"
        subtitle="Superadmin-only kontrollsida för Batch 6E: server actions, plattformsrutter, company scope och testkommandon."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Automatiserad kontroll</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Kör detta efter migration/build för att få en snabb röd/grön säkerhetskontroll av de viktigaste Batch 6E-kraven.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-slate-900">npm run security:rbac</pre>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          {CHECKS.map((check) => (
            <article key={check.title} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 rounded-full bg-emerald-500" />
                <div>
                  <h3 className="text-base font-semibold text-slate-950">{check.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{check.status}</p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Manuella roller som fortfarande ska testas i Supabase-miljön</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Logga in som company admin och försök öppna /admin/companies direkt.</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Logga in som viewer och försök posta en write-action från UI.</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Pausa ett bolag och försök skapa Ediel/export för bolaget.</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">Kontrollera att company admin inte ser /admin/platform/* i sidebar eller via URL.</div>
          </div>
        </section>
      </div>
    </div>
  )
}
