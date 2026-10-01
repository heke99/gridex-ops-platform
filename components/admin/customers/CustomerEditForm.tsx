'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { captureFormDraft, draftRevisionIsStale, restoreFormDraft, useAdminDraftMemory, useUnsavedChanges } from '@/components/admin/AdminUnsavedChanges'

export type CustomerEditResult = { revision: number; changed: boolean; replayed: boolean; notice?: string }
export type CustomerEditResponse = CustomerEditResult | { error: true; code: string }

export function isConfirmedCustomerEditResponse(value: unknown): value is CustomerEditResult {
  if (!value || typeof value !== 'object' || 'error' in value || !('changed' in value) || typeof value.changed !== 'boolean' || !('replayed' in value) || typeof value.replayed !== 'boolean') return false
  if ('notice' in value && value.notice !== undefined && typeof value.notice !== 'string') return false
  return 'revision' in value && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
}

export function customerEditError(error: unknown): { message: string; conflict: boolean } {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const message = error instanceof Error ? error.message : ''
  if (['draft_revision_conflict', 'contact_revision_conflict', 'contact_selection_conflict', 'billing_revision_conflict', 'billing_profile_revision_conflict', 'billing_profile_override_revision_conflict', 'support_revision_conflict', 'legal_profile_revision_conflict', 'customer_lifecycle_revision_conflict', 'lifecycle_revision_conflict', 'lifecycle_state_conflict', 'lifecycle_resource_conflict', 'address_book_revision_conflict', 'address_book_selection_conflict', 'site_revision_conflict', 'site_idempotency_conflict'].includes(code || message)) {
    return { conflict: true, message: 'Uppgifterna har ändrats av någon annan. Ditt utkast är kvar. Läs om sidan och jämför med de sparade uppgifterna innan du försöker igen.' }
  }
  if (['contact_idempotency_conflict', 'billing_idempotency_conflict', 'billing_profile_idempotency_conflict', 'billing_profile_override_idempotency_conflict', 'support_idempotency_conflict', 'legal_profile_idempotency_conflict', 'customer_lifecycle_idempotency_conflict', 'lifecycle_idempotency_conflict', 'address_book_idempotency_conflict'].includes(code || message)) {
    return { conflict: true, message: 'Det här försöket avser en annan tidigare ändring. Läs om de sparade uppgifterna innan du gör ett nytt försök.' }
  }
  if (['Forbidden', 'Unauthorized', 'Archived customer'].includes(message) || code === 'support_session_revoked' || code.endsWith('_forbidden') || code.endsWith('_unavailable')) {
    return { conflict: false, message: 'Du saknar aktuell behörighet att ändra dessa uppgifter. Ditt utkast är kvar.' }
  }
  if (['Ange minst namn, e-post eller telefon', 'Företag eller förening kräver namn på primär kontaktperson', 'Välj en giltig typ för sekundär kontakt'].includes(code || message)) {
    return { conflict: false, message: code || message }
  }
  if (['invalid_customer_address', 'invalid_address_command'].includes(code || message)) {
    return { conflict: false, message: 'Kontrollera gatuadress, tvåbokstavskod för land och ordningen på flyttdatumen. Ditt utkast är kvar.' }
  }
  if ((code || message) === 'address_save_unconfirmed') {
    return { conflict: false, message: 'Adressändringen kunde inte bekräftas. Ditt utkast är kvar. Läs om sidan och kontrollera sparad adress innan du gör ett nytt försök.' }
  }
  if (['contact_method_required', 'contact_name_required', 'ambiguous_primary_contact', 'invalid_contact_command'].includes(code || message)) {
    return { conflict: false, message: 'Kontrollera kontaktens namn, e-post, telefon och val av primär eller sekundär kontakt. Ditt utkast är kvar.' }
  }
  if (['invalid_billing_profile_command', 'invalid_billing_profile_field', 'invalid_contact_field'].includes(code || message)) {
    return { conflict: false, message: 'Kontrollera uppgifterna och valt distributionssätt. E-post ska vara en giltig adress och landskod ska ha två bokstäver. Ditt utkast är kvar.' }
  }
  if (['validation', 'invalid_legal_profile_command', 'invalid_legal_profile_field'].includes(code || message)) {
    return { conflict: false, message: 'Kontrollera den juridiska profilen. Privatkund kräver för- och efternamn; företag och förening kräver registrerat namn och organisationsnummer. Ditt utkast är kvar.' }
  }
  if ((code || message) === 'legal_lifecycle_command_required') {
    return { conflict: true, message: 'Kundens status har ändrats. Ditt utkast är kvar. Läs om profilen; statusändringar kräver en separat livscykelåtgärd.' }
  }
  return { conflict: false, message: 'Ändringen kunde inte bekräftas. Ditt utkast och försöksnyckel är kvar. Försök igen med samma uppgifter eller läs om sidan för att kontrollera sparningen.' }
}

export default function CustomerEditForm({ action, fallbackAction, children, submitLabel, className, onCancel, draftKey, noValidate = false, confirmMessage }: {
  action: (data: FormData) => Promise<CustomerEditResponse>
  fallbackAction?: (data: FormData) => Promise<void>
  children: ReactNode
  submitLabel: string
  className?: string
  onCancel?: () => void
  draftKey?: string
  noValidate?: boolean
  confirmMessage?: string
}) {
  const form = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const inFlight = useRef(false)
  const [pending, startTransition] = useTransition()
  const memory = useAdminDraftMemory()
  const [restoredDraft] = useState(() => memory.get(draftKey))
  const [dirty, setDirty] = useState(Boolean(restoredDraft))
  const [result, setResult] = useState<{ message: string; error: boolean; conflict?: boolean } | null>(null)
  const discard = useCallback(() => {
    form.current?.reset()
    memory.clear(draftKey)
    setDirty(false)
    setResult(null)
    onCancel?.()
  }, [memory, draftKey, onCancel])
  useUnsavedChanges(dirty, discard)
  useEffect(() => {
    if (!restoredDraft || !form.current) return
    const stale = draftRevisionIsStale(captureFormDraft(form.current), restoredDraft)
    restoreFormDraft(form.current, restoredDraft)
    if (stale) {
      const frame = requestAnimationFrame(() => setResult({ error: true, ...customerEditError({ code: 'draft_revision_conflict' }) }))
      return () => cancelAnimationFrame(frame)
    }
  }, [restoredDraft])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    if (confirmMessage && !window.confirm(confirmMessage)) return
    const data = new FormData(event.currentTarget)
    const submittedDraft = captureFormDraft(event.currentTarget)
    // Server revalidation can remount the editor before the reply is consumed.
    // A successful save must read the saved source rather than restore old revision fields.
    memory.clear(draftKey)
    inFlight.current = true
    startTransition(async () => {
      try {
        const saved = await action(data)
        if (saved && 'error' in saved) throw Object.assign(new Error(saved.code), { code: saved.code })
        if (!isConfirmedCustomerEditResponse(saved)) throw new Error('customer_edit_unconfirmed')
        setDirty(false)
        setResult({ error: false, message: `${saved.changed ? 'Ändringen är sparad.' : 'Uppgifterna är redan sparade.'} Revision ${saved.revision}.${saved.notice ? ` ${saved.notice}` : ''}` })
      } catch (error) {
        memory.put(draftKey, submittedDraft)
        setDirty(true)
        const safe = customerEditError(error)
        setResult({ error: true, ...safe })
        // Focus the inline error, without losing the entered fields.
        requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[role="alert"]')?.focus())
      } finally {
        inFlight.current = false
      }
    })
  }

  return <form ref={form} noValidate={noValidate} action={fallbackAction ?? (async (data) => { await action(data) })} onSubmit={submit} onChange={(event) => { memory.put(draftKey, captureFormDraft(event.currentTarget)); setDirty(true); setResult((previous) => previous && !previous.error ? null : previous) }} data-customer-editor="true" data-dirty-form={dirty ? 'true' : undefined} aria-busy={pending} className={className}>
    {result ? <p role={result.error ? 'alert' : 'status'} tabIndex={result.error ? -1 : undefined} className={`rounded-2xl border px-4 py-3 text-sm ${result.error ? 'border-red-300 bg-red-50 text-red-800' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`}>{result.message}</p> : null}
    {dirty && !result?.error ? <p role="status" className="text-sm font-medium text-amber-900">{restoredDraft ? 'Osparat utkast återställt i samma användares och tenants arbetsyta. Jämför med aktuell revision före sparning.' : 'Osparat utkast'}</p> : null}
    <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-70">{children}</fieldset>
    <div className="flex flex-wrap justify-end gap-3">
      {result?.error ? <button type="button" disabled={pending} onClick={() => router.refresh()} className="min-h-11 rounded-2xl border border-emerald-700 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">Läs in sparade uppgifter</button> : null}
      <button type="button" disabled={pending} onClick={discard} className="min-h-11 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60">Avbryt</button>
      <button type="submit" disabled={pending || result?.conflict} className="min-h-11 rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">{pending ? 'Sparar…' : submitLabel}</button>
    </div>
  </form>
}
