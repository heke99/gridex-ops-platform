'use client'

import { useActionState } from 'react'
import {
  commitCustomerImportAction,
  previewCustomerImportAction,
} from '@/app/admin/customers/actions'
import {
  initialCustomerImportActionState,
  type CustomerImportActionState,
} from '@/app/admin/customers/actionState'

type CustomerBulkImportPanelProps = {
  example: string
}

function StateMessage({ state }: { state: CustomerImportActionState }) {
  if (!state.message) return null

  const tone = state.status === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-200'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200'

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${tone}`}>
      {state.message}
    </div>
  )
}

export default function CustomerBulkImportPanel({ example }: CustomerBulkImportPanelProps) {
  const [previewState, previewAction, previewPending] = useActionState(
    previewCustomerImportAction,
    initialCustomerImportActionState
  )
  const [commitState, commitAction, commitPending] = useActionState(
    commitCustomerImportAction,
    initialCustomerImportActionState
  )

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
        Bulkimport
      </h2>
      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
        Ladda upp CSV, Excel eller PDF-underlag, eller klistra in tabelltext. Förhandsgranska alltid underlaget innan du genomför importen.
      </p>

      <form className="mt-4 space-y-4" encType="multipart/form-data">
        <label className="grid gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium">Importfil</span>
          <input
            name="bulkFile"
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls,.pdf"
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <textarea
          name="bulkPayload"
          rows={18}
          defaultValue={example}
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            formAction={previewAction}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            disabled={previewPending || commitPending}
          >
            {previewPending ? 'Förhandsgranskar…' : 'Förhandsgranska underlag'}
          </button>
          <button
            formAction={commitAction}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
            disabled={previewPending || commitPending}
          >
            {commitPending ? 'Importerar…' : 'Importera kontrollerat underlag'}
          </button>
        </div>
      </form>

      <div className="mt-4 space-y-3">
        <StateMessage state={previewState} />
        <StateMessage state={commitState} />
      </div>

      {previewState.warnings.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="font-semibold">Varningar i underlaget</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {previewState.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {previewState.rows.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            Förhandsgranskning av de första {previewState.rows.length} raderna
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {previewState.rows.map((row) => (
              <div key={`${row.rowNumber}-${row.label}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="font-medium text-slate-500 dark:text-slate-400">Rad {row.rowNumber}</div>
                <div>
                  <div className="font-semibold text-slate-950 dark:text-white">{row.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{row.uniqueKey || 'Ingen unik nyckel'}</div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {row.warnings.length > 0 ? row.warnings.join(' · ') : 'Ser redo ut för import'}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
