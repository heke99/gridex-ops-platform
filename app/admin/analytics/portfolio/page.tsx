import AdminHeader from '@/components/admin/AdminHeader'
import { CustomerPortfolioPanel } from '@/components/admin/analytics/CustomerPortfolioViews'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getCustomerPortfolio } from '@/lib/analytics/customerPortfolio'
import { addMonths, monthStart } from '@/lib/analytics/utils'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<{ month?: string }> }

export default async function CustomerPortfolioPage({ searchParams }: PageProps) {
  const admin = await requireAdminPageKeyAccess('analytics.workspace')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  const params = await searchParams
  const month = monthStart(params.month)

  if (!companyId) {
    return <div className="p-8">Bolag saknas.</div>
  }

  const portfolio = await getCustomerPortfolio(companyId, addMonths(month, -11), month)

  return (
    <div className="min-h-screen">
      <AdminHeader title="Kundportfölj" subtitle="Aktiva, nya och lämnade kunder per månad, fullmakter, mätvärdesbegäranden och förbrukningsprognos framåt." userEmail={admin.email} />
      <div className="space-y-6 p-4 sm:p-6 xl:p-8">
        <form className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-bold text-slate-700">
            Månad
            <input type="month" name="month" defaultValue={month.slice(0, 7)} className="mt-1 block rounded-2xl border border-slate-300 px-3 py-2" />
          </label>
          <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">Visa</button>
        </form>
        <CustomerPortfolioPanel {...portfolio} />
      </div>
    </div>
  )
}
