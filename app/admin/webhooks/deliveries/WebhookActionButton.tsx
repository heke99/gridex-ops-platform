'use client'

import { useFormStatus } from 'react-dom'

/** The page supplies a current server guard receipt; each action rechecks it. */
export default function WebhookActionButton({
  canWrite, disabledMessage, label, pendingLabel, className,
}: {
  canWrite: boolean
  disabledMessage: string | null
  label: string
  pendingLabel: string
  className: string
}) {
  const { pending } = useFormStatus()
  return (
    <>
      <button type="submit" disabled={!canWrite || pending} aria-busy={pending}
        className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}>
        {pending ? pendingLabel : label}
      </button>
      {!canWrite && disabledMessage ? <p role="status" className="mt-2 text-xs font-normal text-amber-800">{disabledMessage}</p> : null}
    </>
  )
}
