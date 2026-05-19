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
 ? 'bg-red-600 text-white hover:bg-red-700'
 : tone === 'secondary'
 ? 'bg-white text-slate-900 ring-1 ring-emerald-200 hover:bg-slate-50 '
 : 'bg-emerald-700 text-white hover:opacity-90 '

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