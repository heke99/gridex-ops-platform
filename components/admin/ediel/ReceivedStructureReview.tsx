'use client'

import {useId,useState,useTransition} from 'react'
import {reviewReceivedStructureAction} from '@/app/admin/ediel/structure-actions'

export default function ReceivedStructureReview({companyId,sourceMessageId,environment}:{companyId:string;sourceMessageId:string;environment:'test'|'production'}){
  const prefix=useId()
  const [pending,startTransition]=useTransition()
  const [result,setResult]=useState<{accepted:boolean;message:string;assessmentId?:string}|null>(null)
  return <section aria-labelledby={`${prefix}-title`} className="rounded-3xl border border-slate-200 bg-white p-6">
    <h2 id={`${prefix}-title`} className="text-lg font-semibold text-slate-900">Godkänn hela strukturunderlaget</h2>
    <p className="mt-2 text-sm text-slate-700">Granska originalmeddelandet nedan. Åtgärden är separat från att tillämpa enstaka masterdatafält. Systemet verifierar originalkälla, samtliga objekt, parter och daterad leveransperiod. Den skickar ingen marknadskvittens.</p>
    <form className="mt-4 space-y-4" onSubmit={event=>{
      event.preventDefault()
      const form=new FormData(event.currentTarget)
      startTransition(async()=>{
        setResult(null)
        try{setResult(await reviewReceivedStructureAction(form))}
        catch{setResult({accepted:false,message:'Granskningen kunde inte sparas. Kontrollera din behörighet för detta bolag och försök igen.'})}
      })
    }}>
      <input type="hidden" name="companyId" value={companyId}/>
      <input type="hidden" name="sourceMessageId" value={sourceMessageId}/>
      <input type="hidden" name="environment" value={environment}/>
      <div>
        <label htmlFor={`${prefix}-replacement`} className="block text-sm font-medium text-slate-800">Tidigare källmeddelandes interna ID, endast vid ersättning</label>
        <input id={`${prefix}-replacement`} name="replacesSourceMessageId" maxLength={36} autoComplete="off" spellCheck={false}
          aria-describedby={`${prefix}-replacement-help`} disabled={pending}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"/>
        <p id={`${prefix}-replacement-help`} className="mt-1 text-xs text-slate-600">Krävs för BGM-funktion 5. Ange exakt tidigare meddelandes UUID, inte ärendereferensen. Systemet kräver ett godkänt underlag i samma bolag, ärende och leveransperiod.</p>
      </div>
      <label className="flex items-start gap-3 text-sm text-slate-800">
        <input type="checkbox" name="confirmedOriginal" required disabled={pending} className="mt-1 h-4 w-4"/>
        <span>Jag har granskat hela originalmeddelandet, inklusive ändringsorsak, giltighetsdatum, mätare och samtliga register.</span>
      </label>
      <button type="submit" disabled={pending} aria-busy={pending}
        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
        {pending?'Verifierar underlaget…':'Verifiera och spara källgodkännande'}
      </button>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-slate-700">
        {result?<><p>{result.message}</p>{result.assessmentId?<p className="mt-1 break-all font-mono text-xs">Bedömning: {result.assessmentId}</p>:null}</>:null}
      </div>
    </form>
  </section>
}
