'use client'

import { saveElectricitySupplierAction } from '@/app/admin/electricity-suppliers/actions'
import type { ElectricitySupplierRow } from '@/lib/masterdata/types'
import { useFormStatus } from 'react-dom'

type Props = {
  supplier?: ElectricitySupplierRow | null
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? 'Sparar...' : 'Spara leverantör'}
    </button>
  )
}

function Input({
  name,
  label,
  defaultValue,
  type = 'text',
  required = false,
}: {
  name: string
  label: string
  defaultValue?: string | null
  type?: string
  required?: boolean
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        required={required}
        className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

export default function ElectricitySupplierForm({ supplier }: Props) {
  return (
    <form
      action={saveElectricitySupplierAction}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {supplier ? 'Redigera elleverantör' : 'Ny elleverantör'}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Lägg in namn, org.nr, kontaktuppgifter och valfria marknadskoder.
        </p>
      </div>

      <input type="hidden" name="id" value={supplier?.id ?? ''} />

      <div className="grid gap-4">
        <Input name="name" label="Namn" defaultValue={supplier?.name} required />
        <Input name="org_number" label="Organisationsnummer" defaultValue={supplier?.org_number} />
        <Input name="market_actor_code" label="Market actor code" defaultValue={supplier?.market_actor_code} />
        <Input name="ediel_id" label="EDIEL-id" defaultValue={supplier?.ediel_id} />
        <Input name="contact_name" label="Kontaktperson" defaultValue={supplier?.contact_name} />
        <Input name="email" label="E-post" type="email" defaultValue={supplier?.email} />
        <Input name="phone" label="Telefon" defaultValue={supplier?.phone} />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Notering
          </span>
          <textarea
            name="notes"
            rows={4}
            defaultValue={supplier?.notes ?? ''}
            className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="is_active"
            value="true"
            defaultChecked={supplier?.is_active ?? true}
            className="h-4 w-4"
          />
          Aktiv leverantör
        </label>
      </div>

      <div className="mt-6">
        <SubmitButton />
      </div>
    </form>
  )
}