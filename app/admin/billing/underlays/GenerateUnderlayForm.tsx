'use client'

import { useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { saveUnderlayIntent, type UnderlayClientScope } from '@/lib/billing/underlayGenerationClient'
import { hasPendingUnderlayHistoryQualification, parseUnderlayGenerationResult } from '@/lib/billing/underlayGenerationResult'

type Props = Omit<UnderlayClientScope, 'billingMonth'> & { initialMonth: string }
type Saved = { key: string; data: ReturnType<typeof parseUnderlayGenerationResult> }

export default function GenerateUnderlayForm({ companyId, actorUserId, initialMonth }: Props) {
  const router = useRouter()
  const [billingMonth, setBillingMonth] = useState(initialMonth)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  async function generate(completedKey?: string) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setSaved(null)
    setError(null)
    try {
      const location = new URL(window.location.href)
      location.searchParams.set('billing_month', billingMonth)
      window.history.replaceState(window.history.state, '', location)
      let key
      try {
        key = await saveUnderlayIntent({ companyId, actorUserId, billingMonth }, completedKey)
      } catch {
        setError('Begäran kunde inte sparas i webbläsaren. Inget anrop gjordes.')
        return
      }
      const response = await fetch('/api/internal/billing/generate-underlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({
          billing_month: billingMonth,
          expected_company_id: companyId,
          expected_actor_user_id: actorUserId,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        if (response.status === 409 && body?.code === 'billing_underlay_client_scope_changed') {
          setError('Inloggningen eller valt bolag har ändrats. Ladda om sidan.')
          return
        }
        if (response.status === 410 && body?.code === 'billing_underlay_receipt_retained') {
          setError('Underlagskvittot kan inte längre visas efter gallring.')
          return
        }
        if (response.status === 401 || response.status === 403) {
          setError('Du saknar åtkomst till körningen. Kontrollera din inloggning och behörighet.')
          return
        }
        throw new Error('underlay_client_receipt_unconfirmed')
      }
      const data = parseUnderlayGenerationResult(body?.data, {
        billingMonth, scope: { customerId: null, meteringPointId: null },
      })
      setSaved({ key, data })
      router.refresh()
    } catch {
      setError('Inget underlagskvitto kunde bekräftas. Försök igen med samma fakturamånad.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!saved) void generate()
  }

  const historyNeeds = saved?.data.results.filter(hasPendingUnderlayHistoryQualification).length ?? 0

  return (
    <section className="rounded-3xl border bg-white p-5 shadow-sm" aria-labelledby="generate-underlay-heading">
      <h2 id="generate-underlay-heading" className="font-semibold text-slate-950">Skapa faktureringsunderlag</h2>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">
          Fakturamånad
          <input type="month" name="billing_month" value={billingMonth} min="2000-01" max="2200-12" required disabled={pending}
            onChange={event => { setBillingMonth(event.target.value); setSaved(null); setError(null) }}
            className="rounded-xl border border-slate-300 px-3 py-2" />
        </label>
        {saved ? (
          <button type="button" onClick={() => void generate(saved.key)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Starta ny körning</button>
        ) : (
          <button type="submit" disabled={pending} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? 'Hämtar underlagskvitto…' : 'Skapa underlag'}
          </button>
        )}
      </form>
      {error ? <p role="alert" className="mt-3 text-sm text-rose-900">{error}</p> : null}
      {saved ? (
        <div role="status" className="mt-3 space-y-2 text-sm">
          <p>Kvitto för {saved.data.billingMonth}. {saved.data.readyForPricing} klara för pris och {saved.data.needsReview} behöver granskas.</p>
          {historyNeeds > 0 ? (
            <p className="text-amber-900">
              Mätvärdeshistorik behöver kontrolleras för {historyNeeds} {historyNeeds === 1 ? 'post' : 'poster'}.
              {' '}Kontrollera period, driftmiljö och aktuellt VH-uppdrag före beställning.
            </p>
          ) : null}
          {saved.data.results.some(row => row.underlayId) ? (
            <ul className="space-y-1">
              {saved.data.results.map(row => row.underlayId ? (
                <li key={row.underlayId}>
                  <Link href={`/admin/billing/underlays/${encodeURIComponent(row.underlayId)}`} className="underline">
                    Öppna underlag {row.underlayId}
                  </Link>
                </li>
              ) : null)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
