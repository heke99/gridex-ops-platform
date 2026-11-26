'use client'

import { useRef, useState, type FormEvent } from 'react'
import { targetedRequestFields, type TargetedRequestField } from '@/lib/customer-portal/targetedRequestFields'
import { submitPortalTargetedRequest, type TargetedRequestResult } from './actions'

type Props = { companyId: string; requestId: string; siteId: string | null; fields: TargetedRequestField[] }

export default function TargetedRequestForm({ companyId, requestId, siteId, fields }: Props) {
  const [result, setResult] = useState<TargetedRequestResult | null>(null)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const intent = useRef<string>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || result?.status === 'saved') return
    const form = new FormData(event.currentTarget)
    const storageKey = ['gridex-request-reply', companyId, requestId, siteId ?? 'customer'].join(':')
    if (!intent.current) {
      try { intent.current = sessionStorage.getItem(storageKey) } catch {}
      intent.current ??= crypto.randomUUID()
      try { sessionStorage.setItem(storageKey, intent.current) } catch {}
    }
    form.set('intentId', intent.current)
    inFlight.current = true
    setPending(true)
    setResult(null)
    try {
      setResult(await submitPortalTargetedRequest(form))
    } catch {
      setResult({ status: 'error', message: 'Inget svarskvitto mottogs. Försök igen med samma uppgifter.' })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="siteId" value={siteId ?? ''} />
      {fields.map((key) => {
        const field = targetedRequestFields[key]
        return (
          <label className="grid gap-1 text-sm font-medium" key={key}>
            {field.label}
            <input name={key} type={field.type} inputMode={'numeric' in field ? 'numeric' : undefined} maxLength={field.limit} required
              disabled={pending || result?.status === 'saved'} className="rounded-xl border border-slate-300 px-3 py-2" />
          </label>
        )
      })}
      <button type="submit" disabled={pending || result?.status === 'saved'} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? 'Sparar…' : 'Skicka svar'}
      </button>
      {result?.status === 'error' ? <p role="alert">{result.message}</p> : null}
      {result?.status === 'saved' ? <p role="status">Svaret har sparats. Kvitto {result.receiptId}</p> : null}
    </form>
  )
}
