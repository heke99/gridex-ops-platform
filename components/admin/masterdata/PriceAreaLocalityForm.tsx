'use client'

import { useFormStatus } from 'react-dom'
import { savePriceAreaLocalityAction } from '@/app/admin/price-area-localities/actions'
import type { PriceAreaLocalityRow } from '@/lib/masterdata/types'

type Props = {
  locality?: PriceAreaLocalityRow | null
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? 'Sparar...' : 'Spara ort'}
    </button>
  )
}

function Input({
  name,
  label,
  defaultValue,
}: {
  name: string
  label: string
  defaultValue?: string | null
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <input
        name={name}
        defaultValue={defaultValue ?? ''}
        className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

export default function PriceAreaLocalityForm({ locality }: Props) {
  return (
    <form
      action={savePriceAreaLocalityAction}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {locality ? 'Redigera ort' : 'Ny ort'}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Lägg till städer/orter per elområde.
        </p>
      </div>

      <input type="hidden" name="id" value={locality?.id ?? ''} />

      <div className="grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Elområde
          </span>
          <select
            name="price_area_code"
            defaultValue={locality?.price_area_code ?? 'SE4'}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="SE1">SE1</option>
            <option value="SE2">SE2</option>
            <option value="SE3">SE3</option>
            <option value="SE4">SE4</option>
          </select>
        </label>

        <Input
          name="locality_name"
          label="Ort / stad"
          defaultValue={locality?.locality_name}
        />
        <Input
          name="municipality"
          label="Kommun"
          defaultValue={locality?.municipality}
        />
        <Input
          name="postal_code"
          label="Postnummer"
          defaultValue={locality?.postal_code}
        />

        <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            name="is_active"
            value="true"
            defaultChecked={locality?.is_active ?? true}
            className="h-4 w-4"
          />
          Aktiv ort
        </label>
      </div>

      <div className="mt-6">
        <SubmitButton />
      </div>
    </form>
  )
}