'use client'

import { useFormStatus } from 'react-dom'

type EdielSendButtonProps = {
  label?: string
  pendingLabel?: string
  disabled?: boolean
  className?: string
}

export function EdielSendButton({
  label = 'Skicka',
  pendingLabel = 'Skickar…',
  disabled = false,
  className,
}: EdielSendButtonProps) {
  const { pending } = useFormStatus()
  const isDisabled = disabled || pending

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-busy={pending}
      className={className ?? `rounded-2xl border px-4 py-2 text-sm font-medium ${isDisabled ? 'cursor-not-allowed bg-slate-100 border-slate-200 text-slate-400' : 'bg-white border-slate-300 text-slate-900 hover:bg-slate-50'}`}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}
