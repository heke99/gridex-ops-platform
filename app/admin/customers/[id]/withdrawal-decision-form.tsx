'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { formatStatusLabel } from '@/lib/ui/format'

type WithdrawalUnderlay = {
  id: string
  year: number
  month: number
  start: string | null
  end: string | null
  hasInvoiceDraftDependency: boolean
  effect: 'hold' | 'existing_invoice' | 'review' | 'no_update'
}

export type ContractWithdrawalPreview = {
  receipt: string | null
  impact: {
    contract: { id: string; name: string; status: string }
    site: { id: string; name: string; facility: string | null }
    meter: { id: string; reference: string | null }
    requiresFollowUp: boolean
    underlays: WithdrawalUnderlay[]
  }
}

const effectLabels: Record<WithdrawalUnderlay['effect'], string> = {
  hold: 'Fakturering spärras',
  existing_invoice: 'Hanteras via befintlig faktura',
  review: 'Avtalskopplingen behöver granskas',
  no_update: 'Underlagsstatus ändras inte',
}

export function WithdrawalDecisionForm({
  customerId, intentId, defaultTarget, options, fields, previewAction, saveAction, fallbackAction,
}: {
  customerId: string
  intentId: string
  defaultTarget: string
  options: ReactNode
  fields: ReactNode
  previewAction: (customerId: string, contractId: string, intentId: string) => Promise<ContractWithdrawalPreview>
  saveAction: (formData: FormData) => Promise<string | null>
  fallbackAction: (formData: FormData) => Promise<void>
}) {
  const [target, setTarget] = useState(defaultTarget)
  const [preview, setPreview] = useState<ContractWithdrawalPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const currentRequest = useRef(0)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ message: string | null; intentId: string } | null>(null)
  const currentResult = result?.intentId === intentId ? result : null
  const saved = Boolean(currentResult && !currentResult.message)
  const isContract = target.startsWith('contract:')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setSaving(true)
    try {
      const message = await saveAction(data)
      setResult({ message, intentId })
      if (!message) form.reset()
    } catch {
      setResult({ message: 'Registreringen kunde inte bekräftas. Ladda om och kontrollera ärendet.', intentId })
    } finally {
      setPreview(null)
      setConfirmed(false)
      setSaving(false)
    }
  }

  function changeTarget(value: string) {
    currentRequest.current += 1
    setTarget(value)
    setResult(previous => previous?.message ? null : previous)
    setPreview(null)
    setPreviewError(null)
    setLoading(false)
    setConfirmed(false)
  }

  async function loadPreview() {
    const contractId = target.slice('contract:'.length)
    const request = ++currentRequest.current
    setLoading(true)
    setPreview(null)
    setPreviewError(null)
    setConfirmed(false)
    try {
      const loaded = await previewAction(customerId, contractId, intentId)
      if (request === currentRequest.current) setPreview(loaded)
    } catch {
      if (request === currentRequest.current) setPreviewError('Omfattningen kunde inte läsas. Kontrollera att avtalet, anläggningen och mätpunkten fortfarande hör ihop.')
    } finally {
      if (request === currentRequest.current) setLoading(false)
    }
  }

  return (
    <form action={fallbackAction} onSubmit={submit} className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5">
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="decision_type" value="withdrawal" />
      <input type="hidden" name="decision_intent_id" value={intentId} />
      <input type="hidden" name="block_billing" value="true" />
      {preview?.receipt ? <input type="hidden" name="withdrawal_impact_receipt" value={preview.receipt} /> : null}
      <h3 className="font-semibold text-slate-950">Registrera ånger</h3>
      <p className="mt-1 text-sm leading-6 text-slate-700">Använd när kunden uttryckligen använder sin ångerrätt.</p>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium text-slate-700">Gäller</span>
          <select name="scope_target" value={target} disabled={saving} onChange={event => changeTarget(event.target.value)}
            className="rounded-2xl border border-slate-300 bg-white px-4 py-3">
            {options}
          </select>
        </label>
        {isContract ? (
          <div className="grid gap-3">
            <button type="button" onClick={() => void loadPreview()} disabled={loading || saving}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50">
              {loading ? 'Läser omfattning …' : 'Förhandsvisa avtalsstopp'}
            </button>
            {previewError ? <p role="alert" className="text-sm text-amber-950">{previewError}</p> : null}
            {preview ? (
              <section aria-label="Avtalsstoppets omfattning" aria-live="polite" className="grid gap-2 rounded-2xl border border-slate-300 bg-white p-3 text-sm">
                <h4 className="font-semibold">{preview.impact.contract.name} · {formatStatusLabel(preview.impact.contract.status)}</h4>
                <p>Anläggning {preview.impact.site.name}{preview.impact.site.facility ? ` · ${preview.impact.site.facility}` : ''}</p>
                <p>Mätpunkt {preview.impact.meter.reference ?? preview.impact.meter.id}</p>
                <div>
                  <h5 className="font-semibold">Fakturaunderlag</h5>
                  {preview.impact.underlays.length === 0 ? <p>Inga fakturaunderlag är kopplade till avtalet.</p> : (
                    <ul className="grid gap-1">
                      {preview.impact.underlays.map(underlay => (
                        <li key={underlay.id} data-impact-id={underlay.id}>
                          <span>{underlay.start && underlay.end
                            ? `${underlay.start} – ${underlay.end}`
                            : `${underlay.year}-${String(underlay.month).padStart(2, '0')}`} · {effectLabels[underlay.effect]}</span>
                          <span className="block break-all text-xs text-slate-600">Underlag {underlay.id}</span>
                          {underlay.hasInvoiceDraftDependency ? <span className="block text-slate-700">Länkat till ett befintligt fakturautkast</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {preview.impact.requiresFollowUp
                  ? <p>Granska den anslutna leverantörsprocessen innan du registrerar avtalsstoppet.</p>
                  : <p>Ett ångerärende och en bekräftelseavsikt sparas när beslutet registreras.</p>}
              </section>
            ) : null}
          </div>
        ) : null}
        {fields}
        <label className="flex items-start gap-3 rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-700">
          <input type="checkbox" name="confirmed" value="true" required checked={confirmed}
            disabled={saving || (isContract && !preview?.receipt)} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
          <span>Jag bekräftar att kunden uttryckligen har ångrat avtalet och att relevanta flöden ska stoppas.</span>
        </label>
        {currentResult?.message ? <p role="alert" className="text-sm text-amber-950">{currentResult.message}</p> : null}
        {saved ? <p role="status" className="text-sm text-slate-700">Ångern har registrerats.</p> : null}
        <button type="submit" disabled={saving || (isContract && !preview?.receipt) || saved}
          className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          Registrera ånger
        </button>
      </div>
    </form>
  )
}
