'use client'

import { useFormStatus } from 'react-dom'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  MeteringPointRow,
  PriceAreaRow,
} from '@/lib/masterdata/types'
import { saveMeteringPointAction } from '@/app/admin/customers/[id]/actions'

type MeteringPointFormProps = {
  customerId: string
  sites: CustomerSiteRow[]
  gridOwners: GridOwnerRow[]
  priceAreas: PriceAreaRow[]
  meteringPoint?: MeteringPointRow | null
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending ? 'Sparar...' : 'Spara mätpunkt'}
    </button>
  )
}

function Input({
  name,
  label,
  defaultValue,
  type = 'text',
}: {
  name: string
  label: string
  defaultValue?: string | null
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
        defaultValue={defaultValue ?? ''}
        className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
      />
    </label>
  )
}

export default function MeteringPointForm({
  customerId,
  sites,
  gridOwners,
  priceAreas,
  meteringPoint,
}: MeteringPointFormProps) {
  return (
    <form
      action={saveMeteringPointAction}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {meteringPoint ? 'Redigera mätpunkt' : 'Ny mätpunkt'}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Koppla mätpunkt till anläggning, nätägare och elområde för operativ drift.
        </p>
      </div>

      <input type="hidden" name="id" value={meteringPoint?.id ?? ''} />
      <input type="hidden" name="customer_id" value={customerId} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Anläggning
          </span>
          <select
            name="site_id"
            defaultValue={meteringPoint?.site_id ?? ''}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="">Välj anläggning</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_name} {site.facility_id ? `— ${site.facility_id}` : ''}
              </option>
            ))}
          </select>
        </label>

        <Input
          name="meter_point_id"
          label="Mätpunkts-ID"
          defaultValue={meteringPoint?.meter_point_id}
        />

        <Input
          name="site_facility_id"
          label="Anläggnings-ID på mätpunkten"
          defaultValue={meteringPoint?.site_facility_id}
        />

        <Input
          name="ediel_reference"
          label="EDIEL / mätpunktsreferens"
          defaultValue={meteringPoint?.ediel_reference}
        />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Status
          </span>
          <select
            name="status"
            defaultValue={meteringPoint?.status ?? 'draft'}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="draft">Draft</option>
            <option value="active">Aktiv</option>
            <option value="pending_validation">Pending validation</option>
            <option value="inactive">Inaktiv</option>
            <option value="closed">Stängd</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Mättyp
          </span>
          <select
            name="measurement_type"
            defaultValue={meteringPoint?.measurement_type ?? 'consumption'}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="consumption">Förbrukning</option>
            <option value="production">Produktion</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Avläsningsfrekvens
          </span>
          <select
            name="reading_frequency"
            defaultValue={meteringPoint?.reading_frequency ?? 'hourly'}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="hourly">Timvis</option>
            <option value="daily">Daglig</option>
            <option value="monthly">Månadsvis</option>
            <option value="manual">Manuell</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Nätägare
          </span>
          <select
            name="grid_owner_id"
            defaultValue={meteringPoint?.grid_owner_id ?? ''}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="">Välj nätägare</option>
            {gridOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Elområde
          </span>
          <select
            name="price_area_code"
            defaultValue={meteringPoint?.price_area_code ?? ''}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="">Välj elområde</option>
            {priceAreas.map((area) => (
              <option key={area.code} value={area.code}>
                {area.code} — {area.name}
              </option>
            ))}
          </select>
        </label>

        <Input
          name="start_date"
          label="Startdatum"
          type="date"
          defaultValue={meteringPoint?.start_date}
        />

        <Input
          name="end_date"
          label="Slutdatum"
          type="date"
          defaultValue={meteringPoint?.end_date}
        />
      </div>

      <label className="mt-4 inline-flex items-center gap-3">
        <input
          type="checkbox"
          name="is_settlement_relevant"
          defaultChecked={meteringPoint?.is_settlement_relevant ?? true}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span className="text-sm text-slate-700 dark:text-slate-200">
          Relevans för settlement / fakturaunderlag
        </span>
      </label>

      <div className="mt-6 flex items-center justify-end">
        <SubmitButton />
      </div>
    </form>
  )
}