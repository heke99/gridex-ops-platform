'use client'

import { useActionState, useMemo, useState } from 'react'
import {
  initialUploadCustomerAuthorizationDocumentActionState,
  uploadCustomerAuthorizationDocumentAction,
} from '@/app/admin/customers/[id]/document-actions'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
import type { CustomerAuthorizationDocumentRow } from '@/lib/operations/types'
import SubmitButton from './SubmitButton'
import { documentTypeLabel, uploadResultClass } from './helpers'

export default function UploadForm({
  customerId,
  sites,
  documents,
}: {
  customerId: string
  sites: CustomerSiteRow[]
  documents: CustomerAuthorizationDocumentRow[]
}) {
  const [selectedSiteId, setSelectedSiteId] = useState<string>(sites[0]?.id ?? '')
  const [documentType, setDocumentType] = useState<'power_of_attorney' | 'complete_agreement'>(
    'power_of_attorney'
  )

  const [uploadState, uploadFormAction] = useActionState(
    uploadCustomerAuthorizationDocumentAction,
    initialUploadCustomerAuthorizationDocumentActionState
  )

  const replaceableDocuments = useMemo(() => {
    return documents.filter((row) => {
      const sameType = row.document_type === documentType
      const sameScope =
        (selectedSiteId ? row.site_id === selectedSiteId : row.site_id === null) ||
        row.site_id === null

      return sameType && sameScope && row.status !== 'archived'
    })
  }, [documents, documentType, selectedSiteId])

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Fullmakt / komplett avtal
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload kan nu skapa fullmakt, nätägarbegäran, supplier switch och outbound direkt,
          och blockerar samma fil via checksum/idempotency.
        </p>
      </div>

      {uploadState.status !== 'idle' && uploadState.message ? (
        <div
          className={`mt-6 rounded-2xl border px-4 py-3 text-sm ${uploadResultClass(uploadState.status)}`}
        >
          <div className="font-medium">
            {uploadState.status === 'duplicate'
              ? 'Dubblett blockerad'
              : uploadState.status === 'success'
                ? 'Upload klar'
                : 'Något gick fel'}
          </div>
          <div className="mt-1 whitespace-pre-line">{uploadState.message}</div>
        </div>
      ) : null}

      <form action={uploadFormAction} className="mt-6 space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Dokumenttyp</span>
            <select
              name="document_type"
              value={documentType}
              onChange={(event) =>
                setDocumentType(
                  event.target.value as 'power_of_attorney' | 'complete_agreement'
                )
              }
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="power_of_attorney">Fullmakt</option>
              <option value="complete_agreement">Komplett avtal</option>
            </select>
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Anläggning</span>
            <select
              name="site_id"
              value={selectedSiteId}
              onChange={(event) => setSelectedSiteId(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Titel</span>
            <input
              name="title"
              placeholder="Ex. Fullmakt signerad 2026-04-17"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Referens</span>
            <input
              name="reference"
              placeholder="Internt ID / signeringsreferens"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>

        <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium">Fil</span>
          <input
            name="document_file"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            className="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:file:bg-white dark:file:text-slate-950"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Giltig från</span>
            <input
              name="valid_from"
              type="date"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Giltig till</span>
            <input
              name="valid_to"
              type="date"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Switch startdatum</span>
            <input
              name="requested_start_date"
              type="date"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Begär period från</span>
            <input
              name="requested_period_start"
              type="date"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Begär period till</span>
            <input
              name="requested_period_end"
              type="date"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Switchtyp</span>
            <select
              name="request_type"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              defaultValue="switch"
            >
              <option value="switch">Switch</option>
              <option value="move_in">Inflytt</option>
              <option value="move_out_takeover">Övertag</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Extern referens</span>
            <input
              name="external_reference"
              placeholder="Extern referens / korrelation"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>

          <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-medium">Ersätt tidigare dokument</span>
            <select
              name="replace_document_id"
              defaultValue=""
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="">Ingen ersättning</option>
              {replaceableDocuments.map((row) => (
                <option key={row.id} value={row.id}>
                  {documentTypeLabel(row.document_type)} · {row.title ?? row.file_name ?? row.id}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          <span className="font-medium">Anteckning</span>
          <textarea
            name="notes"
            rows={4}
            placeholder="Vad dokumentet ska användas till, signeringsinfo, specialinstruktioner."
            className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <label className="flex items-start gap-3">
            <input name="mark_as_signed" type="checkbox" defaultChecked className="mt-1" />
            <span>Markera dokumentet som signerat direkt.</span>
          </label>

          <label className="flex items-start gap-3">
            <input
              name="sync_to_power_of_attorney"
              type="checkbox"
              defaultChecked={documentType === 'power_of_attorney'}
              className="mt-1"
            />
            <span>Skapa/koppla fullmaktspost samtidigt.</span>
          </label>

          <label className="flex items-start gap-3">
            <input name="set_as_active" type="checkbox" defaultChecked className="mt-1" />
            <span>Sätt dokumentet som aktivt standarddokument.</span>
          </label>

          <label className="flex items-start gap-3">
            <input
              name="archive_previous_active"
              type="checkbox"
              defaultChecked
              className="mt-1"
            />
            <span>Arkivera äldre aktiva standarddokument för samma scope/typ.</span>
          </label>
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <label className="flex items-start gap-3">
            <input
              name="auto_create_grid_owner_requests"
              type="checkbox"
              defaultChecked
              className="mt-1"
            />
            <span>Skapa nätägarbegäran direkt från upload.</span>
          </label>

          <div className="grid gap-2 pl-6">
            <label className="flex items-start gap-3">
              <input
                name="include_customer_masterdata"
                type="checkbox"
                defaultChecked
                className="mt-1"
              />
              <span>Inkludera kund/masterdata-begäran.</span>
            </label>
            <label className="flex items-start gap-3">
              <input name="include_meter_values" type="checkbox" defaultChecked className="mt-1" />
              <span>Inkludera mätvärdesbegäran.</span>
            </label>
            <label className="flex items-start gap-3">
              <input
                name="include_billing_underlay"
                type="checkbox"
                defaultChecked
                className="mt-1"
              />
              <span>Inkludera billing-underlay-begäran.</span>
            </label>
          </div>

          <label className="flex items-start gap-3">
            <input
              name="auto_create_switch_request"
              type="checkbox"
              defaultChecked
              className="mt-1"
            />
            <span>Skapa supplier switch request direkt om readiness är OK.</span>
          </label>

          <label className="flex items-start gap-3">
            <input
              name="auto_queue_switch_outbound"
              type="checkbox"
              defaultChecked
              className="mt-1"
            />
            <span>Köa supplier-switch outbound direkt från upload.</span>
          </label>
        </div>

        <SubmitButton idleLabel="Ladda upp dokument" pendingLabel="Laddar upp..." />
      </form>
    </div>
  )
}