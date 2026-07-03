// app/admin/customers/segments/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getCustomers } from '@/lib/customers/getCustomers'
import { supabaseService } from '@/lib/supabase/service'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { SupplierSwitchRequestRow } from '@/lib/operations/types'
import type { CustomerContractRow } from '@/lib/customer-contracts/types'

export const dynamic = 'force-dynamic'

// Segment matching only needs these columns; selecting them (instead of *) keeps
// this page cheap even for tenants with large contract/site/switch volumes.
type SegmentContractRow = Pick<CustomerContractRow, 'customer_id' | 'status'>
type SegmentSiteRow = Pick<CustomerSiteRow, 'customer_id' | 'status'>
type SegmentSwitchRow = Pick<SupplierSwitchRequestRow, 'customer_id' | 'status' | 'request_type'>

const SEGMENT_RELATED_ROW_LIMIT = 5000

type SegmentKey = 'all' | 'signed' | 'pending_activation' | 'move' | 'switch'

type PageProps = {
 searchParams: Promise<{
 q?: string
 segment?: string
 }>
}

function normalizeSegment(value: string | undefined): SegmentKey {
 if (value === 'signed') return 'signed'
 if (value === 'pending_activation') return 'pending_activation'
 if (value === 'move') return 'move'
 if (value === 'switch') return 'switch'
 return 'all'
}

function customerName(customer: Awaited<ReturnType<typeof getCustomers>>[number]): string {
 const combinedName = [customer.first_name, customer.last_name]
 .filter(Boolean)
 .join(' ')
 .trim()

 return (
 customer.full_name ??
 customer.company_name ??
 (combinedName || 'Kund')
 )
}

function customerTypeLabel(value: string | null): string {
 if (value === 'business') return 'Företag'
 if (value === 'association') return 'Förening'
 return 'Privat'
}

function buildHref(segment: SegmentKey, q: string): string {
 const params = new URLSearchParams()
 if (segment !== 'all') params.set('segment', segment)
 if (q) params.set('q', q)
 return `/admin/customers/segments${params.toString() ? `?${params.toString()}` : ''}`
}

function getSiteStatus(site: SegmentSiteRow): string | null {
 return typeof site.status === 'string' ? site.status : null
}

function isPendingActivationSiteStatus(status: string | null): boolean {
 return status === 'pending_activation' || status === 'pending_move'
}

function matchesSegment(params: {
 segment: SegmentKey
 customerId: string
 contracts: SegmentContractRow[]
 sites: SegmentSiteRow[]
 switchRequests: SegmentSwitchRow[]
}): boolean {
 const { segment, customerId, contracts, sites, switchRequests } = params

 if (segment === 'all') return true

 const customerContracts = contracts.filter((row) => row.customer_id === customerId)
 const customerSites = sites.filter((row) => row.customer_id === customerId)
 const customerSwitches = switchRequests.filter((row) => row.customer_id === customerId)

 if (segment === 'signed') {
 return customerContracts.some((row) => ['signed', 'active'].includes(row.status))
 }

 if (segment === 'pending_activation') {
 return (
 customerContracts.some((row) => ['pending_signature', 'signed'].includes(row.status)) ||
 customerSites.some((row) => isPendingActivationSiteStatus(getSiteStatus(row)))
 )
 }

 if (segment === 'move') {
 return customerSwitches.some(
 (row) =>
 ['move_in', 'move_out_takeover'].includes(row.request_type) &&
 !['completed', 'failed', 'rejected'].includes(row.status)
 )
 }

 if (segment === 'switch') {
 return customerSwitches.some(
 (row) =>
 row.request_type === 'switch' &&
 !['completed', 'failed', 'rejected'].includes(row.status)
 )
 }

 return true
}

function countForSegment(
 segment: SegmentKey,
 customerIds: string[],
 contracts: SegmentContractRow[],
 sites: SegmentSiteRow[],
 switchRequests: SegmentSwitchRow[]
): number {
 return customerIds.filter((customerId) =>
 matchesSegment({
 segment,
 customerId,
 contracts,
 sites,
 switchRequests,
 })
 ).length
}

export default async function CustomerSegmentsPage({ searchParams }: PageProps) {
 const access = await requireAdminPageKeyAccess('customers.segments')
 const tenantScope = await resolveAdminTenantReadScope(access)
 if (!tenantScope.isPlatformAdmin && !tenantScope.companyId) {
  redirect('/admin/company-settings')
 }

 const resolvedSearchParams = await searchParams
 const query = (resolvedSearchParams.q ?? '').trim()
 const segment = normalizeSegment(resolvedSearchParams.segment)

 const customers = await getCustomers({
  query,
  companyId: tenantScope.isPlatformAdmin ? null : tenantScope.companyId,
 })
 const customerIds = customers.map((customer) => customer.id)

 const [
 { data: contracts, error: contractsError },
 { data: sites, error: sitesError },
 { data: switchRequests, error: switchError },
 supabase,
 ] = await Promise.all([
 customerIds.length > 0
 ? supabaseService
 .from('customer_contracts')
 .select('customer_id,status')
 .in('customer_id', customerIds)
 .limit(SEGMENT_RELATED_ROW_LIMIT)
 : Promise.resolve({ data: [], error: null }),
 customerIds.length > 0
 ? supabaseService
 .from('customer_sites')
 .select('customer_id,status')
 .in('customer_id', customerIds)
 .limit(SEGMENT_RELATED_ROW_LIMIT)
 : Promise.resolve({ data: [], error: null }),
 customerIds.length > 0
 ? supabaseService
 .from('supplier_switch_requests')
 .select('customer_id,status,request_type')
 .in('customer_id', customerIds)
 .limit(SEGMENT_RELATED_ROW_LIMIT)
 : Promise.resolve({ data: [], error: null }),
 createSupabaseServerClient(),
 ])

 if (contractsError) throw contractsError
 if (sitesError) throw sitesError
 if (switchError) throw switchError

 const {
 data: { user },
 } = await supabase.auth.getUser()

 const typedContracts = (contracts ?? []) as SegmentContractRow[]
 const typedSites = (sites ?? []) as SegmentSiteRow[]
 const typedSwitches = (switchRequests ?? []) as SegmentSwitchRow[]

 const filteredCustomers = customers.filter((customer) =>
 matchesSegment({
 segment,
 customerId: customer.id,
 contracts: typedContracts,
 sites: typedSites,
 switchRequests: typedSwitches,
 })
 )

 const counts = {
 all: customers.length,
 signed: countForSegment('signed', customerIds, typedContracts, typedSites, typedSwitches),
 pending_activation: countForSegment(
 'pending_activation',
 customerIds,
 typedContracts,
 typedSites,
 typedSwitches
 ),
 move: countForSegment('move', customerIds, typedContracts, typedSites, typedSwitches),
 switch: countForSegment('switch', customerIds, typedContracts, typedSites, typedSwitches),
 }

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Kundsegment"
 subtitle="Separata vyer för signerat, väntar aktiv, flytt och byte."
 userEmail={user?.email ?? null}
 />

 <div className="space-y-6 p-8">
 <div className="flex flex-wrap gap-3">
 <Link
 href="/admin/customers"
 className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 "
 >
 Till kundlistan
 </Link>
 <Link
 href="/admin/customers/intake"
 className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 "
 >
 Kundintag
 </Link>
 </div>

 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <form className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
 <div className="flex-1">
 <label className="mb-2 block text-sm font-medium text-slate-700 ">
 Sök kund
 </label>
 <input
 name="q"
 defaultValue={query}
 placeholder="Namn, e-post, org.nr, anläggning, adress, mätpunkts-id..."
 className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm "
 />
 </div>

 <div>
 <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Filtrera
 </button>
 </div>
 </form>

 <div className="mt-6 flex flex-wrap gap-3">
 <Link
 href={buildHref('all', query)}
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold"
 >
 Alla ({counts.all})
 </Link>
 <Link
 href={buildHref('signed', query)}
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold"
 >
 Signerat ({counts.signed})
 </Link>
 <Link
 href={buildHref('pending_activation', query)}
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold"
 >
 Väntar aktiv ({counts.pending_activation})
 </Link>
 <Link
 href={buildHref('move', query)}
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold"
 >
 Flytt ({counts.move})
 </Link>
 <Link
 href={buildHref('switch', query)}
 className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-semibold"
 >
 Byte ({counts.switch})
 </Link>
 </div>
 </section>

 <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-4 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Resultat
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {filteredCustomers.length} kunder i vald segmentvy.
 </p>
 </div>

 <div className="overflow-x-auto">
 <table className="min-w-full text-sm">
 <thead className="bg-slate-50 ">
 <tr className="text-left text-slate-700 ">
 <th className="px-6 py-3 font-medium">Kund</th>
 <th className="px-6 py-3 font-medium">Typ</th>
 <th className="px-6 py-3 font-medium">Status</th>
 <th className="px-6 py-3 font-medium">Kontakt</th>
 <th className="px-6 py-3 font-medium">Anläggningar</th>
 <th className="px-6 py-3 font-medium">Skapad</th>
 <th className="px-6 py-3 font-medium">Öppna</th>
 </tr>
 </thead>

 <tbody className="divide-y divide-slate-200 ">
 {filteredCustomers.map((customer) => (
 <tr key={customer.id} className="text-slate-800 ">
 <td className="px-6 py-4">
 <div className="font-medium">{customerName(customer)}</div>
 <div className="mt-1 text-xs text-slate-700 ">
 {customer.customer_number ?? customer.id}
 </div>
 </td>
 <td className="px-6 py-4">{customerTypeLabel(customer.customer_type)}</td>
 <td className="px-6 py-4">{customer.status ?? '—'}</td>
 <td className="px-6 py-4">
 <div>{customer.email ?? '—'}</div>
 <div className="mt-1 text-xs text-slate-700 ">
 {customer.phone ?? '—'}
 </div>
 </td>
 <td className="px-6 py-4">
 {customer.site_count} st
 <div className="mt-1 text-xs text-slate-700 ">
 Aktiva: {customer.active_site_count}
 </div>
 </td>
 <td className="px-6 py-4">
 {new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 }).format(new Date(customer.created_at))}
 </td>
 <td className="px-6 py-4">
 <Link
 href={`/admin/customers/${customer.id}`}
 className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
 >
 Öppna
 </Link>
 </td>
 </tr>
 ))}

 {filteredCustomers.length === 0 ? (
 <tr>
 <td
 colSpan={7}
 className="px-6 py-10 text-center text-sm text-slate-700 "
 >
 Inga kunder matchade sökningen eller vald segmentvy.
 </td>
 </tr>
 ) : null}
 </tbody>
 </table>
 </div>
 </section>
 </div>
 </div>
 )
}