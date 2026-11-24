'use client'

import { useActionState } from 'react'
import { processEdielOutboxWithResultAction } from './actions'

export function QueueRunFeedback({ result }: { result: Awaited<ReturnType<typeof processEdielOutboxWithResultAction>> }) {
  return <p role="status" aria-live="polite" className="w-full">
    {result.processed} behandlade, {result.sent} skickade, {result.failed} fel, {result.blocked} spärrade.
    {' '}{result.deliveryUncertain} leveransovissa i körningen.
    {result.stoppedBy === 'queue_empty' ? ' Det finns inga fler klara poster i urvalet.' : ''}
  </p>
}

export default function ProcessOutboxForm() {
  const [result, action, pending] = useActionState(processEdielOutboxWithResultAction, null)
  return <form action={action} className="flex flex-wrap items-end gap-3">
    <label>Miljö<select name="environment" className="block rounded border p-2">
      <option value="">Alla</option><option value="test">Test</option><option value="production">Produktion</option>
    </select></label>
    <label>Limit<input name="limit" defaultValue="10" className="block w-20 rounded border p-2" /></label>
    <button type="submit" disabled={pending} className="rounded bg-slate-950 p-2 font-semibold text-white">Processa kö</button>
    {result ? <QueueRunFeedback result={result} /> : null}
  </form>
}
