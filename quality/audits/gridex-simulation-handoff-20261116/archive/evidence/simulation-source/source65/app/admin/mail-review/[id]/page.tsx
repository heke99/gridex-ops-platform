import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getManualMailReviewDetail, getManualMailReviewNames, formatManualMailTime, manualMailReviewReasons, object } from '@/lib/inbound-mail/manualMailReviewQueue'
import ManualMailAiReading from '@/app/admin/manual-requests/ManualMailAiReading'

export const dynamic = 'force-dynamic'
export default async function MailReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdminAccess()
  const db = await createSupabaseServerClient()
  const { id } = await params
  const row = await getManualMailReviewDetail(db, id)
  if (!row) notFound()
  const names = await getManualMailReviewNames(db, [row])
  const payload = object(row.extracted_payload), automation = object(payload.manual_automation), documentReading = object(automation.documentReading)
  const sources = object(automation.documentSources)
  const multiSite = object(automation.multi_site)
  const siteReviews = multiSite.version === 1 && multiSite.parentRequestId === row.request_id
    && typeof automation.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(automation.sourceHash)
    && multiSite.sourceHash === automation.sourceHash && Array.isArray(multiSite.results)
    ? multiSite.results.map(object).filter(result => result.outcome === 'needs_review') : []
  const units = Array.isArray(sources.catalog) ? sources.catalog : Array.isArray(documentReading.units) ? documentReading.units : []
  const poa = new URLSearchParams()
  if (row.company_id) poa.set('company', row.company_id)
  if (row.customer_id) poa.set('customer', row.customer_id)
  return <div className="min-h-screen bg-slate-50">
    <AdminHeader title="Granska mejlsvar" subtitle="Kontrollera originalet, matchningen och varje anläggning. Tider visas i svensk tid." userEmail={admin.email} workspaceName="Gridex Platform" workspaceMode="platform" />
    <main className="space-y-6 p-6 lg:p-8">
      <Link href="/admin/mail-review" className="underline">Till mejlgranskningen</Link>
      <section className="rounded-2xl border bg-white p-5"><h1 className="break-words text-xl font-bold">{row.subject || 'Utan ämne'}</h1><dl className="mt-4 space-y-2"><div><dt className="inline font-semibold">Från: </dt><dd className="inline">{row.from_email || '—'}</dd></div><div><dt className="inline font-semibold">Till: </dt><dd className="inline">{row.to_email || '—'}</dd></div><div><dt className="inline font-semibold">Mottaget: </dt><dd className="inline">{formatManualMailTime(row.received_at)}</dd></div><div><dt className="inline font-semibold">Tenant: </dt><dd className="inline break-all">{row.company_id ? <Link href={`/admin/companies/${encodeURIComponent(row.company_id)}`} className="underline">{names.companies.get(row.company_id) || row.company_id}</Link> : 'Behöver identifieras'}</dd></div><div><dt className="inline font-semibold">Kund: </dt><dd className="inline break-all">{row.customer_id ? <Link href={`/admin/customers/${encodeURIComponent(row.customer_id)}`} className="underline">{names.customers.get(row.customer_id) || row.customer_id}</Link> : 'Behöver identifieras'}</dd></div></dl>
        <ul className="mt-4 list-disc pl-5 text-amber-900">{manualMailReviewReasons(row).map(reason => <li key={reason}>{reason}</li>)}</ul>
        <nav aria-label="Relaterade underlag" className="mt-4 flex flex-wrap gap-4">{row.company_id && row.customer_id && <Link href={`/admin/powers-of-attorney?${poa}`} className="underline">Kundens fullmakter</Link>}{row.request_id && <Link href={`/admin/manual-requests#request-${encodeURIComponent(row.request_id)}`} className="underline">Förfrågan</Link>}</nav>
      </section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Originaltext</h2><p className="mt-3 whitespace-pre-wrap break-words">{row.body_text || row.normalized_text || 'Ingen textdel finns. Kontrollera bilagorna.'}</p></section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Bilagor och original</h2><ul className="mt-3 space-y-4">{row.attachmentDescriptors.map((a, index) => <li key={`${a.mimePart}-${index}`} className="break-words"><p className="font-semibold">{a.filename}</p><p>{a.contentType} · {a.sizeBytes ?? 'Okänd'} byte</p><p className="break-all text-xs text-slate-600">SHA-256: {a.sha256 ?? 'Saknas'}</p>{a.downloadable ? <a href={`/api/admin/mail-review/${encodeURIComponent(row.id)}/attachments/${a.mimePart}`} className="mt-1 inline-block underline">Ladda ner original</a> : <p className="text-amber-900">Originalfilen behöver kompletteras. {a.capturedIssue}</p>}</li>)}</ul>{!row.attachmentDescriptors.length && <p className="mt-3">Inga bilagor.</p>}</section>
      <section className="rounded-2xl border bg-white p-5"><h2 className="mb-3 font-bold">Tolkning och bekräftat sparade uppgifter</h2><ManualMailAiReading payload={row.extracted_payload} companyId={row.company_id} customerId={row.customer_id} requestId={row.request_id} />{typeof documentReading.status === 'string' && <p className="mt-4 text-sm">Dokumentläsning: {String(documentReading.status)}{documentReading.reason ? ` (${String(documentReading.reason)})` : ''}. Dokumentläsning ger inga kund- eller tenantbehörigheter.</p>}</section>
      {siteReviews.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-bold">Anläggningar som behöver granskas</h2><ul className="mt-3 space-y-3">{siteReviews.map((site, index) => <li key={index}><p className="font-semibold">Anläggnings-ID: {typeof site.facilityId === 'string' ? site.facilityId : 'Behöver identifieras'}</p><p>Kontrollera anläggningens uppgifter, rätt motpart och giltig fullmakt innan handläggningen fortsätter.</p></li>)}</ul></section>}
      {units.length > 0 && <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Källhänvisningar i bilagor</h2><ul className="mt-3 space-y-4">{units.map((value, index) => { const unit = object(value); return <li key={index} className="break-words"><p className="font-semibold">{String(unit.locator ?? unit.origin ?? `Källa ${index + 1}`)}</p><p className="break-all text-xs text-slate-600">{String(unit.attachmentId ?? '')} {String(unit.sha256 ?? '')}</p>{typeof unit.text === 'string' && <blockquote className="mt-2 whitespace-pre-wrap border-l-2 pl-3">{unit.text}</blockquote>}</li> })}</ul></section>}
      <section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Matchningsunderlag för superadmin</h2><p className="mt-2 text-sm text-slate-600">Kandidater visar möjliga träffar. De bekräftar inte kund, tenant eller fullmaktsbehörighet.</p><pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(row.correlation_evidence ?? {}, null, 2)}</pre></section>
    </main>
  </div>
}
