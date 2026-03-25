import AdminHeader from '@/components/admin/AdminHeader'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePermissionServer } from '@/lib/auth/requirePermissionServer'
import { getCustomerById } from '@/lib/customers/getCustomerById'
import type { CustomerAddressRow, CustomerNoteRow, SiteRow } from '@/types/customers'

export const dynamic = 'force-dynamic'

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requirePermissionServer('masterdata.read')
  const { id } = await params
  const data = await getCustomerById(id)

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="min-h-screen">
      <AdminHeader
        title={data.customer.full_name || data.customer.company_name || 'Kund'}
        subtitle="Kundkort med masterdata, anläggningar och interna anteckningar."
        userEmail={user?.email ?? null}
      />

      <div className="grid gap-6 p-8 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Grunddata</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Info label="Kundtyp" value={data.customer.customer_type} />
              <Info label="Status" value={data.customer.status} />
              <Info label="E-post" value={data.customer.email} />
              <Info label="Telefon" value={data.customer.phone} />
              <Info label="Personnummer" value={data.customer.personal_number} />
              <Info label="Org.nr" value={data.customer.org_number} />
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Anläggningar</h2>
            <div className="mt-4 space-y-3">
              {data.sites.length === 0 ? (
                <p className="text-sm text-slate-500">Inga anläggningar ännu.</p>
              ) : (
                data.sites.map((site: SiteRow) => (
                  <div key={site.id} className="rounded-2xl border border-slate-200 p-4">
                    <p className="font-medium text-slate-900">
                      {site.nickname || site.facility_name || 'Anläggning'}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Status: {site.status} • Typ: {site.site_type}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Nätägare: {site.grid_owners?.name || '-'} • Elområde: {site.price_areas?.code || '-'}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Adresser</h2>
            <div className="mt-4 space-y-3">
              {data.addresses.length === 0 ? (
                <p className="text-sm text-slate-500">Inga adresser ännu.</p>
              ) : (
                data.addresses.map((address: CustomerAddressRow) => (
                  <div key={address.id} className="rounded-2xl border border-slate-200 p-4">
                    <p className="font-medium text-slate-900">{address.type}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {address.street_1}
                      {address.street_2 ? `, ${address.street_2}` : ''}
                    </p>
                    <p className="text-sm text-slate-500">
                      {address.postal_code} {address.city}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">Interna anteckningar</h2>
            <div className="mt-4 space-y-3">
              {data.notes.length === 0 ? (
                <p className="text-sm text-slate-500">Inga anteckningar ännu.</p>
              ) : (
                data.notes.map((note: CustomerNoteRow) => (
                  <div key={note.id} className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-sm text-slate-700">{note.note}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {new Date(note.created_at).toLocaleString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value || '-'}</p>
    </div>
  )
}