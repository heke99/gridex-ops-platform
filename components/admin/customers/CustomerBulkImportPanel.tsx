'use client'

import { useActionState } from 'react'
import {
  commitCustomerImportAction,
  previewCustomerImportAction,
} from '@/app/admin/customers/actions'
import {
  initialCustomerImportCommitState,
  initialCustomerImportPreviewState,
} from '@/app/admin/customers/actionState'
import type { CustomerImportPreview } from '@/lib/customers/importParser'

type CompanyOption = {
  id: string
  name: string
}

type Props = {
  bulkExample: string
  companies: CompanyOption[]
  selectedCompanyId: string | null
  isPlatformAdmin: boolean
}

function issueTone(severity: string) {
  if (severity === 'error') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-blue-200 bg-blue-50 text-blue-800'
}

function sourceLabel(sourceKind: CustomerImportPreview['sourceKind']) {
  switch (sourceKind) {
    case 'pdf':
      return 'PDF'
    case 'excel':
      return 'Excel'
    case 'csv':
      return 'CSV'
    default:
      return 'Text'
  }
}

function CompanyField({
  companies,
  selectedCompanyId,
  isPlatformAdmin,
}: Pick<Props, 'companies' | 'selectedCompanyId' | 'isPlatformAdmin'>) {
  if (!isPlatformAdmin) {
    return <input type="hidden" name="companyId" value={selectedCompanyId ?? ''} />
  }

  return (
    <label className="grid gap-1 text-sm">
      <span className="text-slate-600 dark:text-slate-300">Företag</span>
      <select
        name="companyId"
        defaultValue={selectedCompanyId ?? ''}
        required
        className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
      >
        <option value="">Välj företag</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </label>
  )
}

export default function CustomerBulkImportPanel({
  bulkExample,
  companies,
  selectedCompanyId,
  isPlatformAdmin,
}: Props) {
  const [previewState, previewAction, previewPending] = useActionState(
    previewCustomerImportAction,
    initialCustomerImportPreviewState
  )
  const [commitState, commitAction, commitPending] = useActionState(
    commitCustomerImportAction,
    initialCustomerImportCommitState
  )

  const preview = previewState.preview
  const hasBlockingIssues = Boolean(
    preview?.issues.some((issue) => issue.severity === 'error')
  )

  return (
    <section className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-sm shadow-emerald-950/5">
      <div className="flex flex-col gap-2 border-b border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-white p-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Import
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
            Importera kundunderlag
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Läs in CSV, semikolonseparerad text eller PDF-underlag. Importen visar möjliga fel och dubbletter innan något sparas i kundregistret.
          </p>
        </div>

        {preview ? (
          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {sourceLabel(preview.sourceKind)} • {preview.rows.length} rader
          </span>
        ) : null}
      </div>

      <form action={previewAction} className="space-y-4 p-6">
        <CompanyField
          companies={companies}
          selectedCompanyId={selectedCompanyId}
          isPlatformAdmin={isPlatformAdmin}
        />

        <label className="grid gap-2 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Importfil
          </span>
          <input
            type="file"
            name="importFile"
            accept=".csv,.txt,.tsv,.pdf,.xls,.xlsx,text/csv,text/plain,application/pdf"
            className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm text-slate-700"
          />
        </label>

        <label className="grid gap-2 text-sm">
          <span className="font-medium text-slate-700 dark:text-slate-200">
            Klistra in kundunderlag
          </span>
          <textarea
            name="bulkPayload"
            rows={12}
            defaultValue={bulkExample}
            className="w-full rounded-2xl border border-emerald-200 bg-white px-4 py-3 font-mono text-xs text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <button
          disabled={previewPending}
          className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {previewPending ? 'Läser underlaget...' : 'Förhandsgranska import'}
        </button>
      </form>

      <div className="px-6 pb-6">
      {previewState.message ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            previewState.status === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {previewState.message}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Rader</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">{preview.rows.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Varningar</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {preview.issues.filter((issue) => issue.severity === 'warning').length}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Fel</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950 dark:text-white">
                {preview.issues.filter((issue) => issue.severity === 'error').length}
              </p>
            </div>
          </div>

          {preview.issues.length > 0 ? (
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
              {preview.issues.slice(0, 20).map((issue, index) => (
                <div key={`${issue.rowNumber}-${index}`} className={`rounded-xl border px-3 py-2 text-xs ${issueTone(issue.severity)}`}>
                  <span className="font-semibold">Rad {issue.rowNumber}</span>
                  {issue.field ? <span> • {issue.field}</span> : null}
                  <span> — {issue.message}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950">
                  <tr>
                    <th className="px-3 py-3 text-left font-semibold text-slate-500">Kund</th>
                    <th className="px-3 py-3 text-left font-semibold text-slate-500">Kontakt</th>
                    <th className="px-3 py-3 text-left font-semibold text-slate-500">Anläggning</th>
                    <th className="px-3 py-3 text-left font-semibold text-slate-500">Avtal</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 8).map((row, index) => (
                    <tr key={`${row.email}-${index}`} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">
                        {row.company_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{row.email || row.phone || '—'}</td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{row.facility_id || row.meter_point_id || '—'}</td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-300">{row.contract_offer_id || row.contract_type_override || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <form action={commitAction} className="space-y-3">
            <CompanyField
              companies={companies}
              selectedCompanyId={selectedCompanyId}
              isPlatformAdmin={isPlatformAdmin}
            />
            <input type="hidden" name="bulkPayload" value={preview.normalizedCsv} />
            <button
              disabled={commitPending || hasBlockingIssues || preview.rows.length === 0}
              className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {commitPending ? 'Sparar import...' : 'Spara godkända rader'}
            </button>
            {hasBlockingIssues ? (
              <p className="text-xs text-rose-600">
                Åtgärda fel markerade i förhandsgranskningen innan importen sparas.
              </p>
            ) : null}
          </form>
        </div>
      ) : null}

      {commitState.message ? (
        <div
          className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
            commitState.status === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {commitState.message}
        </div>
      ) : null}
      </div>
    </section>
  )
}
