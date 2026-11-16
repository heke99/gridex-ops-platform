import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getManualMailReviewQueue, getManualMailReviewNames, formatManualMailTime, manualMailReviewReasons } from '@/lib/inbound-mail/manualMailReviewQueue'

export const dynamic = 'force-dynamic'
export default async function MailReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdminAccess()
  const db = await createSupabaseServerClient()
  const params = await searchParams
  let result: Awaited<ReturnType<typeof getManualMailReviewQueue>>
  try { result = await getManualMailReviewQueue(db, params) } catch (error) {
    return <main className="p-8"><h1 className="text-2xl font-bold">Mejlgranskning</h1><p role="alert" className="mt-4">{error instanceof Error ? error.message : 'Kön kunde inte hämtas.'}</p><Link href="/admin/mail-review" className="underline">Rensa sökningen</Link></main>
  }
  const names = await getManualMailReviewNames(db, result.rows)
  const href = (page: number) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(result.filters)) if (value && key !== 'page') query.set(key, String(value))
    query.set('page', String(page)); return `/admin/mail-review?${query}`
  }
  return <div className="min-h-screen bg-slate-50">
    <AdminHeader title="Mejlgranskning" subtitle="Svar som behöver kontrolleras före fortsatt automatisk handläggning. Tider visas i svensk tid." userEmail={admin.email} workspaceName="Gridex Platform" workspaceMode="platform" />
    <main className="space-y-6 p-6 lg:p-8">
      <nav aria-label="Mejlhantering" className="flex flex-wrap gap-4"><Link href="/admin/mail-review" aria-current="page" className="font-bold underline">Mejlgranskning</Link><Link href="/admin/manual-requests" className="underline">Förfrågningar och utskick</Link><Link href="/admin/powers-of-attorney" className="underline">Fullmakter</Link></nav>
      <form method="get" className="grid gap-4 rounded-2xl border bg-white p-5 md:grid-cols-5">
        <label className="text-sm font-semibold">Tenant<input name="tenant" defaultValue={result.filters.tenant ?? ''} maxLength={120} className="mt-2 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm font-semibold">Kundnamn eller kundnummer<input name="customer" defaultValue={result.filters.customer ?? ''} maxLength={120} className="mt-2 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm font-semibold">Från datum<input name="from" type="date" defaultValue={result.filters.from ?? ''} className="mt-2 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm font-semibold">Till datum<input name="to" type="date" defaultValue={result.filters.to ?? ''} className="mt-2 block w-full rounded-lg border p-2" /></label>
        <div className="flex items-end gap-3"><button type="submit" className="rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white">Sök</button><Link href="/admin/mail-review" className="py-2 underline">Rensa</Link></div>
      </form>
      <p role="status">{result.total} mejl behöver granskas.</p>
      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="min-w-full text-left text-sm"><caption className="sr-only">Inkommande mejl som behöver granskas</caption><thead className="bg-slate-100"><tr>{['Mottaget', 'Mejl', 'Tenant och kund', 'Granskning'].map(label => <th key={label} scope="col" className="p-4">{label}</th>)}</tr></thead><tbody className="divide-y">
        {!result.rows.length && <tr><td colSpan={4} className="p-6">Inga mejl matchar sökningen.</td></tr>}
        {result.rows.map(row => <tr key={row.id} className="align-top"><td className="p-4 whitespace-nowrap">{formatManualMailTime(row.received_at)}</td><td className="max-w-md break-words p-4"><Link href={`/admin/mail-review/${encodeURIComponent(row.id)}`} className="font-semibold underline">{row.subject || 'Utan ämne'}</Link><p className="mt-1 text-slate-600">{row.from_email || 'Avsändare saknas'}</p></td><td className="p-4 break-all"><p>{(row.company_id && names.companies.get(row.company_id)) || row.company_id || 'Tenant behöver identifieras'}</p><p className="mt-1">{(row.customer_id && names.customers.get(row.customer_id)) || row.customer_id || 'Kund behöver identifieras'}</p></td><td className="p-4"><ul className="space-y-1">{manualMailReviewReasons(row).map(reason => <li key={reason}>{reason}</li>)}</ul></td></tr>)}
      </tbody></table></div>
      <nav aria-label="Sidindelning för mejlgranskning" className="flex gap-4">{result.page > 1 && <Link href={href(result.page - 1)} className="underline">Föregående</Link>}<span>Sida {result.page}</span>{result.hasMore && <Link href={href(result.page + 1)} className="underline">Nästa</Link>}</nav>
    </main>
  </div>
}
