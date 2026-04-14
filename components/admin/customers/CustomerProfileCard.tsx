import { saveCustomerProfileAction } from '@/app/admin/customers/[id]/profile-actions'

type CustomerProfileCardProps = {
  customer: {
    id: string
    customer_type: string | null
    status: string | null
    first_name: string | null
    last_name: string | null
    company_name: string | null
    personal_number: string | null
    org_number: string | null
    email: string | null
    phone: string | null
    apartment_number: string | null
  }
}

export default function CustomerProfileCard({
  customer,
}: CustomerProfileCardProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Kundprofil
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Redigera kundens kärndata. Sparar direkt till customers-tabellen och synkar även primär kontakt.
        </p>
      </div>

      <form action={saveCustomerProfileAction} className="grid gap-4 md:grid-cols-2">
        <input type="hidden" name="customer_id" value={customer.id} />

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Kundtyp</span>
          <select
            name="customer_type"
            defaultValue={customer.customer_type ?? 'private'}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="private">Privat</option>
            <option value="business">Företag</option>
            <option value="association">Förening</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Status</span>
          <select
            name="status"
            defaultValue={customer.status ?? 'draft'}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="draft">Draft</option>
            <option value="pending_verification">Pending verification</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="moved">Moved</option>
            <option value="terminated">Terminated</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Förnamn / kontaktperson</span>
          <input
            name="first_name"
            defaultValue={customer.first_name ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Efternamn / kontaktperson</span>
          <input
            name="last_name"
            defaultValue={customer.last_name ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Företags- / föreningsnamn</span>
          <input
            name="company_name"
            defaultValue={customer.company_name ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Personnummer</span>
          <input
            name="personal_number"
            defaultValue={customer.personal_number ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Organisationsnummer</span>
          <input
            name="org_number"
            defaultValue={customer.org_number ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">E-post</span>
          <input
            name="email"
            type="email"
            defaultValue={customer.email ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Telefon</span>
          <input
            name="phone"
            defaultValue={customer.phone ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Lägenhetsnummer</span>
          <input
            name="apartment_number"
            defaultValue={customer.apartment_number ?? ''}
            className="h-11 rounded-2xl border border-slate-300 bg-white px-4 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <div className="md:col-span-2 flex justify-end">
          <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
            Spara kundprofil
          </button>
        </div>
      </form>
    </section>
  )
}