'use client'

import { useFormStatus } from 'react-dom'
import { resolveInboundManualReviewAction } from '@/app/admin/inbound-mail/actions'

type Props = {
  jobId: string
  inboundEmailMessageId: string
}

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

export default function InboundManualReviewForm({ jobId, inboundEmailMessageId }: Props) {
  return (
    <form action={resolveInboundManualReviewAction} className="contents">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="inbound_email_message_id" value={inboundEmailMessageId} />
      <div>
        <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600" htmlFor={`resolution-${jobId}`}>Lösning</label>
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
    </form>
  )
}
