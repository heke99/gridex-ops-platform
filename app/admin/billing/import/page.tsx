import AdminHeader from '@/components/admin/AdminHeader'
import { requireAdminPageKeyAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { importBillingUnderlayFileAction } from './actions'

export const dynamic = 'force-dynamic'

const example = `customer_id;site_id;metering_point_id;underlay_year;underlay_month;total_kwh;total_sek_ex_vat;currency;source_system
REPLACE_CUSTOMER_UUID;;REPLACE_METERING_POINT_UUID;2026;4;1250;875.50;SEK;partner_file`

export default async function BillingImportPage({ searchParams }: { searchParams?: Promise<{ status?: string; message?: string }> }) {
  const admin = await requireAdminPageKeyAccess('billing.import')
  const scope = await getOperationalCompanyScope(admin.userId)
  const companyId = scope.companyId
  const notice = searchParams ? await searchParams : {}

  const { data: batches } = companyId
    ? await supabaseService
        .from('billing_import_batches')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(20)
    : { data: [] }

  return (
    <div className="min-h-screen">
      <AdminHeader
        title="Importera faktureringsunderlag"
        subtitle="Läs in CSV/semikolonfiler, normalisera rader och flagga fel utan att stoppa hela importen."
        userEmail={admin.email}
      />

      <div className="space-y-6 p-8">
        {notice?.message ? (
          <div className={`rounded-3xl border p-5 text-sm font-semibold ${notice.status === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            {notice.message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Operativt bolag</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">{scope.companyName ?? 'Bolagskoppling saknas'}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">Importerade rader kopplas alltid till tenantens company_id. Felaktiga rader sparas som blockerade import rows för uppföljning.</p>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <form action={importBillingUnderlayFileAction} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Ny import</h2>
            <p className="mt-2 text-sm leading-6 text-slate-700">Filen ska innehålla customer_id och period. UUID för site_id/metering_point_id används när det finns, annars sparas externa referenser i payload för manuell matchning.</p>
            <div className="mt-5 space-y-4">
              <input name="billing_file" type="file" accept=".csv,.txt" className="block w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" disabled={!companyId} />
              <textarea name="billing_text" rows={8} placeholder={example} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm" disabled={!companyId} />
              <button className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!companyId}>Importera underlag</button>
            </div>
          </form>

          <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Senaste importer</h2>
            <div className="mt-4 space-y-3">
              {(batches ?? []).length === 0 ? <p className="text-sm text-slate-600">Inga importer finns ännu.</p> : (batches ?? []).map((batch: { id: string; file_name: string | null; status: string; rows_total: number; rows_imported: number; rows_failed: number; created_at: string }) => (
                <article key={batch.id} className="rounded-2xl border border-slate-200 p-4 text-sm">
                  <div className="font-semibold text-slate-950">{batch.file_name ?? 'Inklistrat underlag'}</div>
                  <div className="mt-1 text-xs text-slate-500">{batch.status} · {new Date(batch.created_at).toLocaleString('sv-SE')}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-700">
                    <span>Total {batch.rows_total}</span>
                    <span>Importerade {batch.rows_imported}</span>
                    <span>Fel {batch.rows_failed}</span>
                  </div>
                </article>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </div>
  )
}
