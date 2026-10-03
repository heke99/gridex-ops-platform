'use client'
import {useRef,useState,type FormEvent} from 'react'
import type {BlobRetentionDecision} from '@/lib/ediel/retention/blobRetentionHttp'

const inputClass='block w-full rounded border border-slate-400 bg-white p-2 text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600'
const buttonClass='rounded bg-blue-700 px-4 py-2 text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50'
const statusLabel:Record<string,string>={submitted:'Beslutet är arkiverat',approved:'Granskningen är godkänd',held:'Beslutet är pausat',rejected:'Granskningen är avvisad',revoked:'Beslutet är återkallat',purged:'Rensningen är genomförd',storage_purge_pending:'Storage-rensningen väntar på slutförande'}
async function documentBase64(file:File){
 if(file.size<1||file.size>1048576)throw Error('Välj ett beslutsdokument mellan 1 byte och 1 MiB.')
 const bytes=new Uint8Array(await file.arrayBuffer()),parts:string[]=[]
 for(let offset=0;offset<bytes.length;offset+=8192)parts.push(String.fromCharCode(...bytes.subarray(offset,offset+8192)))
 return btoa(parts.join(''))
}
export default function MessageContentRetentionWorkspace({companyId,permissions}:{companyId:string;permissions:string[]}){
 const [busy,setBusy]=useState(false),[decisionId,setDecisionId]=useState(''),[record,setRecord]=useState<BlobRetentionDecision|null>(null),[receipt,setReceipt]=useState<Record<string,unknown>|null>(null),[error,setError]=useState('')
 const errorRef=useRef<HTMLParagraphElement>(null)
 const can=(key:string)=>permissions.includes(key)
 async function call(path:string,body?:unknown){
  const response=await fetch(`/api/ediel/message-content-retention${path}`,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin',cache:'no-store'})
  const data=await response.json() as Record<string,unknown>
  if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Begäran misslyckades. Kontrollera bolag, behörigheter och beslutskälla.')
  return data
 }
 async function perform(action:()=>Promise<void>){setBusy(true);setError('');try{await action()}catch(e){setError(e instanceof Error?e.message:'Begäran misslyckades. Försök igen.');queueMicrotask(()=>errorRef.current?.focus())}finally{setBusy(false)}}
 async function refresh(id:string){setRecord(await call(`/${encodeURIComponent(id)}`) as BlobRetentionDecision);setDecisionId(id)}
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const form=new FormData(event.currentTarget)
  await perform(async()=>{const file=form.get('document');if(!(file instanceof File))throw Error('Välj beslutsdokumentet.')
   const raw=String(form.get('issuerReceipt')??'').trim(),issuerReceipt=raw?JSON.parse(raw):null
   const data=await call('',{retentionClass:form.get('retentionClass'),targetId:form.get('targetId'),documentBase64:await documentBase64(file),issuerReceipt})
   setReceipt(data);await refresh(String(data.decisionId))
  })
 }
 async function review(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await perform(async()=>{const data=await call(`/${record!.decisionId}/review`,{outcome:form.get('outcome'),reason:form.get('reason')});setReceipt(data);await refresh(record!.decisionId)})}
 async function revoke(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);await perform(async()=>{setReceipt(await call(`/${record!.decisionId}/revoke`,{reason:form.get('reason')}));await refresh(record!.decisionId)})}
 async function purge(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);if(form.get('confirm')!=='yes'){setError('Bekräfta rensningen av det valda innehållet.');errorRef.current?.focus();return}await perform(async()=>{setReceipt(await call(`/${record!.decisionId}/purge`,{}));await refresh(record!.decisionId)})}
 return <div className="space-y-8">
  <p>Valt bolag: <span className="break-all" translate="no">{companyId}</span></p>
  <p ref={errorRef} tabIndex={-1} role={error?'alert':undefined} className="text-red-700">{error}</p>
  {can('ediel.retention.submit')?<section aria-labelledby="archive-heading"><h2 id="archive-heading" className="text-xl font-semibold">Arkivera rättsligt beslut</h2><form onSubmit={submit} className="space-y-4">
   <label className="block">Innehållsklass<select aria-label="Innehållsklass" name="retentionClass" required className={inputClass}>{can('ediel.retention.original_bytes')?<option value="received_ediel_message_content">Mottaget original och operativa innehållskopior</option>:null}{can('ediel.retention.mime_bytes')?<option value="transport_raw_mime_bytes">Arkiverade transport-MIME-bytes</option>:null}</select></label>
   <label className="block">Meddelande-ID eller MIME-arkivets payload-ID<input aria-label="Meddelande-ID eller MIME-arkivets payload-ID" name="targetId" required autoComplete="off" spellCheck={false} className={inputClass}/></label>
   <label className="block">Beslutsdokument (högst 1 MiB)<input aria-label="Beslutsdokument (högst 1 MiB)" name="document" type="file" required className={inputClass}/></label>
   <label className="block">Utfärdarens autentiserade kvitto (JSON)<textarea aria-label="Utfärdarens autentiserade kvitto (JSON)" name="issuerReceipt" rows={5} autoComplete="off" spellCheck={false} className={inputClass}/></label>
   <p>Utan kvalificerad utfärdarkälla eller separat granskning förblir beslutet pausat.</p><button disabled={busy} className={buttonClass}>{busy?'Arbetar…':'Arkivera beslut'}</button>
  </form></section>:null}
  <section aria-labelledby="read-heading"><h2 id="read-heading" className="text-xl font-semibold">Läs beslut och kvitton</h2><form onSubmit={e=>{e.preventDefault();void perform(()=>refresh(decisionId))}} className="space-y-3"><label className="block">Besluts-ID<input aria-label="Besluts-ID" name="decisionId" value={decisionId} onChange={e=>setDecisionId(e.target.value)} required autoComplete="off" spellCheck={false} className={inputClass}/></label><button disabled={busy} className={buttonClass}>Läs beslut</button></form></section>
  {record?<section aria-labelledby="decision-heading" className="space-y-4"><h2 id="decision-heading" className="text-xl font-semibold">Beslutets faktiska underlag</h2><dl className="grid grid-cols-1 gap-2 break-all sm:grid-cols-[auto_minmax(0,1fr)]"><dt>Klass</dt><dd translate="no">{record.retentionClass}</dd><dt>Källhash</dt><dd translate="no">{record.sourceHash}</dd><dt>Målhash</dt><dd translate="no">{record.targetHash}</dd><dt>Beslutshash</dt><dd translate="no">{record.documentHash}</dd><dt>Aktuell rensningskvalifikation</dt><dd>{record.currentQualified?'Kvalificerad':'Pausad'}</dd><dt>Utfärdarkvitto</dt><dd>{record.issuerQualified?'Kvalificerat':'Ej kvalificerat'}</dd><dt>Återkallat</dt><dd>{record.revoked?'Ja':'Nej'}</dd><dt>Rensningskvitto</dt><dd>{record.purge?(record.purge.physicalBytesRemoved?'Fysiska bytes borttagna':'Storage-rensning väntar'):'Inget rensningskvitto'}</dd></dl>
   {can('ediel.retention.review')?<><a href={`/api/ediel/message-content-retention/${record.decisionId}/document`} className="text-blue-700 underline focus-visible:outline focus-visible:outline-2">Läs arkiverat beslutsdokument</a><form onSubmit={review} className="space-y-3"><label className="block">Bedömning<select aria-label="Bedömning" name="outcome" className={inputClass}><option value="hold">Pausa</option><option value="approve">Godkänn</option><option value="reject">Avvisa</option></select></label><label className="block">Granskningsskäl<textarea aria-label="Granskningsskäl" name="reason" required maxLength={4000} className={inputClass}/></label><button disabled={busy} className={buttonClass}>Registrera separat granskning</button></form><form onSubmit={revoke} className="space-y-3"><label className="block">Skäl för återkallelse<textarea aria-label="Skäl för återkallelse" name="reason" required maxLength={4000} className={inputClass}/></label><button disabled={busy} className={buttonClass}>Återkalla beslut</button></form></>:null}
   {can('ediel.retention.purge')?<form onSubmit={purge} className="space-y-3"><p>Rensningen tar bort klassens valda bytes. Identiteter, hashar och historiska kvitton bevaras. MIME-rensning slutförs först efter faktisk Storage-borttagning och återläsning.</p><label className="flex items-start gap-2"><input name="confirm" type="checkbox" value="yes" required/>Jag bekräftar rensning av detta beslut och innehåll.</label><button disabled={busy||(!record.currentQualified&&!record.purge)} className={buttonClass}>Genomför eller återuppta rensning</button></form>:null}
   <h3 className="font-semibold">Granskningshistorik</h3>{record.reviews.length?<ul className="space-y-2">{record.reviews.map(r=><li key={r.reviewId} className="break-words">{statusLabel[r.outcome]} — {r.reason}</li>)}</ul>:<p>Ingen granskning registrerad.</p>}
  </section>:null}
  <div aria-live="polite">{receipt?<p>{statusLabel[String(receipt.status)]??'Kvitto mottaget'}{receipt.issuerQualified===false?' — utfärdarkällan är ännu ej kvalificerad.':''}</p>:null}</div>
 </div>
}
