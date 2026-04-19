'use client'

import { useFormStatus } from 'react-dom'

export default function SubmitButton({
  idleLabel,
  pendingLabel,
  tone = 'primary',
}: {
  idleLabel: string
  pendingLabel: string
  tone?: 'primary' | 'secondary' | 'danger'
}) {
  const { pending } = useFormStatus()

  const toneClass =
    tone === 'danger'
      ? 'bg-rose-600 text-white hover:bg-rose-700'
      : tone === 'secondary'
        ? 'bg-white text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 dark:bg-slate-950 dark:text-white dark:ring-slate-700 dark:hover:bg-slate-900'
        : 'bg-slate-950 text-white hover:opacity-90 dark:bg-white dark:text-slate-950'

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  )
}