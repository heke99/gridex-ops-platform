import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'

export const dynamic = 'force-dynamic'

const checks = [
  '/admin/companies är platform-only i middleware, page guard och server actions.',
  '/admin/users och /admin/roles är platform-only.',
  'Company admin använder /admin/company-settings för sitt eget bolag.',
  'Dashboard visar bolagsscope för vanliga elbolag och plattformsdata bara för superadmin.',
  'Service-client-anrop behöver fortsatt granskas när nya actions läggs till.',
]

export default async function PlatformSecurityPage() {
  const admin = await requirePlatformAdminAccess()

  return (
    <div className="min-h-screen">
      <AdminHeader title="Säkerhetskontroll" subtitle="Platform-only RBAC- och tenant-scope checklista." userEmail={admin.email} />
      <div className="p-4 sm:p-6 xl:p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">Aktiva kontroller i denna batch</h2>
          <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
            {checks.map((check) => <li key={check} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">{check}</li>)}
          </ul>
        </section>
      </div>
    </div>
  )
}
