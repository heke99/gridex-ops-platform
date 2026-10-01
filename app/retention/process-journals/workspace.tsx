'use client'
import { useActionState } from 'react'
import { processJournalRetentionAction } from './actions'
function Selector(){return <><label className="grid gap-1">Journalens klass<select name="retention_class" className="rounded border p-2"><option value="correction_process_fact_body">Prospektiv processfaktakopia</option><option value="correction_process_readset_body">Sparad processläsning</option><option value="correction_process_combined_readset_body">Sparad kombinerad läsning</option></select></label><label className="grid gap-1">Källpostens id<input name="target_id" required maxLength={36} className="min-w-0 rounded border p-2"/></label></>}
function Operation({kind,enabled}:{kind:'basis'|'submit'|'read'|'review'|'revoke'|'purge';enabled:boolean}){
 const [state,action,pending]=useActionState(processJournalRetentionAction,{status:'idle',message:''})
 const label={basis:'Pröva journalens källomfattning',submit:'Arkivera klassens beslutsfil',read:'Läs arkiverad beslutsfil',review:'Registrera separat granskning',revoke:'Återkalla beslutsbehörighet',purge:'Gallra den godkända journalens kropp'}[kind]
 return <form action={action} className="grid min-w-0 gap-3 rounded-xl border p-4"><h2 className="font-semibold">{label}</h2><input type="hidden" name="action" value={kind}/><fieldset disabled={!enabled||pending} className="grid min-w-0 gap-3">
  {kind==='basis'||kind==='submit'?<Selector/>:<label className="grid gap-1">Beslutets id<input name="decision_id" required maxLength={36} className="min-w-0 rounded border p-2"/></label>}
  {kind==='submit'?<><label className="grid gap-1">Separat beslutsfil<input name="document" type="file" required className="max-w-full"/></label><label className="grid gap-1">Behörig utfärdares källbundna kvittens<textarea name="issuer_receipt" maxLength={32768} rows={4} className="min-w-0 rounded border p-2"/></label></>:null}
  {kind==='review'?<label className="grid gap-1">Utfall<select name="outcome" defaultValue="hold" className="rounded border p-2"><option value="hold">Håll spärrat</option><option value="approve">Godkänn källans särskilda prövning</option><option value="reject">Avvisa underlaget</option></select></label>:null}
  {kind==='review'||kind==='revoke'?<label className="grid gap-1">Motivering<textarea name="reason" required maxLength={4000} rows={3} className="min-w-0 rounded border p-2"/></label>:null}
  <button className="rounded border bg-slate-900 p-2 text-white">{label}</button></fieldset>
  <p role="status" className="break-words">{state.message}</p>{state.decisionId?<p className="break-all">Beslut: {state.decisionId}</p>:null}
  {state.basis?<pre className="max-w-full whitespace-pre-wrap break-all text-xs">{state.basis}</pre>:null}
  {state.documentBase64?<a href={`data:application/octet-stream;base64,${state.documentBase64}`} download={`journal-policy-${state.documentHash}.bin`} className="underline">Hämta den arkiverade beslutsfilen</a>:null}
 </form>
}
export function ProcessJournalWorkspace({permissions}:{permissions:readonly string[]}){
 const classGranted=permissions.includes('ediel.retention.legal_history'),canRead=classGranted&&permissions.some(p=>p==='ediel.retention.read'||p==='ediel.retention.review')
 return <div className="grid min-w-0 max-w-full gap-4 md:grid-cols-2">{(['basis','submit','read','review','revoke','purge'] as const).map(kind=><Operation key={kind} kind={kind} enabled={kind==='basis'||kind==='read'?canRead:classGranted&&permissions.includes(kind==='submit'?'ediel.retention.submit':kind==='purge'?'ediel.retention.purge':'ediel.retention.review')}/>)}</div>
}
