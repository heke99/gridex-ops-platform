import Link from 'next/link'
import AdminHeader from '@/components/admin/AdminHeader'
import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { listCleanupCustomerCandidates } from '@/lib/platform/dataCleanup'
import {
  platformArchiveCustomerAction,
  platformHardDeleteTestCustomerAction,
  platformMarkCustomerAsTestDataAction,
} from './actions'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function ReasonBadge({ reason }: { reason: string }) {
  const tone = reason.includes('test') || reason.includes('exempel')
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : reason.includes('ofullständig')
      ? 'border-sky-200 bg-sky-50 text-sky-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${tone}`}>{reason.replaceAll('_', ' ')}</span>
}

export default async function PlatformDataCleanupPage() {
  const admin = await requirePlatformAdminAccess()
  const rows = await listCleanupCustomerCandidates()
  const canDelete = rows.filter((row) => row.canHardDelete).length
  const protectedRows = rows.length - canDelete

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminHeader
        title="Datahantering"
        subtitle="Säker hantering av testkunder, testanläggningar och arkiverade poster. Verkliga kunder ska arkiveras eller anonymiseras, inte raderas."
        userEmail={admin.email}
        workspaceMode="platform"
      />

      <main className="space-y-6 p-4 sm:p-6 xl:p-8">
        <section className="rounded-[2rem] border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-800">Platform admin</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Rensa testdata utan att skada produktion</h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-700">
                Permanent radering är endast för testkunder eller felregistreringar som saknar skyddad historik. Kunder med avtal, fakturor, Ediel-meddelanden, leverantörsbyte eller partnerexport ska arkiveras.
              </p>
            </div>
            <Link href="/admin/platform/usage" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-800 hover:bg-emerald-100">
              Visa usage
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm font-bold text-slate-600">Kandidater</div><div className="mt-2 text-3xl font-black text-slate-950">{rows.length}</div></div>
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm"><div className="text-sm font-bold text-emerald-800">Kan raderas säkert</div><div className="mt-2 text-3xl font-black text-emerald-950">{canDelete}</div></div>
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm"><div className="text-sm font-bold text-amber-800">Ska arkiveras</div><div className="mt-2 text-3xl font-black text-amber-950">{protectedRows}</div></div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-lg font-black text-slate-950">Kunder att granska</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">Testdata visas här för förhandsgranskning innan arkivering eller permanent radering.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.14em] text-slate-600">
                <tr>
                  <th className="px-6 py-4">Kund</th>
                  <th className="px-6 py-4">Orsak</th>
                  <th className="px-6 py-4">Skyddad historik</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Skapad</th>
                  <th className="px-6 py-4">Åtgärder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const protectedCount = row.protectedContractCount + row.switchCount + row.billingUnderlayCount + row.invoiceCount + row.edielMessageCount
                  return (
                    <tr key={row.customerId} className="align-top">
                      <td className="px-6 py-4">
                        <Link href={`/admin/customers/${row.customerId}`} className="font-black text-emerald-800 hover:underline">{row.customerName}</Link>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{row.customerNumber ?? 'Saknar kundnummer'} · {row.email ?? 'Saknar e-post'}</div>
                      </td>
                      <td className="px-6 py-4"><ReasonBadge reason={row.cleanupReason} /></td>
                      <td className="px-6 py-4">
                        <div className="font-black text-slate-950">{protectedCount}</div>
                        <div className="text-xs font-semibold text-slate-500">Avtal {row.contractCount} · Switch {row.switchCount} · Faktura {row.invoiceCount} · Ediel {row.edielMessageCount}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {row.isTestData ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">Testdata</span> : null}
                          {row.archivedAt ? <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">Arkiverad</span> : null}
                          {!row.isTestData && !row.archivedAt ? <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">{row.status ?? 'okänd'}</span> : null}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{formatDate(row.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex min-w-[260px] flex-col gap-2">
                          {!row.isTestData ? (
                            <form action={platformMarkCustomerAsTestDataAction}>
                              <input type="hidden" name="customer_id" value={row.customerId} />
                              <input type="hidden" name="reason" value={`Markerad från datahantering: ${row.cleanupReason}`} />
                              <button className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800 hover:bg-amber-100">Markera som testdata</button>
                            </form>
                          ) : null}
                          {!row.archivedAt ? (
                            <form action={platformArchiveCustomerAction}>
                              <input type="hidden" name="customer_id" value={row.customerId} />
                              <input type="hidden" name="archive_reason" value={`Arkiverad från datahantering: ${row.cleanupReason}`} />
                              <button className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-800 hover:bg-slate-50">Arkivera</button>
                            </form>
                          ) : null}
                          {row.canHardDelete && row.isTestData ? (
                            <form action={platformHardDeleteTestCustomerAction}>
                              <input type="hidden" name="customer_id" value={row.customerId} />
                              <button className="w-full rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white hover:bg-red-800">Radera testkund permanent</button>
                            </form>
                          ) : (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">Permanent radering spärrad</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 ? <tr><td colSpan={6} className="px-6 py-10 text-center text-slate-600">Inga cleanup-kandidater hittades.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
