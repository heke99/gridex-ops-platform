'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  resolveInboundManualReviewUiAction,
  type ManualReviewActionState,
} from './reviewActions'

type Props = {
  jobId: string
  inboundEmailMessageId: string
  reviewOwner: string
  reviewPriority: string
  reviewSla: string
  reviewReason: string
}

const initialState: ManualReviewActionState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      disabled={pending}
      className="w-full rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
    >
      {pending ? 'Sparar…' : 'Spara beslut'}
    </button>
  )
}

export default function InboundManualReviewForm({
  jobId,
  inboundEmailMessageId,
  reviewOwner,
  reviewPriority,
  reviewSla,
  reviewReason,
}: Props) {
  const [state, formAction] = useActionState(resolveInboundManualReviewUiAction, initialState)

  return (
    <form
      action={formAction}
      className="grid gap-4 rounded-2xl border border-amber-200 bg-white p-4 lg:grid-cols-[1fr_180px_auto]"
    >
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="inbound_email_message_id" value={inboundEmailMessageId} />
      <div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>Owner: <strong className="text-slate-900">{reviewOwner}</strong></span>
          <span>Prioritet: <strong className="text-slate-900">{reviewPriority}</strong></span>
          <span>SLA: <strong className="text-slate-900">{reviewSla}</strong></span>
        </div>
        <p className="mt-2 text-sm text-slate-700">Orsak: {reviewReason}</p>
        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600" htmlFor={`resolution-${jobId}`}>Lösning</label>
        <input
          id={`resolution-${jobId}`}
          name="resolution"
          required
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-950 outline-none focus:border-emerald-500"
          placeholder="Beskriv vad som verifierades eller korrigerades"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600" htmlFor={`next-status-${jobId}`}>Nästa status</label>
        <select
          id={`next-status-${jobId}`}
          name="next_status"
          defaultValue="queued"
          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950"
        >
          <option value="queued">Köa om</option>
          <option value="completed">Markera klar</option>
          <option value="failed">Markera misslyckad</option>
        </select>
      </div>
      <div className="flex items-end">
        <SubmitButton />
      </div>
      {state.error ? (
        <p className="text-sm font-medium text-red-700 lg:col-span-3" role="alert">{state.error}</p>
      ) : null}
    </form>
  )
}
