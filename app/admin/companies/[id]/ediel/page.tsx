import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { getCompanyById } from '@/lib/tenant/governance'
import { getCompanyActorConfiguration, type EdielConfigRow } from '@/lib/ediel/companyActorConfiguration'
import { CompanyActorProfilesPanel } from '@/components/admin/ediel/CompanyActorProfilesPanel'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function cell(row: EdielConfigRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (typeof value === 'boolean') return value ? 'ja' : 'nej'
  }
  return '-'
}

function ConfigTable({
  title,
  rows,
  columns,
}: {
  title: string
  rows: EdielConfigRow[]
  columns: Array<{ key: string; label: string; aliases?: string[] }>
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-slate-950">{title}</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
            <tr>{columns.map((column) => <th key={column.key} className="px-4 py-3">{column.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={columns.length} className="px-4 py-6 text-center text-slate-600">Inga rader hittades.</td></tr> : null}
            {rows.slice(0, 20).map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-slate-700">
                    {column.key === 'updated_at' ? formatDate(cell(row, column.key)) : cell(row, column.key, ...(column.aliases ?? []))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function CompanyEdielPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requirePlatformAdminAccess()
  const { id } = await params
  const company = await getCompanyById(id)

  if (!company) {
    return (
      <div className="space-y-6 p-8">
        <Link href="/admin/companies" className="text-sm font-semibold text-emerald-800 hover:text-emerald-900">Tillbaka till bolag</Link>
        <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800">Bolaget hittades inte.</div>
      </div>
    )
  }

  const config = await getCompanyActorConfiguration(company.id)

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title={`Ediel · ${company.name}`}
        subtitle="Platform-only konfiguration for Ediel-profiler, routes och mailbox health per tenant."
        userEmail={admin.email}
        workspaceName="Platform"
        workspaceMode="platform"
      />
      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/admin/companies/${company.id}`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Tillbaka till bolagsoversikt
          </Link>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">Tenant {company.id}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">{company.org_number ?? 'Orgnummer saknas'}</span>
          </div>
        </div>

        <CompanyActorProfilesPanel company={company} config={config} />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-600">Aktiva actor profiles</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{config.actors.filter((row) => row.is_active === true).length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-600">Route profiles</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{config.routeProfiles.length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-600">Mailboxes</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{config.mailboxes.length}</p>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-600">Unresolved inbound</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{config.unresolvedInboundCount}</p>
          </div>
        </section>

        <ConfigTable
          title="Route profiles"
          rows={config.routeProfiles}
          columns={[
            { key: 'environment_type', label: 'Env type', aliases: ['environment'] },
            { key: 'actor_role', label: 'Roll', aliases: ['role'] },
            { key: 'actor_subrole', label: 'Subroll', aliases: ['sub_role'] },
            { key: 'message_family', label: 'Familj' },
            { key: 'business_code', label: 'Kod', aliases: ['message_code'] },
            { key: 'receiver_ediel_id', label: 'Receiver' },
            { key: 'receiver_message_subaddress', label: 'Subaddress', aliases: ['receiver_subaddress', 'receiver_sub_address'] },
            { key: 'encryption_mode', label: 'Kryptering' },
            { key: 'is_enabled', label: 'Enabled' },
          ]}
        />

        <ConfigTable
          title="Mailboxar"
          rows={config.mailboxes}
          columns={[
            { key: 'environment', label: 'Miljo' },
            { key: 'mailbox_name', label: 'Namn', aliases: ['email_address'] },
            { key: 'provider', label: 'Provider' },
            { key: 'is_active', label: 'Aktiv' },
            { key: 'last_polled_at', label: 'Senast pollad', aliases: ['last_poll_at'] },
            { key: 'last_error', label: 'Fel' },
          ]}
        />
      </main>
    </div>
  )
}
