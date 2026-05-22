import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { calculateCustomerReadinessScore } from '@/lib/customers/readinessScore'

export const dynamic = 'force-dynamic'

type GenericRow = Record<string, unknown> & { id: string; customer_id?: string | null }

type CustomerRow = GenericRow & {
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  customer_type?: string | null
  status?: string | null
  email?: string | null
}

function groupByCustomer(rows: GenericRow[]) {
  const map = new Map<string, GenericRow[]>()
  for (const row of rows) {
    const customerId = typeof row.customer_id === 'string' ? row.customer_id : null
    if (!customerId) continue
    const current = map.get(customerId) ?? []
    current.push(row)
    map.set(customerId, current)
  }
  return map
}

function tone(score: number) {
  if (score >= 80) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (score >= 50) return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-red-200 bg-red-50 text-red-800'
}

function customerName(customer: CustomerRow) {
  return customer.full_name || customer.company_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.email || customer.id
}

export default async function BillingQualityPage() {
  const admin = await requireAdminPageKeyAccess('billing.workspace')
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const scope = user ? await getOperationalCompanyScope(user.id) : null
  const companyId = scope?.companyId ?? null

  const [customersResult, sitesResult, metersResult, contractsResult, poaResult, billingResult, exportsResult] = companyId
    ? await Promise.all([
        supabase.from('customers').select('*').eq('company_id', companyId).order('updated_at', { ascending: false }).limit(80),
        supabase.from('customer_sites').select('*').eq('company_id', companyId).limit(1000),
        supabase.from('metering_points').select('*').eq('company_id', companyId).limit(1000),
        supabase.from('customer_contracts').select('*').eq('company_id', companyId).limit(1000),
        supabase.from('powers_of_attorney').select('*').eq('company_id', companyId).limit(1000),
        supabase.from('billing_underlays').select('*').eq('company_id', companyId).limit(1000),
        supabase.from('partner_exports').select('*').eq('company_id', companyId).limit(1000),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ]

  const loadError = [customersResult, sitesResult, metersResult, contractsResult, poaResult, billingResult, exportsResult]
    .map((result) => result.error?.message)
    .find(Boolean)

  const customers = ((customersResult.data ?? []) as CustomerRow[])
  const sitesByCustomer = groupByCustomer((sitesResult.data ?? []) as GenericRow[])
  const metersByCustomer = groupByCustomer((metersResult.data ?? []) as GenericRow[])
  const contractsByCustomer = groupByCustomer((contractsResult.data ?? []) as GenericRow[])
  const poaByCustomer = groupByCustomer((poaResult.data ?? []) as GenericRow[])
  const billingByCustomer = groupByCustomer((billingResult.data ?? []) as GenericRow[])
  const exportsByCustomer = groupByCustomer((exportsResult.data ?? []) as GenericRow[])

  const rows = customers.map((customer) => {
    const score = calculateCustomerReadinessScore({
      customer,
      sites: sitesByCustomer.get(customer.id) ?? [],
      meteringPoints: metersByCustomer.get(customer.id) ?? [],
      contracts: contractsByCustomer.get(customer.id) ?? [],
      powersOfAttorney: poaByCustomer.get(customer.id) ?? [],
      billingUnderlays: billingByCustomer.get(customer.id) ?? [],
      partnerExports: exportsByCustomer.get(customer.id) ?? [],
    })
    const average = Math.round((score.customerScore + score.contractScore + score.powerOfAttorneyScore + score.siteScore + score.billingScore) / 5)
    return { customer, score, average }
  })

  const readyForExport = rows.filter((row) => row.score.readyForExport).length
  const blocked = rows.filter((row) => row.score.blockers.some((blocker) => blocker.severity === 'blocked')).length

  return (
    <div className="min-h-screen">
      <AdminHeader title="Datakvalitet och readiness" subtitle="Kundredo-score för avtal, leverantörsbyte, fakturering och export per bolag." userEmail={admin.email} />
      <div className="space-y-6 p-8">
        {loadError ? <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-900">Kunde inte läsa all readiness-data. Kör senaste migrationer: {loadError}</section> : null}
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm font-medium text-slate-700">Kunder</div><div className="mt-2 text-3xl font-semibold text-slate-950">{rows.length}</div></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm"><div className="text-sm font-medium text-emerald-800">Redo för export</div><div className="mt-2 text-3xl font-semibold text-slate-950">{readyForExport}</div></div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm"><div className="text-sm font-medium text-red-800">Blockerade</div><div className="mt-2 text-3xl font-semibold text-slate-950">{blocked}</div></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm font-medium text-slate-700">Snittscore</div><div className="mt-2 text-3xl font-semibold text-slate-950">{rows.length ? Math.round(rows.reduce((sum, row) => sum + row.average, 0) / rows.length) : 0}%</div></div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Kundredo-score</h2>
            <p className="mt-1 text-sm text-slate-700">Visar om kunden är redo för avtal, leverantörsbyte, fakturering och export. Poängen sparas inte automatiskt; den beräknas från aktuell tenant-data.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-6 py-4 font-semibold">Kund</th>
                  <th className="px-6 py-4 font-semibold">Kunddata</th>
                  <th className="px-6 py-4 font-semibold">Anläggning</th>
                  <th className="px-6 py-4 font-semibold">Avtal</th>
                  <th className="px-6 py-4 font-semibold">Fullmakt</th>
                  <th className="px-6 py-4 font-semibold">Fakturering</th>
                  <th className="px-6 py-4 font-semibold">Redo</th>
                  <th className="px-6 py-4 font-semibold">Blockerare</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ customer, score }) => (
                  <tr key={customer.id} className="align-top">
                    <td className="px-6 py-4"><Link href={`/admin/customers/${customer.id}`} className="font-semibold text-slate-950 hover:text-emerald-700">{customerName(customer)}</Link><div className="mt-1 text-xs text-slate-500">{customer.customer_type ?? 'kund'} · {customer.status ?? 'status saknas'}</div></td>
                    {[score.customerScore, score.siteScore, score.contractScore, score.powerOfAttorneyScore, score.billingScore].map((value, index) => <td key={index} className="px-6 py-4"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone(value)}`}>{value}%</span></td>)}
                    <td className="px-6 py-4 text-xs text-slate-700">
                      <div>Avtal: {score.readyForContract ? 'Ja' : 'Nej'}</div>
                      <div>Byte: {score.readyForSwitch ? 'Ja' : 'Nej'}</div>
                      <div>Faktura: {score.readyForBilling ? 'Ja' : 'Nej'}</div>
                      <div>Export: {score.readyForExport ? 'Ja' : 'Nej'}</div>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-700">{score.blockers.length === 0 ? '—' : score.blockers.slice(0, 3).map((blocker) => <div key={blocker.code} className="mb-1 rounded-xl bg-amber-50 px-2 py-1 text-amber-900">{blocker.title}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
