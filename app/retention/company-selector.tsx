'use client'
import {useActionState} from 'react'
import {selectRetentionCompany,type RetentionSelectionState} from './actions'
export default function RetentionCompanySelector({companies,selected}:{companies:Array<{companyId:string;name:string;status:string}>;selected:string|null}){
 const initial:RetentionSelectionState={message:''},[state,action,pending]=useActionState(selectRetentionCompany,initial)
 return <form action={action} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto]"><label className="min-w-0 break-words">Eget bolag för gallring<select aria-label="Eget bolag för gallring" name="company_id" required defaultValue={selected??''} className="block w-full min-w-0 max-w-full rounded border p-2"><option value="">Välj bolag</option>{companies.map(c=><option key={c.companyId} value={c.companyId}>{c.name} · {c.status==='archived'?'Arkiverat':c.status==='pending_deletion'?'Avveckling pågår':c.status==='closed'?'Stängt':'Aktivt'}</option>)}</select></label><button disabled={pending||companies.length===0} className="self-end rounded bg-slate-950 px-4 py-2 text-white disabled:opacity-50">Välj eget bolag</button>{state.message?<p role="status" className="text-sm sm:col-span-2">{state.message}</p>:null}</form>
}
