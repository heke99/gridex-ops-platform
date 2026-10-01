'use client'

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react'
import { useUnsavedChanges } from '@/components/admin/AdminUnsavedChanges'
import type { SupportFormState } from './formState'

/** Shared OPS/portal form. A network error keeps both the draft and request
 * key, so a retry recovers the same atomic command rather than creating another. */
export default function SupportActionForm({ action, fallbackAction, initialKey, expectedRevision = 0, children, submitLabel, className }: {
  action: (data: FormData) => Promise<SupportFormState>; initialKey: string; expectedRevision?: number;
  fallbackAction?: (data: FormData) => Promise<void>;
  children: ReactNode; submitLabel: string; className?: string
}) {
  const form = useRef<HTMLFormElement>(null)
  const inFlight = useRef(false)
  const [pending, transition] = useTransition()
  const [requestKey, setRequestKey] = useState(initialKey)
  const [savedRevision, setSavedRevision] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [state, setState] = useState<SupportFormState | null>(null)
  useUnsavedChanges(dirty)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    const data = new FormData(event.currentTarget)
    inFlight.current = true
    transition(async () => {
      try {
        const result = await action(data)
        setState(result)
        if (result.ok) {
          form.current?.reset()
          setSavedRevision(result.revision)
          setRequestKey(crypto.randomUUID())
          setDirty(false)
        } else {
          requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus())
        }
      } catch {
        setState({ ok: false, code: 'support_response_lost', message: 'Svaret kunde inte bekräftas. Ditt utkast och försöksnyckel är kvar. Läs om ärendet eller försök igen med samma uppgifter.' })
      } finally { inFlight.current = false }
    })
  }

  return <form ref={form} action={fallbackAction} onSubmit={submit} onChange={() => setDirty(true)} className={className} aria-busy={pending} data-dirty-form={dirty ? 'true' : undefined}>
    <input type="hidden" name="idempotency_key" value={requestKey} />
    <input type="hidden" name="expected_revision" value={Math.max(expectedRevision, savedRevision ?? 0)} />
    {state ? <p role={state.ok ? 'status' : 'alert'} tabIndex={state.ok ? undefined : -1} className={`rounded-xl border p-3 text-sm ${state.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>{state.message}</p> : null}
    <fieldset disabled={pending} className="min-w-0 space-y-3 disabled:opacity-60">{children}</fieldset>
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={pending || (state !== null && !state.ok && state.conflict === true)} className="min-h-11 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60">{pending ? 'Sparar…' : submitLabel}</button>
      <button type="button" disabled={pending} onClick={() => { form.current?.reset(); setDirty(false); setState(null) }} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Avbryt</button>
    </div>
  </form>
}
