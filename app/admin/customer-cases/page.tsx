import AdminHeader from '@/components/admin/AdminHeader'
import Link from 'next/link'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { listTenantSupportCases, listTenantSupportCustomerOptions } from '@/lib/customer-cases/support'
import { listCasePublicationHeads, listCurrentCasePublications } from '@/lib/customer-cases/publication'
import { createCustomerCaseFromFormAction, publishCustomerCaseAction, revokeCustomerCasePublicationAction, updateCustomerCaseStatusAction } from './actions'
import SubmitActionButton from './SubmitActionButton'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function CustomerCasesPage({ searchParams }: {
  searchParams?: Promise<{ page?: string | string[]; notice?: string | string[] }>
}) {
  const params = await searchParams
  const rawPage = params?.page
  const requestedPage = typeof rawPage === 'string' && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1
  const page = Number.isSafeInteger(requestedPage) && requestedPage <= 10_000 ? requestedPage : 1
  const context = await requireAdminPageAccess(['cases.read'])
  const scope = await resolveAdminTenantReadScope(context)
  const operational = !scope.isPlatformAdmin ? await getOperationalCompanyScope(context.userId) : null
  const membership = operational?.memberships.find((row) => row.companyId === scope.companyId)
  const canWrite = Boolean(!scope.isPlatformAdmin && scope.companyId &&
    context.companyId === scope.companyId && operational?.companyId === scope.companyId &&
    context.permissions.includes('cases.write') && membership?.status === 'active' &&
    isCompanyWritableInTenantWorkspace(membership.companyStatus))
  const [supportRows, customers] = await Promise.all([
    scope.companyId ? listTenantSupportCases({ companyId: scope.companyId, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }) : Promise.resolve([]),
    scope.companyId ? listTenantSupportCustomerOptions(scope.companyId) : Promise.resolve([]),
  ])
  const hasNext = supportRows.length > PAGE_SIZE
  const cases = supportRows.slice(0, PAGE_SIZE)
  const caseIds = cases.map((row) => row.id)
  const [publications, heads] = await Promise.all([
    scope.companyId ? listCurrentCasePublications(scope.companyId, caseIds) : Promise.resolve([]),
    scope.companyId ? listCasePublicationHeads(scope.companyId, caseIds) : Promise.resolve(new Map<string, number>()),
  ])
  const publicationByCase = new Map(publications.map((item) => [item.customer_case_id, item]))
  const open = cases.filter((row) => !['resolved', 'closed', 'cancelled'].includes(row.status))
  const urgent = open.filter((row) => ['urgent', 'high'].includes(row.priority))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Support" subtitle="Tenant-isolerade supportärenden från API, kundportal och intern handläggning." userEmail={context.email} />
      <main className="space-y-6 p-6 lg:p-8">
        {params?.notice === 'revision_conflict' ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Publiceringen har ändrats. Läs den aktuella versionen och försök igen.</p> : null}
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Öppna på sidan</p><p className="mt-2 text-3xl font-semibold">{open.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Hög/akut på sidan</p><p className="mt-2 text-3xl font-semibold">{urgent.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Ärenden på sidan</p><p className="mt-2 text-3xl font-semibold">{cases.length}</p></div>
        </section>

        {canWrite ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Nytt supportärende</h2>
            <form action={createCustomerCaseFromFormAction} className="mt-4 grid gap-3 lg:grid-cols-2">
              <select name="customer_id" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="">Välj kund</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select>
              <select name="priority" defaultValue="normal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="low">Låg</option><option value="normal">Normal</option><option value="high">Hög</option><option value="urgent">Akut</option>
              </select>
              <input name="title" required maxLength={180} placeholder="Rubrik" className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2" />
              <input name="category" placeholder="Kategori, t.ex. faktura eller avtal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="idempotency_key" placeholder="Extern referens (valfri)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <textarea name="description" rows={4} placeholder="Beskriv ärendet" className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2" />
              <SubmitActionButton className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 lg:col-span-2">Skapa supportärende</SubmitActionButton>
            </form>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><h2 className="text-lg font-semibold text-slate-950">Supportkö</h2><p className="mt-1 text-sm text-slate-600">Normal drift visas inte här. Endast uttryckliga supportärenden från tenantens kanaler.</p></div>
          {scope.isPlatformAdmin ? <p className="mt-4 text-sm text-slate-600">Öppna tenantens arbetsyta för att läsa dess supportärenden.</p> : null}
          <div className="mt-5 space-y-3">
            {cases.length === 0 && !scope.isPlatformAdmin ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga supportärenden på denna sida.</p> : null}
            {cases.map((row) => {
              const publication = publicationByCase.get(row.id)
              return (
              <article key={row.id} data-case-id={row.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{row.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{row.customer_name ?? row.customer_number ?? row.customer_id}</p>
                    {row.description ? <p className="mt-2 max-w-3xl text-sm text-slate-700">{row.description}</p> : null}
                    <p className="mt-2 text-xs text-slate-500">{row.reason_category ?? 'support'} · {row.source ?? 'support'} · {formatDate(row.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{row.priority} · {row.status}</span>
                </div>
                {!['resolved', 'closed', 'cancelled'].includes(row.status) && canWrite ? (
                  <form action={updateCustomerCaseStatusAction} className="mt-4 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="case_id" value={row.id} />
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">Ärendestatus
                      <select name="status" required defaultValue="" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                        <option value="" disabled>Välj status</option>
                        <option value="action_required">Kräver åtgärd</option>
                        <option value="awaiting_external_response">Väntar externt</option>
                        <option value="manual_follow_up">Manuell uppföljning</option>
                        <option value="resolved">Löst</option>
                        <option value="closed">Avslutat</option>
                      </select>
                    </label>
                    <SubmitActionButton className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Spara status</SubmitActionButton>
                  </form>
                ) : null}
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <h3 className="text-sm font-semibold text-slate-900">Kundsynlig publicering</h3>
                  {publication ? (
                    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-slate-800">
                      <p className="font-semibold">Version {publication.revision} · {publication.public_title}</p>
                      <p className="mt-1 whitespace-pre-wrap">{publication.public_body}</p>
                      <p className="mt-2 text-xs">{publication.public_status} · {publication.channel} · publicerad {formatDate(publication.published_at)} av {publication.author_user_id}</p>
                    </div>
                  ) : <p className="mt-2 text-sm text-slate-600">Inte publicerat till kunden.</p>}
                  {canWrite ? (
                    <div className="mt-3 grid gap-3">
                      <form action={publishCustomerCaseAction} className="grid gap-2">
                        <input type="hidden" name="case_id" value={row.id} />
                        <input type="hidden" name="current_page" value={page} />
                        <input type="hidden" name="expected_revision" value={heads.get(row.id) ?? 0} />
                        <input name="public_title" required maxLength={180} placeholder="Kundsynlig rubrik (skriv uttryckligen)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <textarea name="public_body" required maxLength={8000} rows={3} placeholder="Meddelande till kunden (intern text kopieras inte automatiskt)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <select name="public_status" defaultValue="open" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                          <option value="open">Öppet</option><option value="waiting_for_customer">Väntar på kunden</option><option value="resolved">Löst</option><option value="closed">Avslutat</option>
                        </select>
                        <SubmitActionButton className="rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50">{publication ? 'Publicera ny kundsynlig version' : 'Publicera till kunden'}</SubmitActionButton>
                      </form>
                      {publication ? (
                        <form action={revokeCustomerCasePublicationAction}>
                          <input type="hidden" name="case_id" value={row.id} />
                          <input type="hidden" name="current_page" value={page} />
                          <input type="hidden" name="expected_revision" value={publication.revision} />
                          <SubmitActionButton className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">Dra tillbaka publiceringen</SubmitActionButton>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
              )
            })}
          </div>
          {!scope.isPlatformAdmin && scope.companyId ? (
            <nav aria-label="Supportärenden sidor" className="mt-5 flex items-center gap-4 text-sm">
              {page > 1 ? <Link className="font-semibold text-slate-800 underline" href={`/admin/customer-cases?page=${page - 1}`}>Föregående sida</Link> : null}
              <span>Sida {page}</span>
              {hasNext ? <Link className="font-semibold text-slate-800 underline" href={`/admin/customer-cases?page=${page + 1}`}>Nästa sida</Link> : null}
            </nav>
          ) : null}
        </section>
      </main>
    </div>
  )
}
