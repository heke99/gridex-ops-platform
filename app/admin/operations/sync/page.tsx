import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import CustomerSyncBoard from '@/components/admin/operations/CustomerSyncBoard'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listMeteringPointsBySiteIds } from '@/lib/masterdata/db'
import { listAllSupplierSwitchRequests } from '@/lib/operations/db'
import { listAllBillingUnderlays, listAllGridOwnerDataRequests, listAllMeteringValues, listOutboundRequests } from '@/lib/cis/db'
import { buildCustomerSyncProfiles, type CustomerSyncCustomerRow } from '@/lib/operations/customerSync'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'

export const dynamic = 'force-dynamic'

function SyncGuideCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-base font-semibold text-slate-950 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{body}</p>
    </div>
  )
}

export default async function OperationsSyncPage() {
  await requireAdminPageKeyAccess('operations.sync')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const customersQuery = await supabase
    .from('customers')
    .select(
      'id, customer_type, status, first_name, last_name, full_name, company_name, email, phone, personal_number, org_number, customer_number, apartment_number, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(500)

  if (customersQuery.error) throw customersQuery.error

  const customers = (customersQuery.data ?? []) as CustomerSyncCustomerRow[]
  const customerIds = customers.map((customer) => customer.id)

  const [sitesQuery, contractsQuery, powersOfAttorneyQuery] =
    customerIds.length > 0
      ? await Promise.all([
          supabase
            .from('customer_sites')
            .select('*')
            .in('customer_id', customerIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('customer_contracts')
            .select('*')
            .in('customer_id', customerIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('powers_of_attorney')
            .select('*')
            .in('customer_id', customerIds)
            .order('created_at', { ascending: false }),
        ])
      : [
          { data: [], error: null },
          { data: [], error: null },
          { data: [], error: null },
        ]

  if (sitesQuery.error) throw sitesQuery.error
  if (contractsQuery.error) throw contractsQuery.error
  if (powersOfAttorneyQuery.error) throw powersOfAttorneyQuery.error

  const sites = (sitesQuery.data ?? []) as CustomerSiteRow[]
  const meteringPoints = await listMeteringPointsBySiteIds(
    supabase,
    sites.map((site) => site.id)
  )

  const [switchRequests, gridOwnerDataRequests, meteringValues, billingUnderlays, outboundRequests] =
    await Promise.all([
      listAllSupplierSwitchRequests(supabase),
      listAllGridOwnerDataRequests({ status: 'all', scope: 'all', query: '' }),
      listAllMeteringValues({ query: '' }),
      listAllBillingUnderlays({ status: 'all', query: '' }),
      listOutboundRequests({ status: 'all', requestType: 'all', channelType: 'all', query: '' }),
    ])

  const relevantCustomerIds = new Set(customerIds)
  const syncResult = buildCustomerSyncProfiles({
    customers,
    sites,
    meteringPoints,
    contracts: (contractsQuery.data ?? []) as CustomerContractRow[],
    powersOfAttorney: (powersOfAttorneyQuery.data ?? []) as PowerOfAttorneyRow[],
    switchRequests: switchRequests.filter((row) => relevantCustomerIds.has(row.customer_id)),
    gridOwnerDataRequests: gridOwnerDataRequests.filter((row) => relevantCustomerIds.has(row.customer_id)),
    meteringValues: meteringValues.filter((row) => relevantCustomerIds.has(row.customer_id)),
    billingUnderlays: billingUnderlays.filter((row) => relevantCustomerIds.has(row.customer_id)),
    outboundRequests: outboundRequests.filter((row) => relevantCustomerIds.has(row.customer_id)),
  })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Kundsynk och onboarding"
        subtitle="Operations Core: se vilka kunder som är redo, blockerade eller saknar datakoppling innan Ediel/live-flöden går vidare."
        userEmail={user?.email ?? null}
      />

      <div className="space-y-8 p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/operations"
            className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Till operations
          </Link>
          <Link
            href="/admin/customers/intake"
            className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950"
          >
            Nytt kundintag
          </Link>
          <Link
            href="/admin/contracts"
            className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Avtal/kampanjer
          </Link>
        </div>

        <CustomerSyncBoard result={syncResult} limit={30} />

        <section className="grid gap-5 lg:grid-cols-3">
          <SyncGuideCard
            title="Matchningsnycklar"
            body="Systemet ska matcha inkommande data på kundnummer, person-/orgnummer, anläggnings-id, mätpunkts-id och Ediel-referens. Saknas någon av dessa visas kunden som blockerad eller kräver komplettering."
          />
          <SyncGuideCard
            title="SaaS-scope"
            body="Alla nya operationsobjekt ska ligga i samma company/tenant-scope. Superadmin får överblick, men ett elbolag ska bara se och hantera sina egna kunder, avtal, mätpunkter och Ediel-kedjor."
          />
          <SyncGuideCard
            title="Nästa automation"
            body="När kund, avtal, fullmakt, anläggning och mätpunkt är klara ska leverantörsbyte kunna köas. När switchen är aktiv ska mätvärden och billing-underlag kopplas tillbaka till samma kundkort."
          />
        </section>
      </div>
    </div>
  )
}
