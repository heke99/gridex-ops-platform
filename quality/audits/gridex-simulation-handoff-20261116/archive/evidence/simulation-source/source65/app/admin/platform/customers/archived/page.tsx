import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

type ArchivedCustomerRow = {
  id: string
  company_id: string | null
  customer_number: string | null
  full_name: string | null
  company_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  status: string | null
  archived_at: string | null
  archived_by: string | null
  archive_reason: string | null
  source: string | null
  created_at: string | null
  updated_at: string | null
}

type CompanyRow = {
  id: string
  name: string | null
}

function displayName(row: ArchivedCustomerRow): string {
  const contactName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return row.full_name ?? row.company_name ?? (contactName || 'Namnlös kund')
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default async function PlatformArchivedCustomersPage() {
  const admin = await requirePlatformAdminAccess()

  const { data: customerRows, error: customersError } = await supabaseService
    .from('customers')
    .select('id,company_id,customer_number,full_name,company_name,first_name,last_name,email,status,archived_at,archived_by,archive_reason,source,created_at,updated_at')
    .eq('status', 'archived')
    .order('archived_at', { ascending: false })
    .limit(500)

  if (customersError) throw customersError

  const rows = (customerRows ?? []) as ArchivedCustomerRow[]
  const companyIds = [...new Set(rows.map((row) => row.company_id).filter((value): value is string => Boolean(value)))]
  let companyMap = new Map<string, string>()

  if (companyIds.length > 0) {
    const { data: companyRows, error: companiesError } = await supabaseService
      .from('companies')
      .select('id,name')
      .in('id', companyIds)

    if (companiesError) throw companiesError
    companyMap = new Map(((companyRows ?? []) as CompanyRow[]).map((company) => [company.id, company.name ?? company.id]))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Arkiverade kunder"
        subtitle="Platformvy över arkiverade kunder från alla tenants. Tenants ser endast sina egna arkiverade kunder i kundregistret."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Platform only</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Alla arkiverade kunder</h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
                Arkivering betyder att historik bevaras, men kunden döljs från aktiv tenant-lista. Den här vyn är bara för superadmin och läcker inte tenantdata till andra tenants.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/customers?status=archived" className="rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-800 hover:bg-slate-50">
                Öppna kundfilter
              </Link>
              <Link href="/admin/platform/data-cleanup" className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">
                Datahantering
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-600">Arkiverade kunder</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{rows.length}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-600">Tenants berörda</div>
            <div className="mt-2 text-3xl font-black text-slate-950">{companyIds.length}</div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-600">Senast arkiverad</div>
            <div className="mt-2 text-lg font-black text-slate-950">{formatDate(rows[0]?.archived_at ?? null)}</div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-black text-slate-950">Arkivposter</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">Visar tenant, arkivorsak och länk till kundkort i arkivläge.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="px-6 py-4">Kund</th>
                  <th className="px-6 py-4">Tenant</th>
                  <th className="px-6 py-4">Arkiverad</th>
                  <th className="px-6 py-4">Arkiverad av</th>
                  <th className="px-6 py-4">Orsak</th>
                  <th className="px-6 py-4">Source</th>
                  <th className="px-6 py-4">Uppdaterad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-6 py-4">
                      <Link href={`/admin/customers/${row.id}`} className="font-black text-emerald-800 hover:underline">
                        {displayName(row)}
                      </Link>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{row.customer_number ?? 'Saknar kundnummer'} · {row.email ?? 'Saknar e-post'}</div>
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-700">{row.company_id ? companyMap.get(row.company_id) ?? row.company_id : 'Saknar tenant'}</td>
                    <td className="px-6 py-4 text-slate-700">{formatDate(row.archived_at)}</td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-500">{row.archived_by ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700">{row.archive_reason ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700">{row.source ?? '—'}</td>
                    <td className="px-6 py-4 text-slate-700">{formatDate(row.updated_at)}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-600">Inga arkiverade kunder hittades.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
