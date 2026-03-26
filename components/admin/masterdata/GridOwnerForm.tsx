'use client'

import { useFormStatus } from 'react-dom'
import type { GridOwnerRow } from '@/lib/masterdata/types'
import { saveGridOwnerAction } from '@/app/admin/network-owners/actions'

type GridOwnerFormProps = {
  gridOwner?: GridOwnerRow | null
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? 'Sparar...' : 'Spara nätägare'}
    </button>
  )
}

function Input({
  name,
  label,
  defaultValue,
  required = false,
  type = 'text',
}: {
  name: string
  label: string
  defaultValue?: string | null
  required?: boolean
  type?: string
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ''}
        className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

export default function GridOwnerForm({ gridOwner }: GridOwnerFormProps) {
  return (
    <form
      action={saveGridOwnerAction}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {gridOwner ? 'Redigera nätägare' : 'Ny nätägare'}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Lägg in eller uppdatera nätägare med kod, EDIEL-id och kontaktuppgifter.
        </p>
      </div>

      <input type="hidden" name="id" value={gridOwner?.id ?? ''} />

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          name="name"
          label="Namn"
          required
          defaultValue={gridOwner?.name}
        />
        <Input
          name="owner_code"
          label="Kod"
          required
          defaultValue={gridOwner?.owner_code}
        />
        <Input
          name="ediel_id"
          label="EDIEL-id"
          defaultValue={gridOwner?.ediel_id}
        />
        <Input
          name="org_number"
          label="Org.nr"
          defaultValue={gridOwner?.org_number}
        />
        <Input
          name="contact_name"
          label="Kontaktperson"
          defaultValue={gridOwner?.contact_name}
        />
        <Input
          name="email"
          label="E-post"
          type="email"
          defaultValue={gridOwner?.email}
        />
        <Input
          name="phone"
          label="Telefon"
          defaultValue={gridOwner?.phone}
        />
        <Input
          name="country"
          label="Land"
          defaultValue={gridOwner?.country ?? 'SE'}
        />
        <Input
          name="address_line_1"
          label="Adressrad 1"
          defaultValue={gridOwner?.address_line_1}
        />
        <Input
          name="address_line_2"
          label="Adressrad 2"
          defaultValue={gridOwner?.address_line_2}
        />
        <Input
          name="postal_code"
          label="Postnummer"
          defaultValue={gridOwner?.postal_code}
        />
        <Input
          name="city"
          label="Ort"
          defaultValue={gridOwner?.city}
        />
      </div>

      <label className="mt-4 grid gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Intern anteckning
        </span>
        <textarea
          name="notes"
          rows={4}
          defaultValue={gridOwner?.notes ?? ''}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
        />
      </label>

      <label className="mt-4 inline-flex items-center gap-3">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={gridOwner?.is_active ?? true}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span className="text-sm text-slate-700 dark:text-slate-200">
          Aktiv nätägare
        </span>
      </label>

      <div className="mt-6 flex items-center justify-end">
        <SubmitButton />
      </div>
    </form>
  )
}