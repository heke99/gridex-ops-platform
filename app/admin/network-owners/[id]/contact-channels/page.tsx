import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getGridOwnerById } from '@/lib/masterdata/db'
import {
  saveGridOwnerContactChannelsMultiAction,
  toggleGridOwnerContactChannelAction,
  upsertGridOwnerContactChannelAction,
} from './actions'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ status?: string; message?: string }>
}

type ContactChannelRow = {
  id: string
  grid_owner_id: string
  company_id: string | null
  channel_type: string
  email: string | null
  phone: string | null
  label: string | null
  is_enabled: boolean
  is_verified: boolean
  source: string
  updated_at: string | null
}

const CHANNEL_TYPES: Array<{ value: string; label: string }> = [
  { value: 'facility_information_request', label: 'Anläggningsuppgifter' },
  { value: 'supplier_switch_manual', label: 'Manuellt leverantörsbyte' },
  { value: 'power_of_attorney', label: 'Fullmakt' },
  { value: 'ai_list', label: 'AI-lista' },
  { value: 'escalation', label: 'Eskalering' },
]

function channelLabel(value: string): string {
  return CHANNEL_TYPES.find((entry) => entry.value === value)?.label ?? value
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  } catch {
    return '—'
  }
}

export default async function GridOwnerContactChannelsPage({ params, searchParams }: PageProps) {
  const context = await requirePlatformAdminAccess()
  const { id } = await params
  const query = (await searchParams) ?? {}
  const supabase = await createSupabaseServerClient()

  const owner = await getGridOwnerById(supabase, id)

  const { data } = await supabase
    .from('grid_owner_contact_channels')
    .select('id,grid_owner_id,company_id,channel_type,email,phone,label,is_enabled,is_verified,source,updated_at')
    .eq('grid_owner_id', id)
    .order('company_id', { ascending: true, nullsFirst: true })
    .order('channel_type', { ascending: true })

  const channels = (data ?? []) as ContactChannelRow[]
  const platformDefaults = channels.filter((row) => !row.company_id)
  const tenantOverrides = channels.filter((row) => row.company_id)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Kontaktvägar för nätägare"
        subtitle={`Manuella kontaktvägar (e-post/telefon) som används av den manuella informationspipelinen för ${owner?.name ?? 'nätägaren'}.`}
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950">{owner?.name ?? 'Nätägare'}</h2>
            <p className="mt-1 text-sm text-slate-600">Ediel-ID: {owner?.ediel_id ?? '—'} · Plattformsstandard gäller alla tenants tills en tenant-override finns.</p>
          </div>
          <Link href="/admin/network-owners" className="rounded-2xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50">Tillbaka till nätägare</Link>
        </div>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h3 className="text-base font-bold text-slate-950">Konfigurerade kontaktvägar</h3>
          </div>
          {channels.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-600">Inga kontaktvägar konfigurerade ännu. Lägg till en plattformsstandard nedan.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Kanal</th>
                    <th className="px-6 py-3">Omfattning</th>
                    <th className="px-6 py-3">E-post / telefon</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Uppdaterad</th>
                    <th className="px-6 py-3">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {[...platformDefaults, ...tenantOverrides].map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-semibold text-slate-950">{channelLabel(row.channel_type)}</td>
                      <td className="px-6 py-4 text-slate-700">{row.company_id ? 'Tenant-override' : 'Plattformsstandard'}</td>
                      <td className="px-6 py-4 text-slate-700">{row.email ?? '—'}{row.phone ? ` · ${row.phone}` : ''}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold ${row.is_enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{row.is_enabled ? 'Aktiv' : 'Inaktiv'}</span>
                        {row.is_verified ? <span className="ml-2 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">Verifierad</span> : null}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">{formatDate(row.updated_at)}</td>
                      <td className="px-6 py-4">
                        <form action={toggleGridOwnerContactChannelAction}>
                          <input type="hidden" name="grid_owner_id" value={id} />
                          <input type="hidden" name="channel_id" value={row.id} />
                          <input type="hidden" name="enable" value={row.is_enabled ? 'false' : 'true'} />
                          <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50">{row.is_enabled ? 'Inaktivera' : 'Aktivera'}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-sky-900 shadow-sm">
          <h3 className="text-base font-bold text-sky-950">Så skickas och tas manuell e-post emot</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 leading-6">
            <li>Avsändare/svarsadress: <strong>leverantorsbyte@gridex.se</strong></li>
            <li>Utgående transport: <strong>Resend</strong> (inte SMTP). IMAP/SMTP-inställningar nedan används inte för utgående utskick.</li>
            <li>Inkommande svar: <strong>Strato IMAP</strong>.</li>
            <li>Eftersom utskick går via Resend syns skickad post normalt inte i Stratos &quot;Skickat&quot;-mapp.</li>
          </ul>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">Spara en e-post för flera användningsområden</h3>
          <p className="mt-1 text-sm text-slate-600">Ange en e-postadress och välj alla användningsområden den ska gälla för. En rad skapas/uppdateras per användningsområde (befintliga rader skrivs inte över oavsiktligt).</p>
          <form action={saveGridOwnerContactChannelsMultiAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="grid_owner_id" value={id} />
            <label className="text-sm font-semibold text-slate-800">
              E-post
              <input name="email" type="email" placeholder="natagare@example.se" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Bolags-ID (valfritt, för tenant-override)
              <input name="company_id" placeholder="Lämna tomt för plattformsstandard" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Telefon (valfritt)
              <input name="phone" placeholder="+46..." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Etikett
              <input name="label" placeholder="t.ex. Kundtjänst leverantörsbyte" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-semibold text-slate-800">Användningsområden</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {CHANNEL_TYPES.map((entry) => (
                  <label key={entry.value} className="flex items-center gap-2 text-sm text-slate-800">
                    <input
                      type="checkbox"
                      name="channel_types"
                      value={entry.value}
                      defaultChecked={entry.value === 'facility_information_request' || entry.value === 'supplier_switch_manual'}
                    />
                    {entry.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="is_enabled" defaultChecked /> Aktiv
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="is_verified" /> Verifierad
            </label>
            <div className="md:col-span-2">
              <button className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Spara för valda områden</button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-base font-bold text-slate-950">Lägg till / uppdatera kontaktväg</h3>
          <p className="mt-1 text-sm text-slate-600">Lämna bolags-ID tomt för en plattformsstandard som alla tenants kan använda. Ange bolags-ID för en tenant-specifik override.</p>
          <form action={upsertGridOwnerContactChannelAction} className="mt-4 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="grid_owner_id" value={id} />
            <label className="text-sm font-semibold text-slate-800">
              Kanaltyp
              <select name="channel_type" defaultValue="facility_information_request" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                {CHANNEL_TYPES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Bolags-ID (valfritt, för tenant-override)
              <input name="company_id" placeholder="Lämna tomt för plattformsstandard" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              E-post
              <input name="email" type="email" placeholder="natagare@example.se" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Telefon
              <input name="phone" placeholder="+46..." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-sm font-semibold text-slate-800 md:col-span-2">
              Etikett
              <input name="label" placeholder="t.ex. Kundtjänst leverantörsbyte" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="is_enabled" defaultChecked /> Aktiv
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <input type="checkbox" name="is_verified" /> Verifierad
            </label>
            <div className="md:col-span-2">
              <button className="rounded-2xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800">Spara kontaktväg</button>
            </div>
          </form>
        </section>
      </main>
    </div>
  )
}
