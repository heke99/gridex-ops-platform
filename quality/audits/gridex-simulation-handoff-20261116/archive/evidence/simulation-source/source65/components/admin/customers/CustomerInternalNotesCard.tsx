'use client'

import { useFormStatus } from 'react-dom'
import { createCustomerInternalNoteAction } from '@/app/admin/customers/[id]/actions'
import type { CustomerInternalNoteRow } from '@/lib/masterdata/types'

type CustomerInternalNotesCardProps = {
 customerId: string
 notes: CustomerInternalNoteRow[]
 actorDirectory: Record<string, string>
}

function SubmitButton() {
 const { pending } = useFormStatus()

 return (
 <button
 type="submit"
 disabled={pending}
 className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 "
 >
 {pending ? 'Sparar...' : 'Spara anteckning'}
 </button>
 )
}

function formatDateTime(value: string): string {
 return new Date(value).toLocaleString('sv-SE')
}

export default function CustomerInternalNotesCard({
 customerId,
 notes,
 actorDirectory,
}: CustomerInternalNotesCardProps) {
 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="mb-6">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Interna anteckningar
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Intern historik för drift och kundspecifik information.
 </p>
 </div>

 <form action={createCustomerInternalNoteAction} className="space-y-4">
 <input type="hidden" name="customer_id" value={customerId} />

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Ny anteckning
 </span>
 <textarea
 name="body"
 rows={4}
 required
 placeholder="Skriv intern anteckning..."
 className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 />
 </label>

 <div className="flex justify-end">
 <SubmitButton />
 </div>
 </form>

 <div className="mt-6 space-y-3">
 {notes.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-700 ">
 Inga interna anteckningar ännu.
 </div>
 ) : (
 notes.map((note) => (
 <article
 key={note.id}
 className="rounded-2xl border border-slate-200 p-4 "
 >
 <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 ">
 <span className="rounded-full bg-slate-100 px-2.5 py-1 ">
 {actorDirectory[note.created_by ?? ''] ?? note.created_by ?? 'Okänd användare'}
 </span>
 <span>{formatDateTime(note.created_at)}</span>
 </div>

 <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800 ">
 {note.body}
 </p>
 </article>
 ))
 )}
 </div>
 </section>
 )
}