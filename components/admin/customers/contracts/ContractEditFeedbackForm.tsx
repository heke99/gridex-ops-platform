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
    if (submitting.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    submitting.current = true
    setResult(null)
    startTransition(async () => {
      try {
        const next = await action(data)
        setResult(next)
      } finally {
        submitting.current = false
      }
    })
  }

  return <form ref={formRef} method="post" onSubmit={submit} className="mt-4 space-y-4" aria-busy={pending}>
    {result?.status === 'invalid' ? <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{result.message}</p> : null}
    {result?.status === 'saved' ? <p role="status" className="text-sm text-emerald-800">Avtalet har sparats.</p> : null}
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      {children}
    </fieldset>
  </form>
}
