import Link from 'next/link'
import { canPresentAdminLink } from '@/lib/admin/actionPresentation'
import { isPortalCompletionCase, readLinkedPortalCompletion, readPortalCaseSite } from '@/lib/customer-portal/caseProjection'
import { PortalCursorError } from '@/lib/customer-portal/keysetPagination'
import { isUuid } from '@/lib/validation/uuid'
import { notFound, redirect } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import SupportCaseComposer from '@/components/admin/support/SupportCaseComposer'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getAdminPageRequirement, hasPermissionRequirement } from '@/lib/admin/accessModel'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getCustomerCaseById, listCustomerCaseEvents } from '@/lib/customer-cases/db'
import { EDIEL_OPERATIONAL_CASE_SOURCE, isTenantSupportCase } from '@/lib/customer-cases/supportScope'
import { PHONE_VERIFICATION_METHODS, SUPPORT_EVENT_TYPES, publicSupportStatus } from '@/lib/customer-service/supportConversation'
import { listSupportAttachmentsPage, SUPPORT_ATTACHMENT_LIST_PAGE_SIZE } from '@/lib/customer-service/supportAttachments'
import { addInternalNoteAction, recordPhoneInteractionAction, replyToCustomerAction, uploadSupportAttachmentAction } from '../actions'
import { formatStatusLabel, formatAdminDateTime } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

const ENTRY_LABELS: Record<string, { label: string; tone: string; customerVisible: boolean }> = {
  [SUPPORT_EVENT_TYPES.customerMessage]: { label: 'Kunden', tone: 'border-sky-200 bg-sky-50', customerVisible: true },
  [SUPPORT_EVENT_TYPES.staffReply]: { label: 'Svar till kund', tone: 'border-slate-200 bg-white', customerVisible: true },
  [SUPPORT_EVENT_TYPES.internalNote]: { label: 'Intern anteckning', tone: 'border-amber-200 bg-amber-50', customerVisible: false },
  [SUPPORT_EVENT_TYPES.phoneInteraction]: { label: 'Samtal (internt)', tone: 'border-violet-200 bg-violet-50', customerVisible: false },
}

export default async function SupportCaseDetailPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>
  searchParams?: Promise<{ attachmentsCursor?: string | string[] }>
}) {
  const context = await requireAdminPageKeyAccess('support.cases')
  const scope = await resolveAdminTenantReadScope(context)
  // Tenant support content is only shown inside the tenant's own scope.
  if (!scope.companyId) notFound()
  const { caseId } = await params
  if (!isUuid(caseId)) notFound()
  const supportCase = await getCustomerCaseById(caseId, scope.companyId)
  if (!supportCase || supportCase.id !== caseId || supportCase.company_id !== scope.companyId) notFound()
  const isSupport = isTenantSupportCase(supportCase)
  const isPortalCompletion = isPortalCompletionCase(supportCase.source, supportCase.reason_category)
  const portalCompletion = isPortalCompletion ? await readLinkedPortalCompletion({
    companyId: scope.companyId, customerId: supportCase.customer_id, caseId,
    siteId: supportCase.site_id, completionId: supportCase.metadata?.completionId,
  }) : null
  if (!isSupport && !portalCompletion) {
    if (supportCase.source === EDIEL_OPERATIONAL_CASE_SOURCE
      && hasPermissionRequirement(context.permissions, getAdminPageRequirement('customer.cases'))) {
      redirect(`/admin/ediel/operational-cases?caseId=${encodeURIComponent(supportCase.id)}`)
    }
    notFound()
  }
  const events = (await listCustomerCaseEvents(supportCase.id, scope.companyId)).slice().reverse()
  const canWrite = isSupport && !scope.isPlatformAdmin && hasPermissionRequirement(context.permissions, { anyOf: ['cases.write'] })
  const canReadSites = canPresentAdminLink(context, { anyOf: ['customers.read', 'masterdata.read'] })
  const canReadCustomer = canReadSites && canPresentAdminLink(context, { anyOf: ['customers.read', 'contracts.read', 'contracts.write'] })
  const portalSite = canReadSites && portalCompletion && supportCase.site_id
    ? await readPortalCaseSite(scope.companyId, supportCase.customer_id, supportCase.site_id) : null
  const customerHref = `/admin/customers/${supportCase.customer_id}`
  const siteHref = portalSite ? `${customerHref}?tab=sites&site=${portalSite.id}#vald-anlaggning` : null
  const closed = ['resolved', 'closed', 'cancelled'].includes(supportCase.status)
  const { attachmentsCursor } = await searchParams ?? {}
  const isFirstAttachmentPage = attachmentsCursor === undefined
  const cursor = typeof attachmentsCursor === 'string' ? attachmentsCursor : undefined
  let invalidAttachmentCursor = !isFirstAttachmentPage && (!cursor || cursor.length > 2048)
  let attachmentPage: Awaited<ReturnType<typeof listSupportAttachmentsPage>> | null = null
  if (isSupport && !invalidAttachmentCursor) {
    try {
      attachmentPage = await listSupportAttachmentsPage({
        companyId: scope.companyId, customerId: supportCase.customer_id, caseId: supportCase.id, audience: 'staff',
      }, { cursor, limit: SUPPORT_ATTACHMENT_LIST_PAGE_SIZE })
    } catch (error) {
      invalidAttachmentCursor = error instanceof PortalCursorError
    }
  }
  const casePath = `/admin/customer-cases/${supportCase.id}`
  const nextAttachmentCursor = attachmentPage?.page.next_cursor

  const renderEvent = (event: (typeof events)[number]) => {
    const entry = ENTRY_LABELS[event.event_type]
    const visible = entry?.customerVisible === true && event.payload?.visibility === 'customer'
    return (
      <li key={event.id} className={`rounded-2xl border p-4 ${entry?.tone ?? 'border-slate-200 bg-slate-50'}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">
            {entry?.label ?? 'Systemhändelse'}
            {event.payload?.kind === 'phone_summary' ? ' · samtalssammanfattning' : ''}
          </span>
          <span>{visible ? 'Synlig för kunden' : 'Endast internt'} · {formatAdminDateTime(event.created_at)}</span>
        </div>
        <p className="mt-2 break-words whitespace-pre-wrap text-sm text-slate-800">{event.message}</p>
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title={supportCase.title} subtitle="Supportärende" userEmail={context.email} />
      <main className="min-w-0 space-y-4 p-4 lg:p-6">
        <nav aria-label="Brödsmulor" className="text-sm">
          <Link href="/admin/customer-cases" className="text-sky-700 underline-offset-2 hover:underline">← Alla supportärenden</Link>
        </nav>
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {canReadCustomer ? <Link href={customerHref} className="font-semibold text-sky-700 hover:underline">Öppna kundkort</Link> : null}
          {portalSite ? <span className="text-sm text-slate-700">Anläggning {portalSite.label}</span> : null}
          {canReadCustomer && siteHref ? <Link href={scope.isPlatformAdmin ? `${customerHref}?tab=sites#sites` : siteHref}
            prefetch={false} className="font-semibold text-sky-700 hover:underline">Öppna anläggning på kundkortet</Link> : null}
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">Internt: {formatStatusLabel(supportCase.status, 'Status behöver granskas', 'Status behöver granskas')}</span>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">Kunden ser: {formatStatusLabel(publicSupportStatus(supportCase.status), 'Status saknas', 'Behöver granskning')}</span>
          <span className="text-xs text-slate-500">Skapat {formatAdminDateTime(supportCase.created_at)}</span>
        </section>

        {!isPortalCompletion && supportCase.description ? <section aria-labelledby="description-heading" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 id="description-heading" className="text-lg font-semibold text-slate-950">Beskrivning</h2>
          <p className="mt-3 break-words whitespace-pre-wrap text-sm text-slate-800">{supportCase.description}</p>
        </section> : null}

        {portalCompletion ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-950">Kundens komplettering</h2>
            {portalCompletion.reference ? <p className="mt-2 text-sm text-slate-700">Kvitto {portalCompletion.reference}</p> : null}
            <dl className="mt-3 space-y-2 text-sm">
              {portalCompletion.fields.map(([name, value]) => (
                <div key={name}><dt className="font-semibold">{name}</dt><dd className="break-words whitespace-pre-wrap">{value}</dd></div>
              ))}
            </dl>
          </section>
        ) : null}
        <section aria-labelledby="history-heading" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 id="history-heading" className="text-lg font-semibold text-slate-950">Historik</h2>
          {events.length > 10 ? (
            <details id="earlier-support-history" className="mt-3 rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">Tidigare händelser ({events.length - 10})</summary>
              <div role="region" aria-label="Tidigare händelser" tabIndex={0} className="mt-3 max-h-[32rem] overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"><ol className="space-y-3">{events.slice(0, -10).map(renderEvent)}</ol></div>
            </details>
          ) : null}
          <ol className="mt-4 space-y-3">
            {events.length === 0 ? <li className="text-sm text-slate-600">Ingen historik ännu.</li> : null}
            {events.slice(-10).map(renderEvent)}
          </ol>
        </section>

        {isSupport ? <section aria-labelledby="attachments-heading" className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 id="attachments-heading" className="text-lg font-semibold text-slate-950">Bilagor</h2>
          <p className="mt-1 text-sm text-slate-600">PDF, PNG eller JPEG, högst 4 MB. Varje fil kontrolleras innan den kan öppnas.</p>
          {invalidAttachmentCursor ? (
            <p className="mt-4 text-sm text-amber-800">Länken till äldre bilagor är inte giltig.</p>
          ) : attachmentPage === null ? (
            <p className="mt-4 text-sm text-amber-800">Bilagorna kunde inte hämtas. Försök igen.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {attachmentPage.items.length === 0 ? (
                <li className="text-sm text-slate-600">{isFirstAttachmentPage ? 'Inga bilagor ännu.' : 'Inga fler äldre bilagor.'}</li>
              ) : null}
              {attachmentPage.items.map((file) => (
                <li key={file.public_reference} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 p-3 text-sm">
                  <span className="min-w-0 break-all font-medium text-slate-900">{file.file_name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>{Math.max(1, Math.round(file.byte_size / 1024))} kB · {file.visibility === 'customer' ? 'Synlig för kunden' : 'Endast internt'} · {file.uploaded_by_kind === 'customer' ? 'Från kunden' : 'Från personal'}</span>
                    {file.scan_status === 'released' ? (
                      <a className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800 underline-offset-2 hover:underline" href={`/admin/customer-cases/${supportCase.id}/attachments/${file.public_reference}`}>Godkänd · Ladda ner</a>
                    ) : file.scan_status === 'rejected' ? (
                      <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-800">Stoppad i kontrollen</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">Kontrolleras</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!isFirstAttachmentPage || nextAttachmentCursor ? (
            <nav aria-label="Bilagesidor" className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-sky-700">
              {!isFirstAttachmentPage ? <Link prefetch={false} className="underline" href={`${casePath}#attachments-heading`}>Visa nyaste bilagor</Link> : null}
              {nextAttachmentCursor ? <Link prefetch={false} className="underline" href={`${casePath}?attachmentsCursor=${encodeURIComponent(nextAttachmentCursor)}#attachments-heading`}>Visa äldre bilagor</Link> : null}
            </nav>
          ) : null}
          {canWrite && !closed && isFirstAttachmentPage && attachmentPage !== null ? (
            <form action={uploadSupportAttachmentAction} className="mt-4 flex min-w-0 flex-wrap items-end gap-3 [&_input]:max-w-full">
              <input type="hidden" name="case_id" value={supportCase.id} />
              <input type="hidden" name="expected_company_id" value={scope.companyId} />
              <label className="grid min-w-0 gap-1 text-sm">
                <span className="font-medium text-slate-700">Fil</span>
                <input type="file" name="file" required accept="application/pdf,image/png,image/jpeg" className="text-sm" />
              </label>
              <label className="grid min-w-0 gap-1 text-sm">
                <span className="font-medium text-slate-700">Vem ser filen?</span>
                <select name="visibility" defaultValue="internal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                  <option value="internal">Endast internt</option>
                  <option value="customer">Även kunden</option>
                </select>
              </label>
              <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Bifoga</button>
            </form>
          ) : null}
        </section> : null}

        {canWrite && !closed ? (
          <SupportCaseComposer
            caseId={supportCase.id}
            companyId={scope.companyId}
            replyAction={replyToCustomerAction}
            internalNoteAction={addInternalNoteAction}
            phoneAction={recordPhoneInteractionAction}
            verificationMethods={Object.entries(PHONE_VERIFICATION_METHODS).map(([value, label]) => ({ value, label }))}
          />
        ) : null}
      </main>
    </div>
  )
}
