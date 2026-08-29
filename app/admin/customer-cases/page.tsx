import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { supabaseService } from '@/lib/supabase/service'
import { listCustomerCases } from '@/lib/customer-cases/db'
import { createCustomerCaseFromFormAction, updateCustomerCaseStatusAction } from './actions'

export const dynamic = 'force-dynamic'

type CustomerOption = { id: string; label: string }

function isSupportCase(row: { source?: string | null; metadata?: Record<string, unknown> | null }) {
  return row.metadata?.support_case === true || String(row.source ?? '').startsWith('tenant_support_')
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function customerOptions(companyId: string | null): Promise<CustomerOption[]> {
  let query = supabaseService
    .from('customers')
    .select('id,customer_number,full_name,first_name,last_name,company_name')
    .order('created_at', { ascending: false })
    .limit(200)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => {
    const person = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    const name = row.full_name ?? person || row.company_name ?? row.customer_number ?? row.id
    return { id: String(row.id), label: `${name}${row.customer_number ? ` · ${row.customer_number}` : ''}` }
  })
}

export default async function CustomerCasesPage() {
  const context = await requireAdminPageKeyAccess('operations.tasks')
  const scope = await resolveAdminTenantReadScope(context)
  const [allCases, customers] = await Promise.all([
    listCustomerCases({ companyId: scope.companyId, limit: 200 }),
    customerOptions(scope.companyId),
  ])
  const cases = allCases.filter(isSupportCase)
  const open = cases.filter((row) => !['resolved', 'closed', 'cancelled'].includes(row.status))
  const urgent = open.filter((row) => ['urgent', 'high'].includes(row.priority))

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Support"
        subtitle="Tenant-isolerade supportärenden från API, kundportal och intern handläggning."
        userEmail={context.email}
      />
      <main className="space-y-6 p-6 lg:p-8">
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Öppna supportärenden</p><p className="mt-2 text-3xl font-semibold">{open.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Hög/akut prioritet</p><p className="mt-2 text-3xl font-semibold">{urgent.length}</p></div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-600">Totalt i supporthistorik</p><p className="mt-2 text-3xl font-semibold">{cases.length}</p></div>
        </section>

        {!scope.isPlatformAdmin && scope.companyId ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Nytt supportärende</h2>
            <form action={createCustomerCaseFromFormAction} className="mt-4 grid gap-3 lg:grid-cols-2">
              <select name="customer_id" required className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="">Välj kund</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.label}</option>)}
              </select>
              <select name="priority" defaultValue="normal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                <option value="low">Låg</option><option value="normal">Normal</option><option value="high">Hög</option><option value="urgent">Akut</option>
              </select>
              <input name="title" required maxLength={180} placeholder="Rubrik" className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2" />
              <input name="category" placeholder="Kategori, t.ex. faktura eller avtal" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input name="idempotency_key" placeholder="Extern referens (valfri)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <textarea name="description" rows={4} placeholder="Beskriv ärendet" className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2" />
              <button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white lg:col-span-2">Skapa supportärende</button>
            </form>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Supportkö</h2>
            <p className="mt-1 text-sm text-slate-600">Normal drift visas inte här. Endast uttryckliga supportärenden från tenantens kanaler.</p>
          </div>
          <div className="mt-5 space-y-3">
            {cases.length === 0 ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Inga supportärenden i valt scope.</p> : null}
            {cases.map((row) => (
              <article key={row.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{row.title}</p>
                    <p className="mt-1 text-sm text-slate-600">{row.customer_name ?? row.customer_number ?? row.customer_id}</p>
                    {row.description ? <p className="mt-2 max-w-3xl text-sm text-slate-700">{row.description}</p> : null}
                    <p className="mt-2 text-xs text-slate-500">{row.reason_category ?? 'support'} · {row.source ?? 'support'} · {formatDate(row.created_at)}</p>
                  </div>
                  <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{row.priority} · {row.status}</span>
                </div>
                {!['resolved', 'closed', 'cancelled'].includes(row.status) && !scope.isPlatformAdmin ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {['action_required', 'awaiting_external_response', 'manual_follow_up', 'resolved', 'closed'].map((status) => (
                      <form key={status} action={updateCustomerCaseStatusAction}>
                        <input type="hidden" name="case_id" value={row.id} />
                        <input type="hidden" name="status" value={status} />
                        <button className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{status}</button>
                      </form>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
