'use client'

import { startTransition, useActionState, useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useUnsavedChanges } from '@/components/admin/AdminUnsavedChanges'
import type { CustomerInternalNoteReceipt } from '@/app/admin/customers/[id]/actions'
import { isUuid } from '@/lib/validation/uuid'

type State = { confirmed: boolean; message: string }
const initialState: State = { confirmed: false, message: '' }
const UNCONFIRMED = 'Anteckningens sparande kunde inte bekräftas. Den kan redan finnas i historiken. Utkastet finns kvar; kontrollera historiken innan du försöker igen.'

export default function CustomerInternalNoteForm({ customerId, action, children, className, canWrite = true }: {
  customerId: string
  action: (formData: FormData) => Promise<CustomerInternalNoteReceipt | void>
  children?: ReactNode
  className?: string
  canWrite?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const inFlight = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [feedbackHidden, setFeedbackHidden] = useState(false)
  const discard = useCallback(() => { formRef.current?.reset(); setDirty(false); setFeedbackHidden(true) }, [])
  useUnsavedChanges(dirty, discard)
  const [state, formAction, pending] = useActionState(async (_previous: State, formData: FormData): Promise<State> => {
    try {
      const receipt = await action(formData)
      if (!receipt || receipt.customerId !== customerId ||
          !isUuid(receipt.noteId) || !isUuid(receipt.companyId) || !isUuid(receipt.actorUserId)) {
        return { confirmed: false, message: UNCONFIRMED }
      }
      formRef.current?.reset()
      setDirty(false)
      return { confirmed: true, message: 'Anteckningen är sparad.' }
    } catch {
      return { confirmed: false, message: UNCONFIRMED }
    } finally {
      inFlight.current = false
    }
  }, initialState)

  function submit(event: FormEvent<HTMLFormElement>) {
    // Keep failed or unconfirmed uncontrolled drafts: dispatch explicitly rather
    // than letting React automatically reset a resolved form action.
    event.preventDefault()
    if (!canWrite || !dirty || pending || inFlight.current) return
    const data = new FormData(event.currentTarget)
    inFlight.current = true
    setFeedbackHidden(false)
    startTransition(() => formAction(data))
  }

  return (
    <form ref={formRef} data-dirty-form="true" action={formAction} onSubmit={submit} onChange={() => { if (canWrite) { setDirty(true); setFeedbackHidden(true) } }} aria-busy={pending} className={className}>
      <fieldset disabled={pending || !canWrite} className="contents">
        {children}
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={discard} disabled={!canWrite || !dirty || pending} className="inline-flex items-center rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Kasta utkast</button>
          <button type="submit" disabled={!canWrite || !dirty || pending} className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">Spara anteckning</button>
        </div>
      </fieldset>
      {!canWrite ? <p role="status" className="mt-3 text-sm text-slate-700">Läsläge: du saknar behörighet att lägga till en anteckning.</p> : null}
      {dirty ? <p role="status" className="mt-3 text-sm text-amber-800">Osparad anteckning</p> : null}
      {pending ? <p role="status" className="mt-3 text-sm text-slate-700">Sparar anteckning…</p> : null}
      {!pending && !feedbackHidden && state.message && (!state.confirmed || !dirty) ? <p role={state.confirmed ? 'status' : 'alert'} className="mt-3 text-sm text-slate-700">{state.message}</p> : null}
    </form>
  )
}
