import CustomerName from '@/components/admin/CustomerName'
import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { hasPermissionRequirement } from '@/lib/admin/accessModel'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listCustomerCases } from '@/lib/customer-cases/db'
import { listTenantSupportCustomerOptions } from '@/lib/customer-cases/support'
import { createCustomerCaseFromFormAction, updateCustomerCaseStatusAction } from './actions'
import { formatStatusLabel } from '@/lib/ui/format'
import AdminDisclosurePanel from '@/components/admin/ui/AdminDisclosurePanel'

export const dynamic = 'force-dynamic'

function isSupportCase(row: { source?: string | null; metadata?: Record<string, unknown> | null }) {
  return row.metadata?.support_case === true || String(row.source ?? '').startsWith('tenant_support_')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function CustomerCasesPage({ searchParams }: { searchParams: Promise<{ customer?: string; channel?: string }> }) {
  const context = await requireAdminPageKeyAccess('support.cases')
  const query = await searchParams
  const scope = await resolveAdminTenantReadScope(context)
  const canWrite = !scope.isPlatformAdmin && hasPermissionRequirement(context.permissions, { anyOf: ['cases.write'] })
  const [allCases, customers] = await Promise.all([
    listCustomerCases({ companyId: scope.companyId, limit: 200 }),
    canWrite && scope.companyId ? listTenantSupportCustomerOptions(scope.companyId) : Promise.resolve([]),
  ])
  const cases = allCases.filter(isSupportCase)
  const open = cases.filter((row) => !['resolved', 'closed', 'cancelled'].includes(row.status))
  const urgent = open.filter((row) => ['urgent', 'high'].includes(row.priority))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader title="Support" subtitle="Ert bolags supportärenden från API, kundportal och intern handläggning." userEmail={context.email} />
      <main className="space-y-4 p-4 lg:p-6">
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"><p className="min-w-0 break-words text-sm text-slate-600">Öppna supportärenden</p><p className="text-2xl font-semibold">{open.length}</p></div>
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"><p className="min-w-0 break-words text-sm text-amber-900">Hög/akut prioritet</p><p className="text-2xl font-semibold text-amber-950">{urgent.length}</p></div>
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"><p className="min-w-0 break-words text-sm text-slate-600">Totalt i supporthistorik</p><p className="text-2xl font-semibold">{cases.length}</p></div>
        </section>

        {canWrite && scope.companyId ? (
          <AdminDisclosurePanel id="new-case" title="Nytt supportärende" defaultOpen={Boolean(query.customer)} className="rounded-2xl border border-slate-200 bg-white p-4">
            <form action={createCustomerCaseFromFormAction} className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 [&_input]:min-w-0 [&_input]:w-full [&_select]:min-w-0 [&_select]:w-full [&_textarea]:min-w-0 [&_textarea]:w-full">
              <input type="hidden" name="expected_company_id" value={scope.companyId} />
              <select name="customer_id" required aria-label="Kund" defaultValue={customers.some((customer) => customer.id === query.customer) ? query.customer : ""} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="">Välj kund</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select>
              <select name="priority" aria-label="Prioritet" defaultValue="normal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="low">Låg</option><option value="normal">Normal</option><option value="high">Hög</option><option value="urgent">Akut</option>
              </select>
              <input name="title" required maxLength={180} aria-label="Rubrik" placeholder="Rubrik" className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2" />
              <select name="channel" defaultValue={query.channel === 'phone' ? 'phone' : 'admin'} aria-label="Kanal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="admin">Registrerat i OPS</option><option value="phone">Telefon</option>
              </select>
              <input name="category" aria-label="Kategori" placeholder="Kategori, t.ex. faktura eller avtal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              {/* One key per rendered form: a double submit reuses the same case instead of creating two. */}
              <input type="hidden" name="idempotency_key" value={randomUUID()} />
              <textarea name="description" aria-label="Beskrivning" rows={4} placeholder="Beskriv ärendet" className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2" />
              <button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white lg:col-span-2">Skapa supportärende</button>
            </form>
          </AdminDisclosurePanel>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><h2 className="text-lg font-semibold text-slate-950">Supportkö</h2><p className="mt-1 text-sm text-slate-600">Normal drift visas inte här. Endast uttryckliga supportärenden från tenantens kanaler.</p></div>
          <div className="mt-4 space-y-3">
            {cases.length === 0 ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga supportärenden i valt scope.</p> : null}
            {cases.map((row) => (
              <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 break-words">
                    {scope.companyId ? <Link href={`/admin/customer-cases/${row.id}`} className="font-semibold text-slate-950 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600">{row.title}</Link> : <span className="font-semibold text-slate-950" title="Välj bolaget för att öppna ärendet">{row.title}</span>}
                    <p className="mt-1 text-sm text-slate-600">{row.customer_name ?? row.customer_number ?? <CustomerName id={row.customer_id} />}</p>
                    {row.description ? <details className="mt-2 text-sm text-slate-700"><summary className="cursor-pointer font-medium">Beskrivning</summary><p className="mt-2 max-w-3xl whitespace-pre-wrap">{row.description}</p></details> : null}
                    <p className="mt-2 text-xs text-slate-500">{row.reason_category ?? 'support'} · {row.source ?? 'support'} · {formatDate(row.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{formatStatusLabel(row.priority)} · {formatStatusLabel(row.status)}</span>
                </div>
                {!['resolved', 'closed', 'cancelled'].includes(row.status) && canWrite ? (
                  <form action={updateCustomerCaseStatusAction} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="case_id" value={row.id} /><input type="hidden" name="expected_company_id" value={scope.companyId ?? ''} />
                    <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-600">
                      Ändra status
                      <select name="status" required defaultValue="" aria-label={`Ändra status för ${row.title}`} className="min-h-10 max-w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                        <option value="" disabled>Välj ny status</option>
                        {['action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'].map((status) => <option key={status} value={status}>{formatStatusLabel(status)}</option>)}
                      </select>
                    </label>
                    <button className="self-end rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Uppdatera</button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
