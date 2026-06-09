import Link from 'next/link'
import { requireAdminPageAccess, isPlatformAdminContext } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listWebsiteApplications } from '@/lib/admin/websiteIntegrationOps'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function statusTone(status: string) {
  if (['completed', 'application_received', 'linked_existing_customer', 'customer_created', 'customer_matched', 'contract_created'].includes(status)) return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (['manual_review', 'pending_review', 'confirmation_pending', 'webhook_pending'].includes(status)) return 'border-amber-200 bg-amber-50 text-amber-900'
  if (['failed', 'rejected', 'cancelled'].includes(status)) return 'border-red-200 bg-red-50 text-red-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

function payloadValue(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function customerName(row: { customers?: { full_name?: string | null; company_name?: string | null; email?: string | null } | null }) {
  return row.customers?.full_name ?? row.customers?.company_name ?? row.customers?.email ?? '—'
}

export default async function WebsiteApplicationsAdminPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const access = await requireAdminPageAccess({ anyOf: ['customers.read', 'customers.write', 'billing_underlay.read'] })
  const tenantScope = await resolveAdminTenantReadScope(access)
  const resolved = searchParams ? await searchParams : {}
  const status = typeof resolved.status === 'string' ? resolved.status : null
  const applications = await listWebsiteApplications({ companyId: tenantScope.isPlatformAdmin ? null : tenantScope.companyId, status, limit: 150 })
  const failed = applications.filter((item) => item.status === 'failed').length
  const manualReview = applications.filter((item) => ['manual_review', 'pending_review'].includes(item.status)).length
  const completed = applications.filter((item) => ['application_received', 'completed', 'linked_existing_customer'].includes(item.status)).length
  const isPlatformAdmin = isPlatformAdminContext(access)

  return (
    <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
      <section className="rounded-[36px] border border-emerald-100 bg-white p-8 shadow-sm shadow-emerald-950/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Website onboarding</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Inkomna kundansökningar</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Här ser du kunder som kommit in via externa hemsidor, vilket kundnummer de fick, om avtal/anläggning skapades, och exakt felsteg när något misslyckas.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/developers/customer-portal-api" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">API-dokumentation</Link>
            <Link href="/admin/webhooks/deliveries" className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Webhook-loggar</Link>
          </div>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5"><p className="text-sm text-slate-700">Totalt</p><p className="mt-2 text-3xl font-semibold text-slate-950">{applications.length}</p></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-sm text-emerald-800">Mottagna/klara</p><p className="mt-2 text-3xl font-semibold text-emerald-950">{completed}</p></div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><p className="text-sm text-amber-900">Manuell kontroll</p><p className="mt-2 text-3xl font-semibold text-amber-950">{manualReview}</p></div>
          <div className="rounded-3xl border border-red-200 bg-red-50 p-5"><p className="text-sm text-red-800">Misslyckade</p><p className="mt-2 text-3xl font-semibold text-red-950">{failed}</p></div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Link href="/admin/website-applications" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700">Alla</Link>
          <Link href="/admin/website-applications?status=failed" className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-800">Failed</Link>
          <Link href="/admin/website-applications?status=manual_review" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">Manual review</Link>
          <Link href="/admin/website-applications?status=application_received" className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800">Application received</Link>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
              <tr>
                <th className="px-4 py-3">Datum</th>
                <th className="px-4 py-3">Bolag</th>
                <th className="px-4 py-3">Kund</th>
                <th className="px-4 py-3">Kundnummer</th>
                <th className="px-4 py-3">External ID</th>
                <th className="px-4 py-3">Källa</th>
                <th className="px-4 py-3">Status/fel</th>
                <th className="px-4 py-3">Åtgärder</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {applications.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-600">Inga website applications hittades.</td></tr> : null}
              {applications.map((item) => (
                <tr key={item.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDate(item.created_at)}</td>
                  <td className="px-4 py-3 text-slate-700">{isPlatformAdmin ? item.companies?.name ?? item.company_id : 'Ditt bolag'}</td>
                  <td className="px-4 py-3 text-slate-700">{customerName(item)}<div className="text-xs text-slate-500">{item.customers?.email ?? payloadValue(item.payload, 'email') ?? '—'}</div></td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.customer_number ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{item.external_customer_id}</td>
                  <td className="px-4 py-3 text-slate-700">{item.source ?? 'external_website'}<div className="text-xs text-slate-500">{item.integration_api_clients?.name ?? '—'}</div></td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(item.status)}`}>{item.status}</span>{item.error_stage ? <div className="mt-1 text-xs text-red-700">{item.error_stage}: {item.error_message ?? item.error_code}</div> : null}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {item.customer_id ? <Link href={`/admin/customers/${item.customer_id}`} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Kundkort</Link> : null}
                      {item.contract_id ? <Link href={`/admin/customers/${item.customer_id}?tab=contracts`} className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Avtal</Link> : null}
                      <details className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                        <summary className="cursor-pointer">Payload</summary>
                        <pre className="mt-2 max-h-64 w-[28rem] overflow-auto whitespace-pre-wrap text-[11px] font-normal text-slate-600">{JSON.stringify(item.raw_payload ?? item.payload, null, 2)}</pre>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
