'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'

type Mode = 'reply' | 'internal' | 'phone'

type Props = {
  caseId: string
  companyId: string
  replyAction: (formData: FormData) => Promise<void>
  internalNoteAction: (formData: FormData) => Promise<void>
  phoneAction: (formData: FormData) => Promise<void>
  verificationMethods: Array<{ value: string; label: string }>
}

const MODES: Array<{ value: Mode; label: string; hint: string }> = [
  { value: 'reply', label: 'Svara kunden', hint: 'Syns för kunden på Mina sidor.' },
  { value: 'internal', label: 'Intern anteckning', hint: 'Syns aldrig för kunden.' },
  { value: 'phone', label: 'Registrera samtal', hint: 'Loggas internt. Sammanfattningen skickas inte automatiskt.' },
]

function SubmitButton({ label }: { label: string }) {
  // Pending state blocks double submits and announces progress.
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-60"
    >
      {pending ? 'Sparar…' : label}
    </button>
  )
}

const fieldClass = 'rounded-xl border border-slate-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600'

export default function SupportCaseComposer(props: Props) {
  const [mode, setMode] = useState<Mode>('reply')
  const active = MODES.find((item) => item.value === mode) ?? MODES[0]
  const action = mode === 'reply' ? props.replyAction : mode === 'internal' ? props.internalNoteAction : props.phoneAction

  return (
    <section aria-labelledby="composer-heading" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="composer-heading" className="text-lg font-semibold text-slate-950">Hantera ärendet</h2>
      <fieldset className="mt-4">
        <legend className="sr-only">Välj typ av inlägg</legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {MODES.map((item) => (
            <label
              key={item.value}
              className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-sky-600 ${
                mode === item.value
                  ? item.value === 'internal'
                    ? 'border-amber-500 bg-amber-50 text-amber-900'
                    : 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-300 bg-white text-slate-700'
              }`}
            >
              <input
                type="radio"
                name="composer-mode"
                value={item.value}
                checked={mode === item.value}
                onChange={() => setMode(item.value)}
                className="sr-only"
              />
              {item.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm text-slate-600" aria-live="polite">{active.hint}</p>
      </fieldset>

      <form key={mode} action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="case_id" value={props.caseId} />
        <input type="hidden" name="expected_company_id" value={props.companyId} />

        {mode === 'phone' ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-slate-700">Riktning</span>
                <select name="direction" defaultValue="inbound" className={fieldClass}>
                  <option value="inbound">Kunden ringde</option>
                  <option value="outbound">Vi ringde kunden</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-slate-700">Hur identifierades kunden?</span>
                <select name="verification_method" required defaultValue="" className={fieldClass}>
                  <option value="" disabled>Välj</option>
                  {props.verificationMethods.map((method) => (
                    <option key={method.value} value={method.value}>{method.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-slate-700">Verifieringsreferens (valfri)</span>
                <input name="verification_reference" maxLength={120} className={fieldClass} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-slate-700">Ombud (om någon annan ringer)</span>
                <input name="representative_name" maxLength={160} className={fieldClass} />
              </label>
              <label className="grid gap-1 text-sm md:col-span-2">
                <span className="text-slate-700">Fullmakt/mandat-referens för ombud</span>
                <input name="representative_mandate_reference" maxLength={120} className={fieldClass} />
              </label>
            </div>
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              Kundnummer, personnummer, uppringande nummer eller e-post räcker inte som verifiering. Fråga aldrig efter lösenord eller engångskoder.
            </p>
            <label className="grid gap-1 text-sm">
              <span className="text-slate-700">Samtalsanteckning (intern)</span>
              <textarea name="summary" required rows={4} maxLength={8000} className={fieldClass} />
            </label>
            <SubmitButton label="Spara samtal" />
          </>
        ) : (
          <>
            {mode === 'reply' ? (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="kind" value="phone_summary" />
                Markera som sammanfattning av telefonsamtal
              </label>
            ) : null}
            <label className="grid gap-1 text-sm">
              <span className="text-slate-700">{mode === 'reply' ? 'Svar till kunden' : 'Intern anteckning'}</span>
              <textarea name="message" required rows={4} maxLength={8000} className={fieldClass} />
            </label>
            <SubmitButton label={mode === 'reply' ? 'Skicka svar till kunden' : 'Spara intern anteckning'} />
          </>
        )}
      </form>
    </section>
  )
}
