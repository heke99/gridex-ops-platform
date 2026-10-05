'use client'

import { useActionState } from 'react'
import { cancelIdentityChangeAction, requestIdentityChangeAction } from '@/app/admin/customers/[id]/identity-actions'
import { IDLE_CUSTOMER_ACTION_STATE } from '@/app/admin/customers/[id]/customer-action-state'

type HistoryEntry = {
  id: string
  event_type: string
  actor_kind: string
  field: 'personal_number' | 'org_number'
  previous_value_masked: string | null
  new_value_masked: string | null
  detail: Record<string, unknown>
  created_at: string
}

type PendingRequest = { id: string; field: 'personal_number' | 'org_number'; newMasked: string | null; expiresAt: string | null; recipientMasked: string | null }

const EVENT_LABELS: Record<string, string> = {
  requested: 'Ändring begärd',
  approval_sent: 'Godkännandemejl skickat',
  approved: 'Kunden godkände',
  rejected: 'Kunden nekade',
  applied: 'Ändring genomförd',
  expired: 'Länken gick ut',
  cancelled: 'Begäran avbruten',
}
const ACTOR_LABELS: Record<string, string> = { staff: 'Personal', customer: 'Kunden', system: 'Systemet' }

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value))
}

function Banner({ state }: { state: { status: string; message?: string | null } }) {
  if (state.status === 'error') return <p role="alert" className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{state.message ?? 'Åtgärden kunde inte slutföras.'}</p>
  if (state.status === 'success') return <p role="status" className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{state.message}</p>
  return null
}

export default function CustomerIdentityChangePanel({
  customerId,
  companyId,
  customerType,
  history,
  pending,
  canWrite,
}: {
  customerId: string
  companyId: string
  customerType: string | null
  history: HistoryEntry[]
  pending: PendingRequest[]
  canWrite: boolean
}) {
  const [requestState, requestAction, requestPending] = useActionState(requestIdentityChangeAction, IDLE_CUSTOMER_ACTION_STATE)
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelIdentityChangeAction, IDLE_CUSTOMER_ACTION_STATE)
  const fieldName = customerType === 'private' ? 'personal_number' : 'org_number'
  const label = fieldName === 'personal_number' ? 'personnummer' : 'organisationsnummer'

  return (
    <section aria-labelledby="identity-change-heading" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 id="identity-change-heading" className="text-lg font-semibold text-slate-950">Ändra {label}</h3>
      <p className="mt-1 text-sm text-slate-600">
        Varje ändring loggas. Har kunden avtal skickas ett mejl där kunden godkänner ändringen. Numret ändras först då och gäller sedan kundens alla avtal. Redan signerade avtalsdokument ändras inte.
      </p>

      {pending.map((request) => (
        <div key={request.id} className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Väntar på kundens godkännande: nytt nummer {request.newMasked}</p>
          <p>Mejl skickat till {request.recipientMasked ?? '—'}. Länken gäller till {formatDate(request.expiresAt)}.</p>
          {canWrite ? (
            <form action={cancelAction} className="mt-2">
              <input type="hidden" name="customer_id" value={customerId} />
              <input type="hidden" name="expected_company_id" value={companyId} />
              <input type="hidden" name="request_id" value={request.id} />
              <button type="submit" disabled={cancelPending} className="rounded-xl border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-900 disabled:opacity-60">
                {cancelPending ? 'Avbryter…' : 'Avbryt begäran'}
              </button>
            </form>
          ) : null}
        </div>
      ))}
      <div className="mt-3 space-y-2"><Banner state={requestState} /><Banner state={cancelState} /></div>

      {canWrite && pending.length === 0 ? (
        <form action={requestAction} className="mt-4 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="expected_company_id" value={companyId} />
          <input type="hidden" name="field" value={fieldName} />
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Nytt {label}</span>
            <input name="new_value" required inputMode="numeric" autoComplete="off" placeholder={fieldName === 'personal_number' ? 'ÅÅÅÅMMDD-XXXX' : 'NNNNNN-NNNN'} className="rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Varför ändras numret?</span>
            <input name="reason" required minLength={3} maxLength={500} placeholder="t.ex. felregistrerat vid avtal" className="rounded-xl border border-slate-300 px-3 py-2" />
          </label>
          <div className="md:col-span-2">
            <button type="submit" disabled={requestPending} className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {requestPending ? 'Skickar…' : `Ändra ${label}`}
            </button>
          </div>
        </form>
      ) : null}

      <h4 className="mt-6 text-sm font-semibold text-slate-900">Historik</h4>
      {history.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">Inga ändringar ännu.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-2xl border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-semibold text-slate-900">{EVENT_LABELS[entry.event_type] ?? entry.event_type}</span>
                <span className="text-xs text-slate-600">{ACTOR_LABELS[entry.actor_kind] ?? entry.actor_kind} · {formatDate(entry.created_at)}</span>
              </div>
              <p className="text-slate-700">{entry.previous_value_masked ?? 'saknas'} → {entry.new_value_masked ?? '—'}</p>
              {typeof entry.detail?.reason === 'string' ? <p className="text-xs text-slate-600">Orsak: {entry.detail.reason}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
