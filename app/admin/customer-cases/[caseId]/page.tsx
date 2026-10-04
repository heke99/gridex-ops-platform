import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import SupportCaseComposer from '@/components/admin/support/SupportCaseComposer'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { hasPermissionRequirement } from '@/lib/admin/accessModel'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getCustomerCaseById, listCustomerCaseEvents } from '@/lib/customer-cases/db'
import { PHONE_VERIFICATION_METHODS, SUPPORT_EVENT_TYPES, publicSupportStatus } from '@/lib/customer-service/supportConversation'
import { listSupportAttachments } from '@/lib/customer-service/supportAttachments'
import { addInternalNoteAction, recordPhoneInteractionAction, replyToCustomerAction, uploadSupportAttachmentAction } from '../actions'
import { formatStatusLabel } from '@/lib/ui/format'

export const dynamic = 'force-dynamic'

const ENTRY_LABELS: Record<string, { label: string; tone: string; customerVisible: boolean }> = {
  [SUPPORT_EVENT_TYPES.customerMessage]: { label: 'Kunden', tone: 'border-sky-200 bg-sky-50', customerVisible: true },
  [SUPPORT_EVENT_TYPES.staffReply]: { label: 'Svar till kund', tone: 'border-slate-200 bg-white', customerVisible: true },
  [SUPPORT_EVENT_TYPES.internalNote]: { label: 'Intern anteckning', tone: 'border-amber-200 bg-amber-50', customerVisible: false },
  [SUPPORT_EVENT_TYPES.phoneInteraction]: { label: 'Samtal (internt)', tone: 'border-violet-200 bg-violet-50', customerVisible: false },
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function SupportCaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  const context = await requireAdminPageKeyAccess('customer.cases')
  const scope = await resolveAdminTenantReadScope(context)
  // Tenant support content is only shown inside the tenant's own scope.
  if (!scope.companyId) notFound()
  const { caseId } = await params
  const supportCase = await getCustomerCaseById(caseId, scope.companyId)
  if (!supportCase) notFound()
  const events = (await listCustomerCaseEvents(supportCase.id, scope.companyId)).slice().reverse()
  const canWrite = !scope.isPlatformAdmin && hasPermissionRequirement(context.permissions, { anyOf: ['cases.write'] })
  const closed = ['resolved', 'closed', 'cancelled'].includes(supportCase.status)
  const attachments = await listSupportAttachments({ companyId: scope.companyId, customerId: supportCase.customer_id, caseId: supportCase.id, audience: 'staff' })
    .catch(() => null)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title={supportCase.title} subtitle="Supportärende" userEmail={context.email} />
      <main className="space-y-6 p-6 lg:p-8">
        <nav aria-label="Brödsmulor" className="text-sm">
          <Link href="/admin/customer-cases" className="text-sky-700 underline-offset-2 hover:underline">← Alla supportärenden</Link>
        </nav>
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <Link href={`/admin/customers/${supportCase.customer_id}`} className="font-semibold text-sky-700 hover:underline">Öppna kundkort</Link>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">Internt: {formatStatusLabel(supportCase.status)}</span>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">Kunden ser: {publicSupportStatus(supportCase.status)}</span>
          <span className="text-xs text-slate-500">Skapat {formatDate(supportCase.created_at)}</span>
        </section>

        <section aria-labelledby="history-heading" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 id="history-heading" className="text-lg font-semibold text-slate-950">Historik</h2>
          <ol className="mt-4 space-y-3">
            {events.length === 0 ? <li className="text-sm text-slate-600">Ingen historik ännu.</li> : null}
            {events.map((event) => {
              const entry = ENTRY_LABELS[event.event_type]
              const visible = entry?.customerVisible === true && event.payload?.visibility === 'customer'
              return (
                <li key={event.id} className={`rounded-2xl border p-4 ${entry?.tone ?? 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">
                      {entry?.label ?? 'Systemhändelse'}
                      {event.payload?.kind === 'phone_summary' ? ' · samtalssammanfattning' : ''}
                    </span>
                    <span>{visible ? 'Synlig för kunden' : 'Endast internt'} · {formatDate(event.created_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{event.message}</p>
                </li>
              )
            })}
          </ol>
        </section>

        <section aria-labelledby="attachments-heading" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 id="attachments-heading" className="text-lg font-semibold text-slate-950">Bilagor</h2>
          <p className="mt-1 text-sm text-slate-600">PDF, PNG eller JPEG, högst 4 MB. Varje fil kontrolleras innan den kan öppnas.</p>
          {attachments === null ? (
            <p className="mt-4 text-sm text-amber-800">Bilagor är inte aktiverade i den här miljön än.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {attachments.length === 0 ? <li className="text-sm text-slate-600">Inga bilagor ännu.</li> : null}
              {attachments.map((file) => (
                <li key={file.public_reference} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 p-3 text-sm">
                  <span className="font-medium text-slate-900">{file.file_name}</span>
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
          {canWrite && !closed && attachments !== null ? (
            <form action={uploadSupportAttachmentAction} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="case_id" value={supportCase.id} />
              <input type="hidden" name="expected_company_id" value={scope.companyId} />
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Fil</span>
                <input type="file" name="file" required accept="application/pdf,image/png,image/jpeg" className="text-sm" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700">Vem ser filen?</span>
                <select name="visibility" defaultValue="internal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                  <option value="internal">Endast internt</option>
                  <option value="customer">Även kunden</option>
                </select>
              </label>
              <button type="submit" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Bifoga</button>
            </form>
          ) : null}
        </section>

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
