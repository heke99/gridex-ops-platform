'use client'

import { startTransition, useActionState, useCallback, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useUnsavedChanges } from '@/components/admin/AdminUnsavedChanges'
import type { CompanySettingsActionState } from '@/app/admin/company-settings/actions'

const initialState: CompanySettingsActionState = { ok: false, message: '' }
type SettingsAction = (state: CompanySettingsActionState, formData: FormData) => Promise<CompanySettingsActionState>

export default function CompanySettingsForm({
  action, id, className, children, disabled = false,
}: {
  action: SettingsAction
  id?: string
  className?: string
  children?: ReactNode
  disabled?: boolean
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const inFlight = useRef(false)
  const [dirty, setDirty] = useState(false)
  const discard = useCallback(() => { formRef.current?.reset(); setDirty(false) }, [])
  useUnsavedChanges(dirty, discard)
  const [state, formAction, pending] = useActionState(async (previous: CompanySettingsActionState, formData: FormData) => {
    try {
      const result = await action(previous, formData)
      if (!result || typeof result.ok !== 'boolean' || typeof result.message !== 'string' || !result.message.trim()) {
        return { ok: false, message: 'Resultatet kunde inte bekräftas. Läs om sidan innan du försöker igen.' }
      }
      if (result.ok) setDirty(false)
      return result
    } catch {
      return { ok: false, message: 'Resultatet kunde inte bekräftas. Ditt utkast är kvar. Läs om sidan innan du försöker igen.' }
    } finally {
      inFlight.current = false
    }
  }, initialState)

  function submit(event: FormEvent<HTMLFormElement>) {
    // Dispatch explicitly so React's automatic uncontrolled form reset cannot
    // clear an entered draft after a validation/authorization failure.
    event.preventDefault()
    if (disabled || inFlight.current || pending) return
    const data = new FormData(event.currentTarget)
    inFlight.current = true
    startTransition(() => formAction(data))
  }

  return (
    <form ref={formRef} data-dirty-form="true" id={id} action={formAction} onSubmit={submit} aria-busy={pending} className={className}>
      <fieldset disabled={disabled || pending} className="contents" onChange={() => setDirty(true)}>
        {children}
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <button type="reset" onClick={() => setDirty(false)} disabled={!dirty || pending} className="min-h-11 rounded-2xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Avbryt ändringar</button>
          {dirty ? <span role="status" className="text-sm text-amber-800">Osparade ändringar</span> : null}
        </div>
      </fieldset>
      {disabled ? <p className="col-span-full text-sm text-amber-800">Läsläge – du saknar behörighet att ändra bolagsuppgifter och användare.</p> : null}
      {pending ? <p role="status" className="col-span-full text-sm text-slate-700">Sparar…</p> : null}
      {state.message && (!dirty || !state.ok) ? <p role={state.ok ? 'status' : 'alert'} className={`col-span-full rounded-2xl border px-4 py-3 text-sm ${state.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{state.message}</p> : null}
    </form>
  )
}
