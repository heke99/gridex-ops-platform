import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { hasPermissionRequirement } from '@/lib/admin/accessModel'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { resolveAdminTenantReadScope } from '@/lib/tenant/adminScope'
import { listDuplicateCustomerGroups } from '@/lib/customers/duplicates'
import { mergeCustomersAction } from './actions'

export const dynamic = 'force-dynamic'

function customerName(row: { full_name: string | null; first_name: string | null; last_name: string | null; company_name: string | null; email: string | null }) {
  return row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.company_name || row.email || 'Kund'
}

// Personal identity numbers are never shown in full in lists.
function maskIdentity(value: string | null): string | null {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length < 4) return null
  return `••••••••-${digits.slice(-4)}`
}

export default async function CustomerDuplicatesPage() {
  const admin = await requireAdminPageKeyAccess('customers.list')
  const scope = await resolveAdminTenantReadScope(admin)
  const loadedGroups = await listDuplicateCustomerGroups(scope.companyId)
  const groups = scope.isPlatformAdmin ? loadedGroups : loadedGroups.filter(group => group.candidates.every(candidate => candidate.company_id === scope.companyId))
  const canMerge = scope.isPlatformAdmin || hasPermissionRequirement(admin.permissions, { allOf: ['customers.write'] })

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Möjliga kunddubbletter"
        subtitle="Granska kunder som kan ha registrerats flera gånger."
        userEmail={admin.email}
        workspaceName={scope.isPlatformAdmin ? 'Gridex Platform' : scope.companyName}
        workspaceMode={scope.isPlatformAdmin ? 'platform' : 'tenant'}
      />
      <main className="min-w-0 space-y-4 p-4 lg:p-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Möjliga dubbletter</h2>
              <p className="mt-1 text-sm text-slate-700">Systemet föreslår grupper utifrån e-post, personnummer, organisationsnummer och namn inom ert bolag.</p>
            </div>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{groups.length === 1 ? '1 visad grupp' : `${groups.length} visade grupper`}</span>
          </div>
        </section>

        {groups.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">Inga tydliga dubbletter hittades i valt bolag.</section>
        ) : (
          <section role="region" aria-label="Möjliga kunddubbletter" tabIndex={0} className="grid max-h-[44rem] items-start gap-3 overflow-y-auto rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 xl:grid-cols-2">
            {groups.map((group, groupIndex) => (
              <article key={`${group.reason}-${group.groupKey}`} className="min-w-0 break-words rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">Grupp {groupIndex + 1}: {group.reason}</h3>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">{group.candidates.length} kunder</span>
                </div>
                <div role="region" aria-label={`Kunder i grupp ${groupIndex + 1}: ${group.reason}`} tabIndex={0} className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
                  {group.candidates.map((candidate) => (
                    <div key={candidate.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="font-semibold text-slate-950">{customerName(candidate)}</div>
                      <div className="mt-1 grid gap-1 text-xs text-slate-600">
                        <div>Kundnr: {candidate.customer_number ?? '—'}</div>
                        <div>E-post: {candidate.email ?? '—'}</div>
                        <div>ID/orgnr: {maskIdentity(candidate.personal_number) ?? candidate.org_number ?? '—'}</div>
                      </div>
                      <Link href={`/admin/customers/${candidate.id}`} className="mt-3 inline-flex rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">Öppna kundkort</Link>
                    </div>
                  ))}
                </div>
                {canMerge && group.candidates.length > 1 && group.candidates[0].company_id && group.candidates.every(candidate => candidate.company_id === group.candidates[0].company_id) ? (
                  <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <summary className="cursor-pointer font-semibold">Slå ihop kunder</summary>
                    <form action={mergeCustomersAction} className="mt-3">
                      <p className="text-xs leading-5">Välj kunden som ska behållas och vilka kunder som ska slås ihop med den. Anläggningar, avtal och övriga kunduppgifter förs över till kunden som behålls.</p>
                      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto rounded-xl" role="region" aria-label={`Kunder att slå ihop i grupp ${groupIndex + 1}`} tabIndex={0}>
                        {group.candidates.map((candidate, index) => (
                          <div key={`${group.groupKey}:merge:${candidate.id}`} className="min-w-0 rounded-xl border border-amber-200 bg-white p-3 text-xs text-slate-800">
                            <p className="break-words font-semibold">{customerName(candidate)}</p>
                            <div className="mt-2 flex flex-wrap gap-3">
                              <label className="flex items-center gap-2"><input type="radio" name="primaryCustomerId" value={candidate.id} defaultChecked={index === 0} aria-label={`Behåll ${customerName(candidate)} som huvudkund`} />Behåll som huvudkund</label>
                              <label className="flex items-center gap-2"><input type="checkbox" name="sourceCustomerIds" value={candidate.id} defaultChecked={index !== 0} aria-label={`Slå ihop ${customerName(candidate)} med huvudkunden`} />Slå ihop med huvudkunden</label>
                            </div>
                          </div>
                        ))}
                      </div>
                      <label className="mt-3 grid min-w-0 gap-1 text-xs font-semibold">Orsak till sammanslagningen<input name="reason" required placeholder="Beskriv varför kunderna ska slås ihop" className="min-w-0 w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900" /></label>
                      <button className="mt-3 rounded-xl bg-amber-800 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-900">Slå ihop markerade kunder</button>
                    </form>
                  </details>
                ) : null}
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}
