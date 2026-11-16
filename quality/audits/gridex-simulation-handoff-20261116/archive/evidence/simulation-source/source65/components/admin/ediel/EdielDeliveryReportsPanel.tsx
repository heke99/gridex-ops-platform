'use client'
import {useState} from 'react'
import type {DsnObservationProjection} from '@/lib/inbound-mail/dsnSourceObservations'
export default function EdielDeliveryReportsPanel({messageId}:{messageId:string}){
  const [reports,setReports]=useState<DsnObservationProjection['observations']|null>(null)
  const [loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null)
  async function load(){
    setLoading(true);setError(null)
    try{
      const response=await fetch(`/api/ediel/messages/${messageId}/delivery-reports`,{cache:'no-store',credentials:'same-origin'})
      const result=await response.json()
      if(!response.ok)throw new Error(result.error ?? 'Leveransrapporter kunde inte läsas.')
      setReports(result.observations)
    }catch(cause){setError(cause instanceof Error?cause.message:'Leveransrapporter kunde inte läsas.');setReports(null)}
    finally{setLoading(false)}
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-6">
    <h2 className="text-lg font-semibold text-slate-900">Leveransrapporter</h2>
    <p className="mt-2 text-sm text-slate-600">Rapporter som matchar transportförsökets mottagare och originalidentitet. Avsändarens autenticitet återstår att styrka. Rapporten utlöser ingen omsändning.</p>
    <button type="button" disabled={loading} onClick={load} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{loading?'Läser leveransrapporter…':'Visa leveransrapporter'}</button>
    {error?<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>:null}
    {reports?.length===0?<p className="mt-3 text-sm text-slate-600">Inga matchade leveransrapporter har registrerats.</p>:null}
    {reports?.length?<ul className="mt-4 space-y-3">{reports.map(report=><li key={report.observationId} className="rounded-xl border border-slate-200 p-3 text-sm">
      <div>Mottagare: {report.recipient.finalRecipient?.address ?? 'Saknas'}</div>
      <div>Rapporterad åtgärd: {report.recipient.action ?? 'Saknas'}</div>
      <div>Rapporterad status: {report.recipient.status ?? 'Saknas'}</div>
      {report.recipient.diagnosticCode?<p className="mt-1 break-words">Diagnos: {report.recipient.diagnosticCode.type}; {report.recipient.diagnosticCode.text}</p>:null}
      <div>Registrerad: {report.observedAt}</div>
    </li>)}</ul>:null}
  </section>
}
