'use client'

import { useState, useTransition } from 'react'
import { retryFailedSupplierSwitchAction } from '@/app/admin/customers/[id]/switch-retry-actions'

type SwitchRow = { id: string; status: string; site_id?: string | null; failure_reason?: string | null; requested_start_date?: string | null; created_at?: string | null }

const OUTCOME_TEXT: Record<string, string> = {
  queued: 'Nytt försök är startat. Systemet kontrollerar bytet i bakgrunden.',
  investigate: 'Det tidigare bytet kan ha nått nätägaren. Ärendet behöver utredas innan ett nytt försök.',
  refused: 'Bytet kan inte startas om automatiskt.',
}

/** The latest switch of each site, when it failed: the only ones "Försök igen" applies to (owner decision 32). */
export function failedSwitchesToRetry(rows: SwitchRow[]): SwitchRow[] {
  const latest = new Map<string, SwitchRow>()
  for (const row of rows) {
    const key = row.site_id ?? row.id
    const current = latest.get(key)
    if (!current || String(row.created_at ?? '') > String(current.created_at ?? '')) latest.set(key, row)
  }
  return [...latest.values()].filter((row) => row.status === 'failed')
}

export default function CustomerSwitchRetryPanel({ customerId, switchRequests, canRetry }: { customerId: string; switchRequests: SwitchRow[]; canRetry: boolean }) {
  const failed = failedSwitchesToRetry(switchRequests)
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Record<string, { outcome: string; reasons?: string[] }>>({})
  if (!canRetry || failed.length === 0) return null

  return (
    <section data-testid="customer-switch-retry" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-sm font-semibold text-slate-950">Leverantörsbytet misslyckades</p>
      <p className="mt-1 text-sm text-slate-700">Försök igen startar bytet genom automationen med det avtalade startdatumet.</p>
      {failed.map((row) => (
        <form
          key={row.id}
          className="mt-3 flex flex-wrap items-center gap-3"
          action={(formData) => startTransition(async () => {
            const outcome = await retryFailedSupplierSwitchAction(formData)
            setResult((prev) => ({ ...prev, [row.id]: { outcome: outcome.outcome, reasons: 'reasons' in outcome ? outcome.reasons : undefined } }))
          })}
        >
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="supplier_switch_request_id" value={row.id} />
          <span className="text-sm text-slate-700">{row.failure_reason ?? 'Orsak saknas'}{row.requested_start_date ? ` · start ${row.requested_start_date}` : ''}</span>
          <button
            type="submit"
            disabled={pending || Boolean(result[row.id])}
            className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-60"
          >
            Försök igen
          </button>
          {result[row.id] ? <span role="status" data-outcome={result[row.id].outcome} className="text-sm text-slate-800">{OUTCOME_TEXT[result[row.id].outcome] ?? result[row.id].outcome}</span> : null}
        </form>
      ))}
    </section>
  )
}
