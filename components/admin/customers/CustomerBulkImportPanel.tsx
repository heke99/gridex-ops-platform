'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import {
 commitCustomerImportAction,
 previewCustomerImportAction,
} from '@/app/admin/customers/actions'
import {
 initialCustomerImportActionState,
 type CustomerImportActionState,
 type CustomerImportPreviewRow,
 type CustomerImportPreviewRowStatus,
} from '@/app/admin/customers/actionState'

type ContractOfferOption = {
 id: string
 name: string
 campaign_name?: string | null
}

type CustomerBulkImportPanelProps = {
 example: string
 contractOffers: ContractOfferOption[]
}

function StateMessage({ state }: { state: CustomerImportActionState }) {
 if (!state.message) return null

 const tone = state.status === 'error'
 ? 'border-amber-200 bg-amber-50 text-amber-900 '
 : 'border-emerald-200 bg-emerald-50 text-emerald-800 '

 return (
 <div className={`rounded-2xl border px-4 py-3 text-sm ${tone}`}>
 <p>{state.message}</p>
 {state.totalRows > 0 ? (
 <p className="mt-2 text-xs">
 Totalt {state.totalRows} · Skapade {state.createdRows} · Granskning {state.reviewRows} · Fel {state.failedRows}
 </p>
 ) : null}
 </div>
 )
}

function statusLabel(status: CustomerImportPreviewRowStatus): string {
 switch (status) {
 case 'ready_to_create':
 return 'Redo att skapa'
 case 'requires_review':
 return 'Kräver granskning'
 case 'duplicate_warning':
 return 'Dubblettmisstanke'
 case 'missing_fields':
 return 'Saknar fält'
 case 'created':
 return 'Skapad'
 case 'rejected':
 return 'Avvisad'
 case 'failed':
 return 'Fel'
 default:
 return status
 }
}

function statusTone(status: CustomerImportPreviewRowStatus): string {
 switch (status) {
 case 'ready_to_create':
 return 'border-emerald-200 bg-emerald-50 text-emerald-800 '
 case 'duplicate_warning':
 return 'border-red-200 bg-red-50 text-red-800 '
 case 'missing_fields':
 case 'requires_review':
 return 'border-amber-200 bg-amber-50 text-amber-900 '
 default:
 return 'border-slate-200 bg-slate-50 text-slate-700 '
 }
}

export default function CustomerBulkImportPanel({ example, contractOffers }: CustomerBulkImportPanelProps) {
 const [previewState, previewAction, previewPending] = useActionState(
 previewCustomerImportAction,
 initialCustomerImportActionState
 )
 const [commitState, commitAction, commitPending] = useActionState(
 commitCustomerImportAction,
 initialCustomerImportActionState
 )

 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Bulkimport och PDF-intag
 </h2>
 <p className="mt-1 text-sm leading-6 text-slate-700 ">
 Ladda upp CSV, Excel eller PDF-underlag, eller klistra in tabelltext. Osäkra rader skapas inte direkt utan hamnar i granskningskön.
 </p>
 </div>
 <Link href="/admin/customers/imports" className="rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 ">
 Öppna granskningskö
 </Link>
 </div>

 <form className="mt-4 space-y-4" encType="multipart/form-data">
 <label className="grid gap-2 text-sm text-slate-700 ">
 <span className="font-medium">Importfil</span>
 <input
 name="bulkFile"
 type="file"
 accept=".csv,.txt,.tsv,.xlsx,.xls,.pdf"
 className="rounded-2xl border border-slate-300 px-4 py-3 text-sm "
 />
 </label>

 <div className="grid gap-3 md:grid-cols-2">
 <label className="grid gap-2 text-sm text-slate-700 ">
 <span className="font-medium">Fallback-avtal/kampanj</span>
 <select name="fallbackContractOfferId" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
 <option value="">Ingen fallback</option>
 {contractOffers.map((offer) => (
 <option key={offer.id} value={offer.id}>{offer.name}{offer.campaign_name ? ` · ${offer.campaign_name}` : ''}</option>
 ))}
 </select>
 </label>

 <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 <input name="applyFallbackContractToAll" type="checkbox" className="h-4 w-4" />
 <span>Använd valt avtal/kampanj för alla rader även om filen har kampanjfält</span>
 </label>
 </div>

 <label className="grid gap-2 text-sm text-slate-700 ">
 <span className="font-medium">Klistra in tabelltext</span>
 <textarea
 name="bulkPayload"
 rows={10}
 placeholder="Klistra in CSV/tabelltext här. Texten i sidhuvudet används inte längre som standardvärde."
 className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-xs "
 />
 </label>

 <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 <summary className="cursor-pointer font-semibold text-slate-800">Visa exempel på importformat</summary>
 <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 font-mono text-xs text-slate-700 ">{example}</pre>
 </details>

 <div className="grid gap-3 sm:grid-cols-2">
 <button
 formAction={previewAction}
 className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 "
 disabled={previewPending || commitPending}
 >
 {previewPending ? 'Förhandsgranskar…' : 'Förhandsgranska underlag'}
 </button>
 <button
 formAction={commitAction}
 className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 "
 disabled={previewPending || commitPending}
 >
 {commitPending ? 'Importerar…' : 'Importera endast godkända rader'}
 </button>
 </div>
 </form>

 <div className="mt-4 space-y-3">
 <StateMessage state={previewState} />
 <StateMessage state={commitState} />
 </div>

 {previewState.warnings.length > 0 ? (
 <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ">
 <div className="font-semibold">Varningar i underlaget</div>
 <ul className="mt-2 list-disc space-y-1 pl-5">
 {previewState.warnings.map((warning: string) => (
 <li key={warning}>{warning}</li>
 ))}
 </ul>
 </div>
 ) : null}

 {previewState.rows.length > 0 ? (
 <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 ">
 <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 ">
 Förhandsgranskning av de första {previewState.rows.length} raderna
 </div>
 <div className="divide-y divide-slate-200 ">
 {previewState.rows.map((row: CustomerImportPreviewRow) => (
 <div key={`${row.rowNumber}-${row.label}`} className="grid gap-3 px-4 py-3 text-sm xl:grid-cols-[80px_minmax(0,1fr)_160px_minmax(0,1.2fr)]">
 <div className="font-medium text-slate-700 ">Rad {row.rowNumber}</div>
 <div>
 <div className="font-semibold text-slate-950 ">{row.label}</div>
 <div className="text-xs text-slate-700 ">{row.uniqueKey || 'Ingen unik nyckel'}</div>
 </div>
 <div>
 <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
 {statusLabel(row.status)} · {row.confidence}%
 </span>
 </div>
 <div className="text-xs text-slate-700 ">
 {row.missingFields.length > 0 ? <p>Saknas: {row.missingFields.join(', ')}</p> : null}
 {row.uncertainFields.length > 0 ? <p>Osäkert: {row.uncertainFields.join(', ')}</p> : null}
 {row.duplicateWarnings.length > 0 ? <p>Dubblett: {row.duplicateWarnings.join(', ')}</p> : null}
 {row.warnings.length === 0 ? <p>Ser redo ut för import</p> : null}
 </div>
 </div>
 ))}
 </div>
 </div>
 ) : null}
 </section>
 )
}
