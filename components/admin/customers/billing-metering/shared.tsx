// components/admin/customers/billing-metering/shared.tsx
'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

export function SubmitButton({
 idleLabel,
 pendingLabel,
}: {
 idleLabel: string
 pendingLabel: string
}) {
 const { pending } = useFormStatus()

 return (
 <button
 type="submit"
 disabled={pending}
 className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 "
 >
 {pending ? pendingLabel : idleLabel}
 </button>
 )
}

export function QuickActionButton({
 idleLabel,
 pendingLabel,
 tone = 'default',
}: {
 idleLabel: string
 pendingLabel: string
 tone?: 'default' | 'warning' | 'info' | 'success'
}) {
 const { pending } = useFormStatus()

 const toneClass =
 tone === 'warning'
 ? 'border-amber-300 bg-amber-50 text-amber-700 '
 : tone === 'info'
 ? 'border-emerald-300 bg-emerald-50 text-emerald-700 '
 : tone === 'success'
 ? 'border-emerald-300 bg-emerald-50 text-emerald-700 '
 : 'border-slate-300 bg-white text-slate-700 '

 return (
 <button
 type="submit"
 disabled={pending}
 className={`inline-flex items-center justify-center rounded-2xl border px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
 >
 {pending ? pendingLabel : idleLabel}
 </button>
 )
}

export function SectionCard({
 title,
 description,
 children,
}: {
 title: string
 description: string
 children: ReactNode
}) {
 return (
 <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="mb-5">
 <h2 className="text-lg font-semibold text-slate-900 ">
 {title}
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {description}
 </p>
 </div>
 {children}
 </div>
 )
}
