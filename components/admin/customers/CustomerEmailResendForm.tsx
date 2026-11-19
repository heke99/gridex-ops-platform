'use client'

import { useActionState } from 'react'
import {
  resendCustomerEmailAction,
  type CustomerEmailResendState,
} from '@/app/admin/customers/[id]/email-actions'

type Props = { customerId: string; logId: string; label: string; className?: string }

const initialState: CustomerEmailResendState = { status: 'idle' }
const feedback = {
  idle: '',
  queued: 'Meddelandet har lagts i utskickskön.',
  alreadySent: 'Omskicket har redan skickats.',
  blocked: 'Omskicket är blockerat. Kontrollera bolagets utskicksinställningar eller be en administratör om hjälp.',
  retry: 'Det gick inte att bekräfta köläggningen. Kontrollera kommunikationshistoriken före ett nytt försök.',
  unverified: 'Utskickets status kunde inte bekräftas. Läs om sidan och kontrollera kommunikationshistoriken innan du skickar igen.',
}

function ResendForm({ customerId, logId, label, className }: Props) {
  const [state, action, pending] = useActionState(resendCustomerEmailAction, initialState)
  const warning = !pending && ['blocked', 'retry', 'unverified'].includes(state.status)
  const message = pending ? 'Kontrollerar utskicket…' : feedback[state.status]

  return (
    <form action={action} aria-busy={pending} className={className}>
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="log_id" value={logId} />
      <button
        type="submit"
        disabled={pending || state.status === 'unverified'}
        className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {label}
      </button>
      <p role="status" className={!message ? 'sr-only' : warning ? 'mt-2 text-xs text-amber-900' : 'mt-2 text-xs text-slate-700'}>
        {message}
      </p>
      {!pending && state.status !== 'idle' ? (
        <a href={`/admin/customers/${encodeURIComponent(customerId)}?tab=communication`} className="mt-2 inline-block text-xs font-semibold text-slate-700 underline">
          Läs om kommunikationen
        </a>
      ) : null}
    </form>
  )
}

export default function CustomerEmailResendForm(props: Props) {
  return <ResendForm key={`${props.customerId}:${props.logId}`} {...props} />
}
