// app/admin/ediel/ai-list/page.tsx
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAnyPermissionServer } from '@/lib/auth/requirePermissionServer'
import { listEdielMessages } from '@/lib/ediel/db'
import {
  prepareAiListAction,
  sendEdielMessageAction,
} from '@/app/admin/ediel/actions'
import type { EdielMessageRow } from '@/lib/ediel/types'

export const dynamic = 'force-dynamic'

type CustomerRow = {
  id: string
  full_name: string | null
  company_name: string | null
  customer_number: string | null
}

type SiteRow = {
  id: string
  customer_id: string | null
  site_name: string | null
}

type MeteringPointRow = {
  id: string
  site_id: string | null
  meter_point_id: string | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function Pill({
  text,
  tone,
}: {
  text: string
  tone: 'emerald' | 'amber' | 'red' | 'slate'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-700'
        : tone === 'red'
          ? 'bg-red-100 text-red-700'
            : 'bg-slate-100 text-slate-700'

  return <span className={`rounded-full px-2 py-1 text-xs font-medium ${toneClass}`}>{text}</span>
}

function statusTone(status: string): 'emerald' | 'amber' | 'red' | 'slate' {
  if (status === 'acknowledged' || status === 'received') return 'emerald'
  if (status === 'queued' || status === 'prepared' || status === 'draft') return 'amber'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'sent') return 'emerald'
  return 'slate'
}

function customerLabel(row: CustomerRow) {
  return row.company_name || row.full_name || row.customer_number || row.id
}

export default async function AdminEdielAiListPage() {
  const context = await requireAnyPermissionServer([
    'communication.read',
    'metering.read',
    'billing_underlay.read',
    'switching.read',
  ])

  const supabase = await createSupabaseServerClient()

  const [messages, customersResult, sitesResult, meteringPointsResult] =
    await Promise.all([
      listEdielMessages({ family: 'AI_LIST', limit: 100 }),
      supabase
        .from('customers')
        .select('id, full_name, company_name, customer_number')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('customer_sites')
        .select('id, customer_id, site_name')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('metering_points')
        .select('id, site_id, meter_point_id')
        .order('created_at', { ascending: false })
        .limit(200),
    ])

  if (customersResult.error) throw customersResult.error
  if (sitesResult.error) throw sitesResult.error
  if (meteringPointsResult.error) throw meteringPointsResult.error

  const aiMessages = (messages as EdielMessageRow[]).filter(
    (row) => row.message_family === 'AI_LIST'
  )
  const customers = (customersResult.data ?? []) as CustomerRow[]
  const sites = (sitesResult.data ?? []) as SiteRow[]
  const meteringPoints = (meteringPointsResult.data ?? []) as MeteringPointRow[]

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="AI-/BI-listor"
        subtitle="Operativ vy för export av AI-/BI-listor och historik över skickade listmeddelanden."
        userEmail={context.email}
      />

      <div className="space-y-8 p-8">
        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">Skapa ny AI-/BI-lista</h2>
            <p className="mt-1 text-sm text-slate-500">
              AI-listan ska användas för kontroll och avvikelsehantering, inte för
              automatisk databassynk.
            </p>
          </div>

          <form action={prepareAiListAction} className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Listtyp
              </label>
              <select
                name="listType"
                defaultValue="AI"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="AI">AI</option>
                <option value="BI">BI</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Kund
              </label>
              <select
                name="customerId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                required
              >
                <option value="">Välj kund</option>
                {customers.map((row) => (
                  <option key={row.id} value={row.id}>
                    {customerLabel(row)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Anläggning
              </label>
              <select
                name="siteId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                required
              >
                <option value="">Välj anläggning</option>
                {sites.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.site_name || row.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Mätpunkt
              </label>
              <select
                name="meteringPointId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
              >
                <option value="">Valfri</option>
                {meteringPoints.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.meter_point_id || row.id}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Receiver Ediel ID
              </label>
              <input
                name="receiverEdielId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Mottagande Ediel-ID"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Receiver email
              </label>
              <input
                name="receiverEmail"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Mottagande e-post"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Supplier Ediel ID
              </label>
              <input
                name="supplierEdielId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Valfri override"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                BRP Ediel ID
              </label>
              <input
                name="balanceResponsibleEdielId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Valfri override"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Communication route ID
              </label>
              <input
                name="communicationRouteId"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                placeholder="Valfri route override"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                From date
              </label>
              <input
                name="fromDate"
                type="date"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                To date
              </label>
              <input
                name="toDate"
                type="date"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
                required
              />
            </div>

            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
              >
                Generera och köa AI-/BI-lista
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-slate-900">Historik</h2>
            <p className="mt-1 text-sm text-slate-500">
              AI-/BI-listor som redan genererats i EDIEL-lagret.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-3 py-3">Tid</th>
                  <th className="px-3 py-3">Lista</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Period</th>
                  <th className="px-3 py-3">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {aiMessages.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-slate-500">
                      Inga AI-/BI-listor ännu.
                    </td>
                  </tr>
                ) : (
                  aiMessages.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 align-top">
                      <td className="px-3 py-3 whitespace-nowrap text-slate-600">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/admin/ediel/messages/${row.id}`}
                          className="font-medium text-emerald-700 underline-offset-2 hover:underline"
                        >
                          {row.message_code}
                        </Link>
                        <div className="mt-1 text-xs text-slate-500">
                          {row.subject ?? row.file_name ?? 'AI-/BI-lista'}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 break-all">
                          {row.external_reference ?? row.transaction_reference ?? row.id}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Pill text={row.status} tone={statusTone(row.status)} />
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        <div>Version: {row.message_version ?? '—'}</div>
                        <div>Environment: {row.environment}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/ediel/messages/${row.id}`}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
                          >
                            Öppna
                          </Link>

                          {(row.status === 'queued' || row.status === 'prepared') ? (
                            <form action={sendEdielMessageAction}>
                              <input type="hidden" name="edielMessageId" value={row.id} />
                              <button
                                type="submit"
                                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                              >
                                Skicka nu
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}