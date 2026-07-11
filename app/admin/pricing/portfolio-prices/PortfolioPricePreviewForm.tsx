'use client'

import { useActionState } from 'react'
import { previewPortfolioPriceAction, type PortfolioPricePreviewState } from './actions'

const INITIAL_STATE: PortfolioPricePreviewState = { status: 'idle' }

function money(value: number | undefined): string {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 2 }).format(value ?? 0)
}

export default function PortfolioPricePreviewForm({ defaultPrice = '' }: { defaultPrice?: string }) {
  const [state, action, pending] = useActionState(previewPortfolioPriceAction, INITIAL_STATE)

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Förhandskalkyl</p>
      <h2 className="mt-2 text-lg font-semibold text-slate-950">Testa portföljpriset med samma prismotor</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Kalkylen kör samma baspris-, avgifts-, moms- och avrundningskomponenter som faktureringsmotorn. Årsvolymen fördelas jämnt över tolv månader i förhandsvisningen.
      </p>
      <form action={action} className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm"><span>Årsförbrukning kWh</span><input name="annual_kwh" defaultValue="10000" inputMode="decimal" required className="h-11 rounded-2xl border border-slate-300 px-4" /></label>
        <label className="grid gap-1 text-sm"><span>Portföljpris kr/kWh ex moms</span><input name="portfolio_price" defaultValue={defaultPrice} inputMode="decimal" required className="h-11 rounded-2xl border border-slate-300 px-4" /></label>
        <label className="grid gap-1 text-sm"><span>Påslag öre/kWh</span><input name="markup_ore" defaultValue="0" inputMode="decimal" className="h-11 rounded-2xl border border-slate-300 px-4" /></label>
        <label className="grid gap-1 text-sm"><span>Månadsavgift kr</span><input name="monthly_fee" defaultValue="0" inputMode="decimal" className="h-11 rounded-2xl border border-slate-300 px-4" /></label>
        <button disabled={pending} className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2">
          {pending ? 'Beräknar…' : 'Beräkna med prismotorn'}
        </button>
      </form>

      {state.status === 'error' ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{state.message}</p> : null}
      {state.status === 'success' ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-600">Volym/månad</p><p className="mt-1 font-semibold">{state.monthlyKwh?.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} kWh</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-600">Månad ex moms</p><p className="mt-1 font-semibold">{money(state.monthlyExVat)}</p></div>
            <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-600">Månad inkl. moms</p><p className="mt-1 font-semibold">{money(state.monthlyIncVat)}</p></div>
            <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-xs text-emerald-800">År inkl. moms</p><p className="mt-1 font-semibold text-emerald-950">{money(state.annualIncVat)}</p></div>
          </div>
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            {(state.lines ?? []).map((line, index) => (
              <div key={`${line.description}-${index}`} className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
                <span className="text-slate-700">{line.description}</span>
                <span className="font-semibold text-slate-950">{money(line.amountIncVat)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
