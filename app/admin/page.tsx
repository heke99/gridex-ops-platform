import AdminHeader from '@/components/admin/adminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Översikt"
        subtitle="Startpunkt för administration, roller och operativ kontroll."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-8 p-8">
        <section className="grid gap-5 xl:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Admin
            </p>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">
              Roller och behörigheter
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Hantera användare, tilläggsroller och individuella overrides för
              systemåtkomst.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Foundation
            </p>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">
              Nästa byggsteg
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Efter admin foundation går vi vidare med masterdata: kunder,
              anläggningar, mätpunkter, nätägare och elområden.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Drift
            </p>
            <h2 className="mt-3 text-lg font-semibold text-slate-950">
              Status
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Auth och admin är igång. Nu förbättrar vi skalet och fortsätter
              bygga systemets kärna i rätt ordning.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950">Vad som byggs nu</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              'RBAC och access',
              'Admin shell',
              'Audit log',
              'Masterdata foundation',
            ].map((item) => (
              <div
                key={item}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}