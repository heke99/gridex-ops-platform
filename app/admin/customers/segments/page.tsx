// app/admin/customers/segments/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { formatAdminDate } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

type SegmentCustomer = {
 id: string
 company_id: string
 full_name: string | null
 company_name: string | null
 first_name: string | null
 last_name: string | null
 customer_number: string | null
 customer_type: string | null
 status: string | null
 email: string | null
 phone: string | null
 created_at: string | null
 site_count: number
 active_site_count: number
}

type SegmentKey = 'all' | 'signed' | 'pending_activation' | 'move' | 'switch'

type PageProps = {
 searchParams: Promise<{
 q?: string
 segment?: string
 page?: string
 }>
}

function normalizeSegment(value: string | undefined): SegmentKey {
 if (value === 'signed') return 'signed'
 if (value === 'pending_activation') return 'pending_activation'
 if (value === 'move') return 'move'
 if (value === 'switch') return 'switch'
 return 'all'
}

function customerName(customer: SegmentCustomer): string {
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

function buildHref(segment: SegmentKey, q: string, page = 1): string {
 const params = new URLSearchParams()
 if (segment !== 'all') params.set('segment', segment)
 if (q) params.set('q', q)
 if (page > 1) params.set('page', String(page))
 return `/admin/customers/segments${params.toString() ? `?${params.toString()}` : ''}`
}

type SegmentRead = { rows: SegmentCustomer[]; counts: Record<SegmentKey, number>; page: number }

function validRead(value: unknown, companyId: string | null, segment: SegmentKey): value is SegmentRead {
 if (!value || typeof value !== 'object') return false
 const { rows, counts, page } = value as SegmentRead
 if (!Array.isArray(rows) || !counts || !Number.isSafeInteger(page) || page < 1) return false
 const keys = ['all', 'signed', 'pending_activation', 'move', 'switch'] as const
 if (!keys.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0 && counts[key] <= counts.all)) return false
 const remaining = counts[segment] - (page - 1) * PAGE_SIZE
 return (remaining > 0 || (page === 1 && remaining === 0)) && rows.length === Math.min(PAGE_SIZE, remaining)
   && rows.every(row => row && typeof row.id === 'string' && typeof row.company_id === 'string' && (!companyId || row.company_id === companyId))
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

 const requestedPage = Number(resolvedSearchParams.page ?? '1')
 const pageNumber = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1_000_000 ? requestedPage : 1
 const supabase = await createSupabaseServerClient()
 const result = await supabase.rpc('gridex_customer_segments_page_v1', {
  p_company_id: tenantScope.companyId,
  p_query: query,
  p_segment: segment,
  p_page: pageNumber,
  p_page_size: PAGE_SIZE,
 })
 if (result.error || !validRead(result.data, tenantScope.companyId, segment)) {
  return <main className="p-6" role="alert"><h1>Kundsegmenten kunde inte läsas</h1>
   <Link href={buildHref(segment, query)}>Läs kundsegmenten igen</Link>
  </main>
 }

 const { rows: filteredCustomers, counts, page } = result.data
 const total = counts[segment]
 const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

 return (
 <div className="min-h-screen">
 <AdminHeader
 title="Kundsegment"
 subtitle="Signerade avtal, väntande aktivering, flytt och leverantörsbyten."
 userEmail={access.email}
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
 {segment !== 'all' ? <input type="hidden" name="segment" value={segment} /> : null}
 <div className="flex-1">
 <label htmlFor="segment-search" className="mb-2 block text-sm font-medium text-slate-700 ">
 Sök kund
 </label>
 <input
 id="segment-search"
 name="q"
 defaultValue={query}
 placeholder="Namn, kundnummer, e-post, telefon, person- eller organisationsnummer"
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
 {total} kunder i vald segmentvy.
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
 {formatAdminDate(customer.created_at)}
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
 {pages > 1 ? <nav aria-label="Sidor i kundsegmentet" className="flex flex-wrap items-center gap-4 border-t border-slate-200 p-4 text-sm">
  {page > 1 ? <Link className="font-semibold underline" href={buildHref(segment, query, page - 1)}>Föregående sida</Link> : null}
  <span>Sida {page} av {pages}</span>
  {page < pages ? <Link className="font-semibold underline" href={buildHref(segment, query, page + 1)}>Nästa sida</Link> : null}
 </nav> : null}
 </section>
 </div>
 </div>
 )
}
