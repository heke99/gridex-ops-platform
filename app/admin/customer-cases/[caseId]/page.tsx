import Link from 'next/link'
import { notFound } from 'next/navigation'
import AdminHeader from '@/components/admin/AdminHeader'
import SupportCaseComposer from '@/components/admin/support/SupportCaseComposer'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { hasPermissionRequirement } from '@/lib/admin/accessModel'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { getCustomerCaseById, listCustomerCaseEvents } from '@/lib/customer-cases/db'
import { PHONE_VERIFICATION_METHODS, SUPPORT_EVENT_TYPES, publicSupportStatus } from '@/lib/customer-service/supportConversation'
import { addInternalNoteAction, recordPhoneInteractionAction, replyToCustomerAction } from '../actions'

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
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const scope = await resolveAdminTenantReadScope(context)
  // Tenant support content is only shown inside the tenant's own scope.
  if (!scope.companyId) notFound()
  const { caseId } = await params
  const supportCase = await getCustomerCaseById(caseId, scope.companyId)
  if (!supportCase) notFound()
  const events = (await listCustomerCaseEvents(supportCase.id, scope.companyId)).slice().reverse()
  const canWrite = !scope.isPlatformAdmin && hasPermissionRequirement(context.permissions, { anyOf: ['cases.write'] })
  const closed = ['resolved', 'closed', 'cancelled'].includes(supportCase.status)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title={supportCase.title} subtitle="Supportärende" userEmail={context.email} />
      <main className="space-y-6 p-6 lg:p-8">
        <nav aria-label="Brödsmulor" className="text-sm">
          <Link href="/admin/customer-cases" className="text-sky-700 underline-offset-2 hover:underline">← Alla supportärenden</Link>
        </nav>
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <Link href={`/admin/customers/${supportCase.customer_id}`} className="font-semibold text-sky-700 hover:underline">Öppna kundkort</Link>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">Internt: {supportCase.status}</span>
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
