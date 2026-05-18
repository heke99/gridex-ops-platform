// components/admin/ediel/EdielFileEnginePanel.tsx

import Link from 'next/link'
import type { ReactNode } from 'react'
import { cancelEdielMessageAction, registerEdielFileAction } from '@/app/admin/ediel/actions'
import {
  EDIEL_TGT_PRODAT_APPLICATION_REFERENCE,
  EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS,
  EDIEL_TGT_TESTSYSTEM_EDIEL_ID,
  EDIEL_TGT_TESTSYSTEM_EMAIL,
  GRIDEX_EDIEL_ID,
  getFileEngineTestcaseTemplates,
} from '@/lib/ediel/fileEngine'
import type { EdielMessageRow } from '@/lib/ediel/types'

function MiniBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  )
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function getErrors(row: EdielMessageRow): string[] {
  const errors = row.validation_report?.errors
  return Array.isArray(errors) ? errors.filter((entry): entry is string => typeof entry === 'string') : []
}

function getWarnings(row: EdielMessageRow): string[] {
  const warnings = row.validation_report?.warnings
  return Array.isArray(warnings) ? warnings.filter((entry): entry is string => typeof entry === 'string') : []
}

export default function EdielFileEnginePanel({
  recentMessages,
}: {
  recentMessages: EdielMessageRow[]
}) {
  const templates = getFileEngineTestcaseTemplates()
  const fileEngineMessages = recentMessages
    .filter((row) => row.transport_type === 'manual_upload')
    .slice(0, 8)

  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            Batch 4 · Filbaserad Ediel-motor
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-700">
            Här importerar du svar från Edielportalen, till exempel CONTRL, APERAK eller PRODAT Z04. Klistra in ren EDIFACT från UNA/UNB till UNZ, inte JSON eller SQL-resultat.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MiniBadge>TGT Gridcore-ID: {GRIDEX_EDIEL_ID}</MiniBadge>
          <MiniBadge>Portal: {EDIEL_TGT_TESTSYSTEM_EDIEL_ID}</MiniBadge>
          <MiniBadge>Transport: file/manual_upload</MiniBadge>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <form action={registerEdielFileAction} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-950">
            <div className="font-semibold">När använder jag detta?</div>
            <p className="mt-1 text-xs text-indigo-900">
              Efter att du skickat en fil i Edielportalen hämtar du portalens svar och importerar det här som inbound/TGT. Systemet försöker koppla svaret till rätt TGT-run automatiskt.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-900">Riktning</span>
              <select
                name="direction"
                defaultValue="inbound"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              >
                <option value="inbound">Inbound · fil från portal/motpart</option>
                <option value="outbound">Outbound · fil från Gridex</option>
              </select>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-900">Motorläge</span>
              <select
                name="mode"
                defaultValue="tgt"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              >
                <option value="tgt">TGT · Edielportalen</option>
                <option value="agt">AGT 2026A · aktiv leverantör</option>
                <option value="internal_test">Intern test</option>
                <option value="production_dry_run">Production dry-run</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Ladda upp fil</span>
              <input
                name="edielFile"
                type="file"
                accept=".edi,.edifact,.txt,.csv,.skv"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 file:text-slate-700"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Mailbox/message id, valfritt</span>
              <input
                name="mailboxMessageId"
                placeholder="Ex: portal-message-id eller filreferens"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">AGT-testfall, valfritt</span>
              <input
                name="agtTestCaseCode"
                placeholder="Ex: L2, L3, L4, L5, UL1, UL2, UL3, UL4 eller UL6"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              />
              <p className="mt-1 text-xs text-slate-500">Används bara i motorläge AGT när flera inbound-meddelanden har samma kod, exempelvis E66 för UL2/UL3.</p>
            </label>
          </div>

          <label className="mt-4 block">
            <span className="text-sm font-semibold text-slate-950">Klistra in EDIFACT/CSV från portalen</span>
            <textarea
              name="rawPayload"
              rows={8}
              placeholder={`Exempel: UNA:+.? '\nUNB+UNOC:3+91100...\nUNH+...\n...\nUNZ+...`}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-950 placeholder:text-slate-400"
            />
          </label>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Mailbox</span>
              <input
                name="mailbox"
                defaultValue="file-engine"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Avsändar-email</span>
              <input
                name="senderEmail"
                placeholder="valfritt"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Mottagar-email</span>
              <input
                name="receiverEmail"
                defaultValue={EDIEL_TGT_TESTSYSTEM_EMAIL}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 placeholder:text-slate-400"
              />
            </label>
          </div>

          <button
            type="submit"
            className="mt-4 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800"
          >
            Registrera fil i Ediel-motorn
          </button>
        </form>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-950">TGT/AGT portalvärden</h3>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Gridcore/TGT Ediel-ID</dt>
                <dd className="font-mono text-slate-900">{GRIDEX_EDIEL_ID}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Portal Ediel-ID</dt>
                <dd className="font-mono text-slate-900">{EDIEL_TGT_TESTSYSTEM_EDIEL_ID}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Portal email</dt>
                <dd className="font-mono text-slate-900">{EDIEL_TGT_TESTSYSTEM_EMAIL}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">PRODAT subadress</dt>
                <dd className="font-mono text-slate-900">{EDIEL_TGT_PRODAT_RECEIVER_SUB_ADDRESS}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Application Reference</dt>
                <dd className="font-mono text-slate-900">{EDIEL_TGT_PRODAT_APPLICATION_REFERENCE}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-950">Första testflöden att stötta</h3>
            <div className="mt-3 space-y-2">
              {templates.map((template) => (
                <div key={`${template.suite}-${template.code}`} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap gap-2">
                    <MiniBadge>{template.suite}</MiniBadge>
                    <MiniBadge>{template.code}</MiniBadge>
                    <MiniBadge>{template.role}</MiniBadge>
                  </div>
                  <div className="mt-2 text-sm font-medium text-slate-950">{template.title}</div>
                  <div className="mt-1 text-xs text-slate-600">{template.focus}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-sm font-semibold text-slate-950">Senaste filregistreringar</h3>
          <span className="text-xs text-slate-500">Visar transport_type = manual_upload</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-3 py-2">Tid</th>
                <th className="px-3 py-2">Filmeddelande</th>
                <th className="px-3 py-2">Parter</th>
                <th className="px-3 py-2">Referenser</th>
                <th className="px-3 py-2">Validering</th>
                <th className="px-3 py-2">Åtgärd</th>
              </tr>
            </thead>
            <tbody>
              {fileEngineMessages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                    Inga filregistreringar ännu.
                  </td>
                </tr>
              ) : (
                fileEngineMessages.map((row) => {
                  const errors = getErrors(row)
                  const warnings = getWarnings(row)
                  return (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-2 text-xs text-slate-600">{formatDateTime(row.created_at)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">
                          {row.message_family} {row.message_code}
                        </div>
                        <div className="text-xs text-slate-500">
                          {row.direction} · {row.message_version ?? 'utan version'} · {row.status}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div>Från: {row.sender_ediel_id ?? '—'}</div>
                        <div>Till: {row.receiver_ediel_id ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div>UNB: {row.interchange_reference ?? '—'}</div>
                        <div>RFF/TN: {row.transaction_reference ?? '—'}</div>
                        <div>BGM/ref: {row.external_reference ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {errors.length > 0 ? (
                          <span className="font-medium text-rose-700">{errors.length} fel</span>
                        ) : warnings.length > 0 ? (
                          <span className="font-medium text-amber-700">{warnings.length} varningar</span>
                        ) : (
                          <span className="font-medium text-emerald-700">OK</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/admin/ediel/messages/${row.id}`} className="text-indigo-700 underline-offset-2 hover:underline">
                            Öppna
                          </Link>
                          <form action={cancelEdielMessageAction}>
                            <input type="hidden" name="edielMessageId" value={row.id} />
                            <input type="hidden" name="reason" value="Dold från filimportlistan via admin cleanup." />
                            <button className="text-rose-700 underline-offset-2 hover:underline">
                              Dölj
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
