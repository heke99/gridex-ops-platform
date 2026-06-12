import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { fmt, safeListRows, statusBadge } from '@/lib/pricing/adminData'

export const dynamic = 'force-dynamic'

export default async function PortfolioPricesPage() {
  const admin = await requirePlatformAdminAccess()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const rows = await safeListRows('portfolio_monthly_prices', scope?.companyId ?? null, '*', 80)

  return <div className="min-h-screen bg-slate-50"><AdminHeader title="Portföljpriser" subtitle="Endast platform admin får skapa, ändra och publicera pris- och avtalslogik. Varje bolag lägger in sina egna portföljförvaltade månadspriser per elområde. Prismotorn använder company_id, elområde och fakturamånad." userEmail={admin.email} workspaceName={scope?.companyName} /><main className="p-8"><section className="rounded-3xl border bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Portföljpriser</h2><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">Månad</th><th>Elområde</th><th>Pris kr/kWh ex moms</th><th>Källa</th><th>Status</th></tr></thead><tbody className="divide-y">{rows.length === 0 ? <tr><td colSpan={5} className="py-8 text-center text-slate-500">Inga portföljpriser finns ännu.</td></tr> : null}{rows.map((row) => <tr key={String(row.id)}><td className="py-3">{fmt(row.billing_month)}</td><td>{fmt(row.price_area)}</td><td>{fmt(row.price_ex_vat_sek_per_kwh)}</td><td>{fmt(row.source)}</td><td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(row.status)}`}>{fmt(row.status)}</span></td></tr>)}</tbody></table></div></section></main></div>
}
