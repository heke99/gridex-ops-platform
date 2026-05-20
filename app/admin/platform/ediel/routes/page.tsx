import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type PlatformRouteRow = {
  id: string
  company_id: string | null
  is_enabled: boolean | null
  environment: string | null
  message_standard: string | null
  ack_mode: string | null
  sender_ediel_id: string | null
  sender_name: string | null
  sender_sub_address: string | null
  receiver_ediel_id: string | null
  receiver_name: string | null
  receiver_sub_address: string | null
  mailbox: string | null
  smtp_host: string | null
  smtp_port: number | null
  communication_route_id: string | null
  updated_at: string | null
}

type CompanyRow = {
  id: string
  name: string
}

type CommunicationRouteRow = {
  id: string
  route_name: string
  route_type: string | null
  target_email: string | null
  is_active: boolean | null
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function safeText(value: string | number | null | undefined) {
  if (value === null || value === undefined || String(value).trim().length === 0) return '—'
  return String(value)
}

function Pill({ active }: { active: boolean | null }) {
  return active ? (
    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">Aktiv</span>
  ) : (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">Inaktiv</span>
  )
}

async function safeSelect<T>(table: string, select: string): Promise<T[]> {
  const supabase = await createSupabaseServerClient()
  try {
    const { data, error } = await supabase.from(table).select(select)
    if (error) return []
    return (data ?? []) as T[]
  } catch {
    return []
  }
}

export default async function PlatformEdielRoutesPage() {
  const admin = await requirePlatformAdminAccess()
  const [profiles, companies, communicationRoutes] = await Promise.all([
    safeSelect<PlatformRouteRow>('ediel_route_profiles', 'id,company_id,is_enabled,environment,message_standard,ack_mode,sender_ediel_id,sender_name,sender_sub_address,receiver_ediel_id,receiver_name,receiver_sub_address,mailbox,smtp_host,smtp_port,communication_route_id,updated_at'),
    safeSelect<CompanyRow>('companies', 'id,name'),
    safeSelect<CommunicationRouteRow>('communication_routes', 'id,route_name,route_type,target_email,is_active'),
  ])

  const companyById = new Map(companies.map((company) => [company.id, company.name]))
  const routeById = new Map(communicationRoutes.map((route) => [route.id, route]))
  const activeProfiles = profiles.filter((profile) => profile.is_enabled !== false).length
  const missingReceiver = profiles.filter((profile) => !profile.receiver_ediel_id && !routeById.get(profile.communication_route_id ?? '')?.target_email).length

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Globala Ediel-rutter"
        subtitle="Plattformsnivå för Ediel route profiles, mottagaradresser och tekniska sändvägar över alla bolag."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-700">Route profiles</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{profiles.length}</p>
            <p className="mt-2 text-sm text-slate-700">Tekniska profiler över alla tenants.</p>
          </div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-emerald-700">Aktiva</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-950">{activeProfiles}</p>
            <p className="mt-2 text-sm text-emerald-800">Profiler som kan användas i runtime.</p>
          </div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <p className="text-sm font-medium text-amber-700">Saknar mottagare</p>
            <p className="mt-2 text-3xl font-semibold text-amber-950">{missingReceiver}</p>
            <p className="mt-2 text-sm text-amber-800">Profiler som behöver mottagar-id eller target email.</p>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-semibold text-slate-950">Route profiles per bolag</h2>
            <p className="mt-1 text-sm text-slate-700">Company admin arbetar i sin egen `/admin/ediel/routes`. Den här sidan är global översikt för superadmin.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-5 py-3">Bolag</th>
                  <th className="px-5 py-3">Route</th>
                  <th className="px-5 py-3">Sender</th>
                  <th className="px-5 py-3">Receiver</th>
                  <th className="px-5 py-3">Teknik</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {profiles.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-slate-700">Inga Ediel route profiles hittades.</td></tr>
                ) : (
                  profiles.map((profile) => {
                    const route = routeById.get(profile.communication_route_id ?? '')
                    return (
                      <tr key={profile.id} className="align-top">
                        <td className="px-5 py-4 font-medium text-slate-950">{profile.company_id ? companyById.get(profile.company_id) ?? profile.company_id : 'Global'}</td>
                        <td className="px-5 py-4 text-slate-700">
                          <div className="font-medium text-slate-950">{route?.route_name ?? 'Route saknas'}</div>
                          <div>{safeText(route?.route_type)} · {safeText(route?.target_email)}</div>
                        </td>
                        <td className="px-5 py-4 text-slate-700">{safeText(profile.sender_name)} · {safeText(profile.sender_ediel_id)} · {safeText(profile.sender_sub_address)}</td>
                        <td className="px-5 py-4 text-slate-700">{safeText(profile.receiver_name)} · {safeText(profile.receiver_ediel_id)} · {safeText(profile.receiver_sub_address)}</td>
                        <td className="px-5 py-4 text-slate-700">{safeText(profile.environment)} · {safeText(profile.message_standard)} · {safeText(profile.ack_mode)}<br />{safeText(profile.smtp_host)}:{safeText(profile.smtp_port)} · {safeText(profile.mailbox)}</td>
                        <td className="px-5 py-4 text-slate-700"><Pill active={profile.is_enabled} /><div className="mt-2 text-xs">{formatDate(profile.updated_at)}</div></td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
