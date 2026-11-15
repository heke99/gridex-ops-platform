import type { ComponentProps } from 'react'
import { formatStatusLabel } from '@/lib/ui/format'
import AdminDisclosurePanel from '@/components/admin/ui/AdminDisclosurePanel'
import CustomerProfileCard from './CustomerProfileCard'

type Profile = ComponentProps<typeof CustomerProfileCard>['customer']
type Customer = Profile & { full_name?: string | null; customer_number?: string | null }
/** Explicit allowlist for the profile's client boundary. */
export function projectCustomerProfile(customer: Profile, isPlatformAdmin = false): Profile {
  return {
    id: customer.id,
    customer_type: customer.customer_type,
    status: customer.status,
    first_name: customer.first_name,
    last_name: customer.last_name,
    company_name: customer.company_name,
    personal_number: customer.personal_number,
    org_number: customer.org_number,
    email: customer.email,
    phone: customer.phone,
    apartment_number: customer.apartment_number,
    updated_at: customer.updated_at,
    archived_at: customer.archived_at,
    is_test_data: customer.is_test_data,
    ...(isPlatformAdmin ? {
      moved_out_at: customer.moved_out_at,
      lifecycle_closed_at: customer.lifecycle_closed_at,
      lifecycle_status_reason: customer.lifecycle_status_reason,
      archive_reason: customer.archive_reason,
      data_retention_note: customer.data_retention_note,
    } : {}),
  }
}
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-slate-600">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-950">{value || 'Inte angivet'}</dd></div>
}
export default function CustomerProfileSummary({ customer, canWrite = false, isPlatformAdmin = false }: { customer: Customer; canWrite?: boolean; isPlatformAdmin?: boolean }) {
  const privateCustomer = customer.customer_type === 'private'
  const businessCustomer = ['business', 'association'].includes(customer.customer_type ?? '')
  const typeLabels: Record<string, string> = { private: 'Privatkund', business: 'Företag', association: 'Förening' }
  return <section className="min-w-0 space-y-3">
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Kunduppgifter</h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {customer.customer_number ? <Field label="Kundnummer" value={customer.customer_number} /> : null}
        <Field label="Kundtyp" value={typeLabels[customer.customer_type ?? ''] ?? 'Kundtyp behöver kontrolleras'} />
        <Field label="Status" value={formatStatusLabel(customer.status, 'Status behöver kontrolleras', 'Status behöver kontrolleras')} />
        {businessCustomer || customer.company_name ? <Field label={customer.customer_type === 'association' ? 'Förening' : 'Företag'} value={customer.company_name} /> : null}
        <Field label={businessCustomer ? 'Kontaktperson' : 'Namn'} value={businessCustomer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') : customer.full_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ')} />
        {privateCustomer || (!businessCustomer && customer.personal_number) ? <Field label="Personnummer" value={customer.personal_number} /> : null}
        {businessCustomer || (!privateCustomer && customer.org_number) ? <Field label="Organisationsnummer" value={customer.org_number} /> : null}
        <Field label="E-post" value={customer.email} />
        <Field label="Telefon" value={customer.phone} />
        {customer.apartment_number ? <Field label="Lägenhetsnummer" value={customer.apartment_number} /> : null}
      </dl>
      {customer.status === 'archived' || customer.archived_at ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">Kunden är arkiverad. Profiluppgifterna är låsta.</p> : null}
      {customer.is_test_data ? <p className="mt-3 text-sm text-amber-900">Testkund</p> : null}
    </div>
    {canWrite ? <AdminDisclosurePanel id="edit-customer-profile" title="Ändra kunduppgifter" className="rounded-2xl border border-slate-200 bg-white p-4">
      <CustomerProfileCard customer={projectCustomerProfile(customer, isPlatformAdmin)} showLifecycleTools={isPlatformAdmin} />
    </AdminDisclosurePanel> : null}
  </section>
}
