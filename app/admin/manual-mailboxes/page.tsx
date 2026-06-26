import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { saveManualMailboxAction, toggleManualMailboxAction } from './actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{ status?: string; message?: string }>
}

type MailboxRow = {
  id: string
  company_id: string | null
  mailbox_name: string
  mailbox_type: string
  environment: string
  from_email: string | null
  reply_to_email: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_username: string | null
  smtp_secret_reference: string | null
  smtp_secure: boolean
  imap_host: string | null
  imap_port: number | null
  imap_username: string | null
  imap_secret_reference: string | null
  imap_folder: string | null
  imap_secure: boolean
  is_active: boolean
  is_verified: boolean
  last_polled_at: string | null
  last_successful_poll_at: string | null
  last_error: string | null
  updated_at: string | null
}

const MAILBOX_TYPES: Array<{ value: string; label: string }> = [
  { value: 'manual_supplier_switch', label: 'Leverantörsbyte' },
  { value: 'power_of_attorney', label: 'Fullmakt' },
  { value: 'facility_information_request', label: 'Anläggningsuppgifter' },
  { value: 'ai_list', label: 'AI-lista' },
  { value: 'escalation', label: 'Eskalering' },
  { value: 'general_manual_operations', label: 'Allmän manuell operation' },
]

function typeLabel(value: string): string {
  return MAILBOX_TYPES.find((entry) => entry.value === value)?.label ?? value
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return '—'
  }
}

export default async function ManualMailboxesPage({ searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const query = (await searchParams) ?? {}

  const { data } = await supabaseService
    .from('manual_communication_mailboxes')
    .select('*')
    .order('company_id', { ascending: true, nullsFirst: true })
    .order('environment', { ascending: true })
    .order('mailbox_type', { ascending: true })
    .limit(200)

  const mailboxes = (data ?? []) as MailboxRow[]

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Manuell kommunikationsbrevlåda"
        subtitle="Avsändar- och inkorgsbrevlåda för manuell nätägarkommunikation (leverantörsbyte, fullmakt, anläggningsuppgifter). Separat från Ediel-brevlådan (ediel@gridex.se) och från nätägarens kontaktvägar."
        userEmail={context.email}
        workspaceName="Gridex Platform"
        workspaceMode="platform"
      />

      <main className="space-y-6 p-6 lg:p-8">
        {query.status && query.message ? (
          <section className={`rounded-3xl border p-4 text-sm shadow-sm ${query.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            <p className="leading-6">{query.message}</p>
          </section>
        ) : null}

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="leading-6">
            <strong>Viktigt:</strong> ediel@gridex.se är reserverad för Ediel/EDIFACT-transport (PRODAT, UTILTS, CONTRL, APERAK) och får
            aldrig användas som manuell avsändare. Manuell e-post skickas alltid från en konfigurerad manuell brevlåda nedan.
            Lösenord lagras aldrig i databasen – ange endast en secret reference (env:...).
          </p>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950">Konfigurerade manuella brevlådor</h2>
            <p className="mt-1 text-sm text-slate-600">Plattformsstandard (utan bolags-ID) gäller alla tenants tills en tenant-override finns.</p>
          </div>
          <Link href="/admin/network-owners" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">Nätägarkontaktvägar</Link>
        </div>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {mailboxes.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-600">Inga manuella brevlådor konfigurerade ännu. Lägg till en plattformsstandard nedan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Namn / typ</th>
                    <th className="px-6 py-3">Omfattning / miljö</th>
                    <th className="px-6 py-3">Avsändaradress</th>
                    <th className="px-6 py-3">IMAP</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Senaste hämtning</th>
                    <th className="px-6 py-3">Senaste fel</th>
                    <th className="px-6 py-3">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {mailboxes.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-950">{row.mailbox_name}</div>
                        <div className="text-xs text-slate-500">{typeLabel(row.mailbox_type)}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-700">
                        {row.company_id ? 'Tenant-override' : 'Plattformsstandard'}
                        <div className="text-xs text-slate-500">{row.environment}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-700">
                        {row.from_email ?? '—'}
                        <div className="text-xs text-slate-500">Svar: {row.reply_to_email ?? '—'}</div>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600">
                        {row.imap_host ? `${row.imap_host}:${row.imap_port ?? ''}` : '—'}
                        <div>{row.imap_username ?? ''}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${row.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{row.is_active ? 'Aktiv' : 'Inaktiv'}</span>
                        {row.is_verified ? <span className="ml-2 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">Verifierad</span> : null}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {formatDate(row.last_polled_at)}
                        <div>Lyckad: {formatDate(row.last_successful_poll_at)}</div>
                      </td>
                      <td className="px-6 py-4 text-xs text-red-700">{row.last_error ?? '—'}</td>
                      <td className="px-6 py-4">
                        <form action={toggleManualMailboxAction}>
                          <input type="hidden" name="mailbox_id" value={row.id} />
                          <input type="hidden" name="enable" value={row.is_active ? 'false' : 'true'} />
                          <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50">{row.is_active ? 'Inaktivera' : 'Aktivera'}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">Lägg till / uppdatera manuell brevlåda</h3>
          <p className="mt-1 text-sm text-slate-600">Lämna bolags-ID tomt för en plattformsstandard. Ange bolags-ID för en tenant-specifik avsändare.</p>
          <form action={saveManualMailboxAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Namn
              <input name="mailbox_name" placeholder="t.ex. Leverantörsbyte (produktion)" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Typ
              <select name="mailbox_type" defaultValue="general_manual_operations" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                {MAILBOX_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Miljö
              <select name="environment" defaultValue="production" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="test">test</option>
                <option value="production">production</option>
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Bolags-ID (valfritt, för tenant-override)
              <input name="company_id" placeholder="Lämna tomt för plattformsstandard" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Avsändaradress
              <input name="from_email" type="email" placeholder="leverantorsbyte@gridex.se" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Svarsadress
              <input name="reply_to_email" type="email" placeholder="Lämna tomt = samma som avsändaradress" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>

            <div className="md:col-span-2 mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">SMTP (utgående)</div>
            <label className="text-sm font-semibold text-slate-800">
              SMTP host
              <input name="smtp_host" defaultValue="smtp.strato.de" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              SMTP port
              <input name="smtp_port" type="number" defaultValue={465} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              SMTP användare
              <input name="smtp_username" placeholder="leverantorsbyte@gridex.se" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              SMTP secret reference
              <input name="smtp_secret_reference" defaultValue="env:MANUAL_OPS_SMTP_PASS" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="smtp_secure" defaultChecked /> SMTP SSL/TLS
            </label>
            <div className="hidden md:block" />

            <div className="md:col-span-2 mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">IMAP (inkommande)</div>
            <label className="text-sm font-semibold text-slate-800">
              IMAP host
              <input name="imap_host" defaultValue="imap.strato.de" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              IMAP port
              <input name="imap_port" type="number" defaultValue={993} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              IMAP användare
              <input name="imap_username" placeholder="leverantorsbyte@gridex.se" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              IMAP secret reference
              <input name="imap_secret_reference" defaultValue="env:MANUAL_OPS_IMAP_PASS" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              IMAP mapp
              <input name="imap_folder" defaultValue="INBOX" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="imap_secure" defaultChecked /> IMAP SSL/TLS
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="is_active" defaultChecked /> Aktiv
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="is_verified" /> Verifierad
            </label>
            <div className="md:col-span-2">
              <button className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Spara brevlåda</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  )
}
