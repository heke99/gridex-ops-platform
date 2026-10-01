'use client'
import {useActionState} from 'react'
import {INVOICE_FILE_CATALOG} from '@/lib/ediel/retention/invoiceFiles.catalog'
import {invoiceFileRetentionAction} from './actions'
const labels={capture:'Arkivera faktisk PDF-källa',source:'Läs kopians arkivmetadata',basis:'Läs kopians källomfattning',submit:'Arkivera kopians juridiska beslut',read:'Läs beslutsstatus',review:'Registrera separat granskning',revoke:'Återkalla beslut',purge:'Gallra godkänd Storage-kopia'} as const
function Operation({kind,enabled}:{kind:keyof typeof labels;enabled:boolean}){
 const [state,action,pending]=useActionState(invoiceFileRetentionAction,{status:'idle',message:''})
 return <form action={action} className="grid min-w-0 gap-3 rounded-xl border p-4"><h2 className="font-semibold">{labels[kind]}</h2><input type="hidden" name="action" value={kind}/><fieldset disabled={!enabled||pending} className="grid min-w-0 gap-3">
  {['capture','basis','source','submit'].includes(kind)?<><label className="grid gap-1">Kopians klass<select name="retention_class" className="min-w-0 rounded border p-2">{INVOICE_FILE_CATALOG.map(row=><option key={row.retentionClass} value={row.retentionClass}>{row.label}</option>)}</select></label><label className="grid gap-1">Källpostens ID<input name="target_id" required maxLength={36} className="min-w-0 rounded border p-2"/></label></>:<label className="grid gap-1">Beslutets ID<input name="decision_id" required maxLength={36} className="min-w-0 rounded border p-2"/></label>}
  {kind==='submit'?<><label className="grid gap-1">Separat beslutsfil<input name="document" type="file" required className="max-w-full"/></label><label className="grid gap-1">Behörig utfärdares källbundna kvittens<textarea name="issuer_receipt" maxLength={32768} rows={4} className="min-w-0 rounded border p-2"/></label></>:null}
  {kind==='review'?<label className="grid gap-1">Utfall<select name="outcome" defaultValue="hold" className="rounded border p-2"><option value="hold">Håll spärrat</option><option value="approve">Godkänn denna särskilda prövning</option><option value="reject">Avvisa</option></select></label>:null}
  {kind==='review'||kind==='revoke'?<label className="grid gap-1">Motivering<textarea name="reason" required maxLength={4000} rows={3} className="min-w-0 rounded border p-2"/></label>:null}
  <button className="rounded border bg-slate-900 p-2 text-white focus-visible:outline focus-visible:outline-2">{labels[kind]}</button></fieldset><p role="status" className="break-words">{state.message}</p>{state.result?<pre className="max-w-full whitespace-pre-wrap break-all text-xs">{state.result}</pre>:null}
 </form>
}
export function InvoiceFileWorkspace({permissions}:{permissions:readonly string[]}){
 const classGranted=permissions.includes('ediel.retention.invoice_copy_evidence')
 return <div className="grid min-w-0 max-w-full gap-4 md:grid-cols-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(kind=><Operation key={kind} kind={kind} enabled={classGranted&&(['basis','read','source'].includes(kind)?permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review'):permissions.includes(kind==='capture'||kind==='submit'?'ediel.retention.submit':kind==='purge'?'ediel.retention.purge':'ediel.retention.review'))}/>)}</div>
}
