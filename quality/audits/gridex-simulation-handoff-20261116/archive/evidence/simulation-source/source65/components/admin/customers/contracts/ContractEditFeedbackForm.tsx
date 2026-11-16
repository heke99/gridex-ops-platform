'use client'

import {useEffect, useRef, useState, useTransition, type ReactNode, type FormEvent} from 'react'
import type {ContractEditSaveResult} from '@/app/admin/customers/[id]/contracts/[contractId]/signature/actions'

/** Submit from an event handler: a rejected validation must not reset any of
 * the uncontrolled fields supplied by the server component. */
export function ContractEditFeedbackForm({action, children}: {
  action: (data: FormData) => Promise<ContractEditSaveResult>
  children: ReactNode
}) {
  const [result, setResult] = useState<ContractEditSaveResult | null>(null)
  const [pending, startTransition] = useTransition()
  const submitting = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!pending && result?.status === 'invalid' && result.field) {
      const field = formRef.current?.elements.namedItem(result.field)
      if (field instanceof HTMLElement) field.focus()
    }
  }, [pending, result])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || result?.status === 'unconfirmed') return
    const form = event.currentTarget
    const data = new FormData(form)
    submitting.current = true
    setResult(null)
    startTransition(async () => {
      try {
        const next = await action(data)
        setResult(next)
      } catch {
        // A rejected transport may have committed. Keep entered fields and
        // require a fresh read rather than offering an uncertain write again.
        setResult({status:'unconfirmed', message:'Sparningen kunde inte bekräftas. Ladda om kundkortet och kontrollera de sparade uppgifterna innan du försöker igen.'})
      } finally {
        submitting.current = false
      }
    })
  }

  return <form ref={formRef} method="post" onSubmit={submit} className="mt-4 space-y-4" aria-busy={pending}>
    {result?.status === 'invalid' ? <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{result.message}</p> : null}
    {result?.status === 'unconfirmed' ? <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{result.message}</p> : null}
    {result?.status === 'saved' ? <p role="status" className="text-sm text-emerald-800">{result.signingLinkNeedsRenewal ? 'Avtalet har sparats. Tidigare signeringslänkar är återkallade. Skicka en ny signeringslänk när uppgifterna är kontrollerade.' : 'Avtalet har sparats.'}</p> : null}
    <fieldset disabled={pending || result?.status === 'unconfirmed'} className="min-w-0 space-y-4">
      {children}
    </fieldset>
  </form>
}
