import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { readPoaRegister, type PoaRegisterFilters } from '@/lib/customers/poaRegister'
import { derivePowerOfAttorneyLifecycleStatus } from '@/lib/customers/poaReadiness'
import { poaMailEvidence } from '@/lib/email/poaMailEvidence'
import { resolvePoaReplyAction } from './actions'

export const dynamic = 'force-dynamic'
const text = (value: unknown) => typeof value === 'string' ? value : ''
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const labels: Record<string, string> = { valid: 'Giltig', signed: 'Signerad, ännu inte giltig', expired: 'Utgången', revoked: 'Återkallad', replaced: 'Ersatt', awaiting_signature: 'Inväntar godkännande', missing: 'Saknas' }
function date(value: unknown) {
  const parsed = new Date(text(value))
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(parsed)
}

export default async function PowersOfAttorneyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPageKeyAccess('customer.powers_of_attorney')
  const params = await searchParams
  const filters: PoaRegisterFilters = Object.fromEntries(['company', 'customer', 'verification', 'page'].map((key) => [key, typeof params[key] === 'string' ? params[key] : undefined]))
  const client = await createSupabaseServerClient()
  const result = await readPoaRegister(client, admin, filters)
  const canReview = admin.isPlatformAdmin || admin.permissions.some((permission) => ['poa.write', 'customers.write'].includes(permission))
  const pageHref = (page: number) => {
    const next = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) if (value && key !== 'page' && (key !== 'company' || admin.isPlatformAdmin)) next.set(key, value)
    next.set('page', String(page))
    return `/admin/powers-of-attorney?${next}`
  }
  return <div className="min-h-screen bg-slate-50">
    <AdminHeader title="Fullmakter" subtitle={admin.isPlatformAdmin ? 'Sök fullmakter och originaldokument per tenant och kund.' : 'Era kunders fullmakter, godkännanden och originaldokument.'} userEmail={admin.email} />
    <main className="space-y-6 p-6 lg:p-8">
      <form method="get" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 md:grid-cols-4">
        {admin.isPlatformAdmin && <label className="text-sm font-semibold text-slate-700">Tenant
          <select name="company" defaultValue={filters.company ?? ''} className="mt-2 block w-full rounded-xl border border-slate-300 p-3">
            <option value="">Alla tenants</option>{result.companies.map((company) => <option key={text(company.id)} value={text(company.id)}>{text(company.legal_name) || text(company.name)} {text(company.org_number)}</option>)}
          </select>
        </label>}
        <label className="text-sm font-semibold text-slate-700">Kundnamn eller kundnummer
          <input name="customer" defaultValue={filters.customer ?? ''} maxLength={120} className="mt-2 block w-full rounded-xl border border-slate-300 p-3" />
        </label>
        <label className="text-sm font-semibold text-slate-700">Verifikatsnummer
          <input name="verification" defaultValue={filters.verification ?? ''} maxLength={120} className="mt-2 block w-full rounded-xl border border-slate-300 p-3" />
        </label>
        <div className="flex items-end gap-3"><button className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white" type="submit">Sök fullmakter</button><Link href="/admin/powers-of-attorney" className="py-3 text-sm underline">Rensa</Link></div>
      </form>
      <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm"><caption className="sr-only">Fullmakter för valda tenants och kunder</caption>
          <thead className="bg-slate-100 text-slate-700"><tr>{['Tenant', 'Kund', 'Fullmakt och verifikatsnummer', 'Status och godkännande', 'Dokument'].map((heading) => <th scope="col" className="px-5 py-4" key={heading}>{heading}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-200">{result.powers.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-slate-600">Inga fullmakter matchar sökningen.</td></tr>}
            {result.powers.map((power) => {
              const poa = power as Record<string, unknown>, customer = object(power.customer), company = object(power.company)
              const proof = poaMailEvidence(poa), status = derivePowerOfAttorneyLifecycleStatus(poa)
              const id = text(poa.id), documentUrl = `/api/admin/powers-of-attorney/${encodeURIComponent(id)}/document`
              return <tr key={id} className="align-top">
                <td className="px-5 py-4">{text(company.legal_name) || text(company.name) || '—'}</td>
                <td className="px-5 py-4"><Link className="font-semibold underline" href={`/admin/customers/${encodeURIComponent(text(poa.customer_id))}`}>{text(customer.company_name) || text(customer.full_name) || 'Öppna kund'}</Link><div className="mt-1 text-slate-600">{text(customer.customer_number)}</div></td>
                <td className="max-w-md px-5 py-4"><div>{text(poa.reference) || 'Fullmakt'}</div><div className="mt-1 break-all text-slate-600">Verifikatsnummer: {proof.verificationReference ?? 'Behöver kompletteras'}</div>
                  {power.reviewRequests.map((review) => {
                    const reply = object(object(review.metadata).counterparty_reply)
                    return reply.requires_review === true ? <details key={text(review.id)} className="mt-3 rounded-xl bg-amber-50 p-3"><summary className="cursor-pointer font-semibold text-amber-900">Motparten begär åtgärd</summary>
                      <p className="mt-2">{text(review.last_error_message)}</p>
                      {canReview && <form action={resolvePoaReplyAction} className="mt-3 space-y-2">
                        <input type="hidden" name="request_id" value={text(review.id)} /><input type="hidden" name="poa_id" value={id} />
                        <label className="block">Vad har åtgärdats?<textarea name="resolution_note" required minLength={8} maxLength={1000} className="mt-1 block w-full rounded-lg border border-amber-300 p-2" /></label>
                        <p className="text-xs text-slate-600">Fullmakt och mottagare kontrolleras igen före nästa utskick.</p>
                        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">Markera åtgärdat för nytt försök</button>
                      </form>}
                    </details> : null
                  })}
                </td>
                <td className="px-5 py-4"><div className="font-semibold">{labels[status] ?? status}</div><div className="mt-1 text-slate-600">{date(poa.accepted_at || poa.signed_at)}</div><div className="mt-1 text-slate-600">{proof.bankidVerified ? 'BankID verifierat' : 'Registrerat godkännande'}</div></td>
                <td className="space-y-2 px-5 py-4">{status !== 'awaiting_signature' || text(poa.document_path) ? <><a href={documentUrl} target="_blank" rel="noreferrer" className="block font-semibold underline">Öppna PDF</a><a href={`${documentUrl}?download=1`} className="block underline">Ladda ner</a><span className="block text-xs text-slate-600">{text(poa.document_path) ? 'PDF sparad' : 'Godkännandet sparat; PDF skapas från originalunderlaget'}</span></> : <span className="text-slate-600">Inväntar komplett underlag</span>}</td>
              </tr>
            })}
          </tbody>
        </table>
      </section>
      <nav aria-label="Sidindelning för fullmakter" className="flex items-center gap-4">{result.page > 1 && <Link className="underline" href={pageHref(result.page - 1)}>Föregående</Link>}<span>Sida {result.page}</span>{result.hasMore && <Link className="underline" href={pageHref(result.page + 1)}>Nästa</Link>}</nav>
    </main>
  </div>
}
