'use client'

import { useState, type FormEvent } from 'react'

type SelectedValue = {
  normalizedValueId: string
  environment: 'test' | 'production'
  periodStart: string
  periodEnd: string
}

const endpoint = '/api/internal/billing/requalify-single-e66'
const fieldClass = 'min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2'
const buttonClass = 'min-h-11 rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50'

export default function MeteringRequalificationForm() {
  const [value, setValue] = useState<SelectedValue | null>(null)
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState(false)

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const query = new URLSearchParams()
    for (const key of ['point', 'from', 'until', 'environment']) {
      query.set(key, String(fields.get(key) ?? ''))
    }
    setPending(true)
    setValue(null)
    setStatus('')
    try {
      const response = await fetch(`${endpoint}?${query}`, { cache: 'no-store' })
      const result = await response.json()
      if (response.ok) setValue(result.data)
      else setStatus(result.error ?? 'Mätvärdet kunde inte läsas.')
    } catch {
      setStatus('Mätvärdet kunde inte läsas.')
    } finally {
      setPending(false)
    }
  }

  async function requalify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value) return
    setPending(true)
    setValue(null)
    setStatus('')
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ normalizedValueId: value.normalizedValueId, environment: value.environment }),
      })
      const result = await response.json()
      if (response.ok) {
        setStatus(result.data.replayed ? 'Omprövningen var redan sparad.' : 'Faktureringsgrinden omprövades för mätvärdet.')
      } else {
        setStatus(result.error ?? 'Mätvärdet kunde inte omprövas.')
      }
    } catch {
      setStatus('Det gick inte att bekräfta omprövningen. Sök upp mätvärdet igen för att kontrollera.')
    } finally {
      setPending(false)
    }
  }

  return <div className="space-y-3 text-sm">
    <form onSubmit={lookup} onChange={() => { setValue(null); setStatus('') }}>
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">Mätpunkt<input name="point" required maxLength={64} className={fieldClass} /></label>
        <label className="grid gap-1">Edielmiljö<select name="environment" required defaultValue="" className={fieldClass}>
          <option value="" disabled>Välj miljö</option>
          <option value="test">TEST</option>
          <option value="production">Produktion</option>
        </select></label>
        <label className="grid gap-1">Period från<input name="from" required maxLength={32} placeholder="2026-10-25T02:15:00+01:00" className={fieldClass} /></label>
        <label className="grid gap-1">Period till<input name="until" required maxLength={32} placeholder="2026-10-25T02:30:00+01:00" className={fieldClass} /></label>
        <p className="text-slate-700 sm:col-span-2">Ange exakt period med tidszon (UTC-offset).</p>
        <div><button className={buttonClass}>Kontrollera mätvärdet</button></div>
      </fieldset>
    </form>
    {value ? <form onSubmit={requalify} className="space-y-2">
      <p>Verifierad E66-källa · {value.environment === 'test' ? 'TEST' : 'Produktion'}</p>
      <p className="break-words"><time dateTime={value.periodStart}>{value.periodStart}</time>{' – '}<time dateTime={value.periodEnd}>{value.periodEnd}</time></p>
      <button disabled={pending} className={buttonClass}>Ompröva faktureringsgrinden</button>
    </form> : null}
    <p role="status" aria-live="polite">{pending ? 'Kontrollerar mätvärdet …' : status}</p>
  </div>
}
