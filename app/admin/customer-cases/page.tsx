import AdminHeader from '@/components/admin/AdminHeader'
import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { isCompanyWritableInTenantWorkspace } from '@/lib/tenant/lifecycle'
import { listTenantSupportCases, listTenantSupportCustomerOptions, listTenantSupportMessages } from '@/lib/customer-cases/support'
import { listCasePublicationHeads, listCurrentCasePublications } from '@/lib/customer-cases/publication'
import { addCustomerCaseMessageAction, addCustomerCaseMessageCommandAction, createCustomerCaseCommandAction, createCustomerCaseFromFormAction, publishCustomerCaseAction, revokeCustomerCasePublicationAction, updateCustomerCaseStatusAction, updateCustomerCaseStatusCommandAction } from './actions'
import SupportActionForm from '@/lib/customer-cases/SupportActionForm'
import SubmitActionButton from './SubmitActionButton'
import { readSupportAttachments } from '@/lib/customer-cases/attachments'
import { requireCurrentOpsSupportReadSession } from '@/lib/customer-operations/supportSession'
import { uploadCustomerCaseAttachmentAction, uploadCustomerCaseAttachmentFallbackAction } from './actions'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function CustomerCasesPage({ searchParams }: {
  searchParams?: Promise<{ page?: string | string[]; notice?: string | string[]; customer?: string; status?: string; q?: string; case?: string; messages_page?: string; channel?: string }>
}) {
  const params = await searchParams
  const rawPage = params?.page
  const requestedPage = typeof rawPage === 'string' && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1
  const page = Number.isSafeInteger(requestedPage) && requestedPage <= 10_000 ? requestedPage : 1
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const customerId = typeof params?.customer === 'string' && uuid.test(params.customer) ? params.customer : null
  const selectedCase = typeof params?.case === 'string' && uuid.test(params.case) ? params.case : null
  const status = typeof params?.status === 'string' && ['open', 'action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'].includes(params.status) ? params.status : null
  const query = typeof params?.q === 'string' ? params.q.slice(0, 180) : ''
  const contactChannel = params?.channel === 'phone' ? 'phone' : 'ops'
  const messagesPage = typeof params?.messages_page === 'string' && /^[1-9]\d{0,3}$/.test(params.messages_page) ? Number(params.messages_page) : 1
  function href(nextPage: number, extra: Record<string, string> = {}) {
    const search = new URLSearchParams({ page: String(nextPage), ...(customerId ? { customer: customerId } : {}), ...(status ? { status } : {}), ...(query ? { q: query } : {}), ...(selectedCase ? { case: selectedCase } : {}), ...extra })
    return `/admin/customer-cases?${search}`
  }
  const context = await requireAdminPageAccess(['cases.read'])
  const scope = await resolveAdminTenantReadScope(context)
  const supportActor = scope.companyId ? await requireCurrentOpsSupportReadSession(scope.companyId, context.userId) : null
  const operational = !scope.isPlatformAdmin ? await getOperationalCompanyScope(context.userId) : null
  const membership = operational?.memberships.find((row) => row.companyId === scope.companyId)
  const canWrite = Boolean(!scope.isPlatformAdmin && scope.companyId &&
    context.companyId === scope.companyId && operational?.companyId === scope.companyId &&
    context.permissions.includes('cases.write') && membership?.status === 'active' &&
    isCompanyWritableInTenantWorkspace(membership.companyStatus))
  const [supportRows, customers] = await Promise.all([
    scope.companyId ? listTenantSupportCases({ companyId: scope.companyId, customerId, caseId: selectedCase, status, query, limit: PAGE_SIZE + 1, offset: selectedCase ? 0 : (page - 1) * PAGE_SIZE }) : Promise.resolve([]),
    scope.companyId ? listTenantSupportCustomerOptions(scope.companyId, customerId) : Promise.resolve([]),
  ])
  const hasNext = supportRows.length > PAGE_SIZE
  const cases = supportRows.slice(0, PAGE_SIZE)
  const caseIds = cases.map((row) => row.id)
  const [publications, heads] = await Promise.all([
    scope.companyId ? listCurrentCasePublications(scope.companyId, caseIds) : Promise.resolve([]),
    scope.companyId ? listCasePublicationHeads(scope.companyId, caseIds) : Promise.resolve(new Map<string, number>()),
  ])
  const publicationByCase = new Map(publications.map((item) => [item.customer_case_id, item]))
  const messagePage = selectedCase && cases.length === 1 && scope.companyId
    ? await listTenantSupportMessages({ companyId: scope.companyId, customerId: cases[0].customer_id, caseId: cases[0].id, offset: (messagesPage - 1) * 25 }) : null
  const attachmentPage = selectedCase && cases.length === 1 && scope.companyId && supportActor
    ? await readSupportAttachments({ companyId: scope.companyId, customerId: cases[0].customer_id, actor: supportActor }, { caseId: cases[0].id }) : null
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
            <SupportActionForm action={createCustomerCaseCommandAction} fallbackAction={createCustomerCaseFromFormAction} initialKey={randomUUID()} submitLabel="Skapa supportärende" className="mt-4 space-y-3">
              <label className="grid gap-1 text-sm">Kund<select name="customer_id" defaultValue={customerId ?? ''} required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="">Välj kund</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select></label>
              <label className="grid gap-1 text-sm">Kontaktkanal<select name="contact_channel" defaultValue={contactChannel} className="rounded-xl border border-slate-300 px-3 py-2"><option value="ops">Intern handläggning</option><option value="phone">Telefonkontakt – kundidentitet inte verifierad</option></select></label>
              <label className="grid gap-1 text-sm">Prioritet<select name="priority" defaultValue="normal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="low">Låg</option><option value="normal">Normal</option><option value="high">Hög</option><option value="urgent">Akut</option>
              </select></label>
              <label className="grid gap-1 text-sm">Rubrik<input name="title" required maxLength={180} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="grid gap-1 text-sm">Kategori<input name="category" maxLength={120} placeholder="Faktura, avtal eller support" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="grid gap-1 text-sm">Intern beskrivning<textarea name="description" rows={4} maxLength={8000} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
              <p className="text-xs text-slate-600">Registreringen är intern och kan göras även för en kund utan portalkonto. Telefonkontakt bevisar inte kundens identitet och ger ingen profiländringsrätt för uppringaren.</p>
            </SupportActionForm>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><h2 className="text-lg font-semibold text-slate-950">Supportkö</h2><p className="mt-1 text-sm text-slate-600">Normal drift visas inte här. Endast uttryckliga supportärenden från tenantens kanaler.</p></div>
          <form method="get" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-sm">Sök<input name="q" defaultValue={query} maxLength={180} className="min-w-0 rounded-xl border border-slate-300 px-3 py-2" /></label>
            <label className="grid gap-1 text-sm">Kund<select name="customer" defaultValue={customerId ?? ''} className="min-w-0 rounded-xl border border-slate-300 px-3 py-2"><option value="">Alla kunder</option>{customers.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="grid gap-1 text-sm">Status<select name="status" defaultValue={status ?? ''} className="rounded-xl border border-slate-300 px-3 py-2"><option value="">Alla statusar</option><option value="open">Öppet</option><option value="action_required">Kräver åtgärd</option><option value="awaiting_external_response">Väntar externt</option><option value="manual_follow_up">Manuell uppföljning</option><option value="resolved">Löst</option><option value="closed">Avslutat</option></select></label>
            <button type="submit" className="min-h-11 self-end rounded-xl border border-slate-300 px-4 py-2 font-semibold">Visa ärenden</button>
          </form>
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
                <p className="mt-3 text-xs text-slate-600">Supportrevision {row.support_revision ?? 0} · <Link href={href(1, { case: row.id, messages_page: '1' })} className="font-semibold underline">Fortsätt samma ärende</Link></p>
                {!['closed', 'cancelled', 'billing_blocked'].includes(row.status) && canWrite ? (
                  <SupportActionForm action={updateCustomerCaseStatusCommandAction} fallbackAction={updateCustomerCaseStatusAction} initialKey={randomUUID()} expectedRevision={row.support_revision ?? 0} submitLabel="Spara status" className="mt-4 space-y-3">
                    <input type="hidden" name="case_id" value={row.id} />
                    <input type="hidden" name="customer_id" value={row.customer_id} />
                    <label className="grid gap-1 text-xs font-semibold text-slate-700">Ärendestatus
                      <select name="status" required defaultValue="" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                        <option value="" disabled>Välj status</option>
                        {row.status !== 'open' ? <option value="open">Öppna igen</option> : null}
                        {row.status !== 'resolved' && row.status !== 'action_required' ? <option value="action_required">Kräver åtgärd</option> : null}
                        {row.status !== 'resolved' && row.status !== 'awaiting_external_response' ? <option value="awaiting_external_response">Väntar externt</option> : null}
                        {row.status !== 'resolved' && row.status !== 'manual_follow_up' ? <option value="manual_follow_up">Manuell uppföljning</option> : null}
                        {row.status !== 'resolved' ? <option value="resolved">Löst</option> : null}
                        {row.status === 'resolved' ? <option value="closed">Avslutat</option> : null}
                      </select>
                    </label>
                  </SupportActionForm>
                ) : null}
                {selectedCase === row.id ? <section className="mt-5 space-y-3 border-t border-slate-200 pt-4">
                  <h3 className="font-semibold">Meddelanden och interna anteckningar</h3>
                  {(messagePage?.items ?? []).map(message => <article key={message.id} className={`rounded-xl border p-3 text-sm ${message.visibility === 'internal' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="font-semibold">{message.visibility === 'internal' ? 'Intern anteckning' : 'Kundsynligt meddelande'} · {message.author_kind === 'staff' ? 'Medarbetare' : 'Kund'} · {message.channel} · revision {message.revision}</p>{message.caller_verification === 'unverified' ? <p className="mt-1 text-xs font-semibold text-amber-900">Kundidentiteten är inte verifierad. Registreringen ger ingen behörighet åt uppringaren.</p> : null}<p className="mt-1 whitespace-pre-wrap">{message.body}</p><p className="mt-2 text-xs text-slate-600">{formatDate(message.created_at)}{message.actor_user_id ? ` · medarbetar-/aktörsreferens ${message.actor_user_id}` : ''}</p></article>)}
                  {!messagePage?.items.length ? <p className="text-sm text-slate-600">Inga meddelanden på denna sida.</p> : null}
                  <nav aria-label="Ärendets meddelandesidor" className="flex flex-wrap gap-4 text-sm">{messagesPage > 1 ? <Link className="underline" href={href(1, { messages_page: String(messagesPage - 1) })}>Nyare meddelanden</Link> : null}{messagePage?.hasMore ? <Link className="underline" href={href(1, { messages_page: String(messagesPage + 1) })}>Äldre meddelanden</Link> : null}</nav>
                  {canWrite ? <SupportActionForm action={addCustomerCaseMessageCommandAction} fallbackAction={addCustomerCaseMessageAction} initialKey={randomUUID()} expectedRevision={row.support_revision ?? 0} submitLabel="Spara meddelande" className="space-y-3">
                    <input type="hidden" name="case_id" value={row.id} /><input type="hidden" name="customer_id" value={row.customer_id} />
                    <label className="grid gap-1 text-sm">Synlighet<select name="visibility" defaultValue="internal" className="rounded-xl border border-slate-300 px-3 py-2"><option value="internal">Intern anteckning</option><option value="customer">Meddelande till kunden</option></select></label>
                    <label className="grid gap-1 text-sm">Kontaktkanal<select name="contact_channel" defaultValue={contactChannel} className="rounded-xl border border-slate-300 px-3 py-2"><option value="ops">Intern handläggning eller uttryckligt kundmeddelande</option><option value="phone">Telefonregistrering (alltid intern)</option></select></label>
                    <label className="grid gap-1 text-sm">Text<textarea name="body" required maxLength={8000} rows={4} className="rounded-xl border border-slate-300 px-3 py-2" /></label>
                    <p className="text-xs text-slate-600">Endast ett uttryckligt kundmeddelande visas på Mina sidor. Intern text publiceras aldrig automatiskt.</p>
                  </SupportActionForm> : <p className="text-sm text-slate-600">Du har läsbehörighet. Meddelanden kan inte ändras.</p>}
                  <h3 className="font-semibold">Privata bilagor</h3>
                  {attachmentPage?.items.map(item => <article key={item.attachment_reference} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold">{item.file_name}</p><p>{item.media_type} · {item.byte_size} byte · Privat karantän</p><p>Kan inte öppnas innan säkerhetskontrollen är ansluten.</p></article>)}
                  {!attachmentPage?.items.length ? <p className="text-sm text-slate-600">Inga bilagor.</p> : null}
                  {canWrite && !['closed','cancelled'].includes(row.status) ? <SupportActionForm action={uploadCustomerCaseAttachmentAction} fallbackAction={uploadCustomerCaseAttachmentFallbackAction} initialKey={randomUUID()} expectedRevision={row.support_revision ?? 0} submitLabel="Lämna privat bilaga" className="space-y-3"><input type="hidden" name="case_id" value={row.id} /><input type="hidden" name="customer_id" value={row.customer_id} /><label className="grid gap-1 text-sm">Bilagans synlighet<select name="visibility" defaultValue="internal" className="rounded-xl border border-slate-300 p-2"><option value="internal">Intern bilaga</option><option value="customer">Kundsynlig bilagestatus</option></select></label><label className="grid gap-1 text-sm">Fil (PDF, PNG, JPEG eller text, högst 5 MiB)<input name="file" type="file" required accept="application/pdf,image/png,image/jpeg,text/plain" className="min-w-0 rounded-xl border border-slate-300 p-2" /></label></SupportActionForm> : null}
                </section> : null}
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
                        <input type="hidden" name="customer_id" value={row.customer_id} />
                        <input type="hidden" name="current_page" value={page} />
                        <input type="hidden" name="expected_revision" value={heads.get(row.id) ?? 0} />
                        <label className="grid gap-1 text-sm">Kundsynlig rubrik<input name="public_title" required maxLength={180} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
                        <label className="grid gap-1 text-sm">Kundsynlig sammanfattning<textarea name="public_body" required maxLength={8000} rows={3} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" /></label>
                        <label className="grid gap-1 text-sm">Sammanfattningens kanal<select name="publication_channel" defaultValue="ops" className="rounded-xl border border-slate-300 px-3 py-2 text-sm"><option value="ops">Handläggning i OPS</option><option value="phone">Uttrycklig telefonsammanfattning</option></select></label>
                        <label className="grid gap-1 text-sm">Kundsynlig status<select name="public_status" defaultValue="open" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                          <option value="open">Öppet</option><option value="waiting_for_customer">Väntar på kunden</option><option value="resolved">Löst</option><option value="closed">Avslutat</option>
                        </select></label>
                        <p className="text-xs text-slate-600">Skriv den text kunden ska se. Publiceringen registreras under din medarbetaridentitet och vald kanal. Interna anteckningar kopieras inte hit.</p>
                        <SubmitActionButton className="rounded-xl border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50">{publication ? 'Publicera ny kundsynlig version' : 'Publicera till kunden'}</SubmitActionButton>
                      </form>
                      {publication ? (
                        <form action={revokeCustomerCasePublicationAction}>
                          <input type="hidden" name="case_id" value={row.id} />
                        <input type="hidden" name="customer_id" value={row.customer_id} />
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
              {page > 1 ? <Link className="font-semibold text-slate-800 underline" href={href(page - 1)}>Föregående sida</Link> : null}
              <span>Sida {page}</span>
              {hasNext ? <Link className="font-semibold text-slate-800 underline" href={href(page + 1)}>Nästa sida</Link> : null}
            </nav>
          ) : null}
        </section>
      </main>
    </div>
  )
}
