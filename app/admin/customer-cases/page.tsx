import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listCustomerCases } from '@/lib/customer-cases/db'
import { listTenantSupportCustomerOptions } from '@/lib/customer-cases/support'
import { listCurrentCasePublications } from '@/lib/customer-cases/publication'
import { createCustomerCaseFromFormAction, publishCustomerCaseAction, revokeCustomerCasePublicationAction, updateCustomerCaseStatusAction } from './actions'

export const dynamic = 'force-dynamic'

function isSupportCase(row: { source?: string | null; metadata?: Record<string, unknown> | null }) {
  return row.metadata?.support_case === true || String(row.source ?? '').startsWith('tenant_support_')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function CustomerCasesPage() {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const scope = await resolveAdminTenantReadScope(context)
  const [allCases, customers] = await Promise.all([
    listCustomerCases({ companyId: scope.companyId, limit: 200 }),
    scope.companyId ? listTenantSupportCustomerOptions(scope.companyId) : Promise.resolve([]),
  ])
  const cases = allCases.filter(isSupportCase)
  const publications = await (scope.companyId
    ? listCurrentCasePublications(scope.companyId, cases.map((row) => row.id))
    : Promise.resolve([]))
  const publicationByCase = new Map(publications.map((item) => [item.customer_case_id, item]))
  const open = cases.filter((row) => !['resolved', 'closed', 'cancelled'].includes(row.status))
  const urgent = open.filter((row) => ['urgent', 'high'].includes(row.priority))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Support" subtitle="Tenant-isolerade supportärenden från API, kundportal och intern handläggning." userEmail={context.email} />
      <main className="space-y-6 p-6 lg:p-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Öppna supportärenden</p><p className="mt-2 text-3xl font-semibold">{open.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Hög/akut prioritet</p><p className="mt-2 text-3xl font-semibold">{urgent.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Totalt i supporthistorik</p><p className="mt-2 text-3xl font-semibold">{cases.length}</p></div>
        </section>

        {!scope.isPlatformAdmin && scope.companyId ? (
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
              <button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white lg:col-span-2">Skapa supportärende</button>
            </form>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><h2 className="text-lg font-semibold text-slate-950">Supportkö</h2><p className="mt-1 text-sm text-slate-600">Normal drift visas inte här. Endast uttryckliga supportärenden från tenantens kanaler.</p></div>
          <div className="mt-5 space-y-3">
            {cases.length === 0 ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga supportärenden i valt scope.</p> : null}
            {cases.map((row) => {
              const publication = publicationByCase.get(row.id)
              return (
              <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{row.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{row.customer_name ?? row.customer_number ?? row.customer_id}</p>
                    {row.description ? <p className="mt-2 max-w-3xl text-sm text-slate-700">{row.description}</p> : null}
                    <p className="mt-2 text-xs text-slate-500">{row.reason_category ?? 'support'} · {row.source ?? 'support'} · {formatDate(row.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{row.priority} · {row.status}</span>
                </div>
                {!['resolved', 'closed', 'cancelled'].includes(row.status) && !scope.isPlatformAdmin ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'].map((status) => (
                      <form key={status} action={updateCustomerCaseStatusAction}>
                        <input type="hidden" name="case_id" value={row.id} /><input type="hidden" name="status" value={status} />
                        <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{status}</button>
                      </form>
                    ))}
                  </div>
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
                  {!scope.isPlatformAdmin ? (
                    <div className="mt-3 grid gap-3">
                      <form action={publishCustomerCaseAction} className="grid gap-2">
                        <input type="hidden" name="case_id" value={row.id} />
                        <input type="hidden" name="expected_revision" value={publication?.revision ?? 0} />
                        <input name="public_title" required maxLength={180} placeholder="Kundsynlig rubrik (skriv uttryckligen)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <textarea name="public_body" required maxLength={8000} rows={3} placeholder="Meddelande till kunden (intern text kopieras inte automatiskt)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                        <select name="public_status" defaultValue="open" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                          <option value="open">Öppet</option><option value="waiting_for_customer">Väntar på kunden</option><option value="resolved">Löst</option><option value="closed">Avslutat</option>
                        </select>
                        <button className="rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800">{publication ? 'Publicera ny kundsynlig version' : 'Publicera till kunden'}</button>
                      </form>
                      {publication ? (
                        <form action={revokeCustomerCasePublicationAction}>
                          <input type="hidden" name="case_id" value={row.id} />
                          <input type="hidden" name="expected_revision" value={publication.revision} />
                          <button className="rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-800">Dra tillbaka publiceringen</button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
