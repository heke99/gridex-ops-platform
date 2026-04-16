'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type {
  CustomerSiteRow,
  GridOwnerRow,
  PriceAreaRow,
} from '@/lib/masterdata/types'
import { saveCustomerSiteAction } from '@/app/admin/customers/[id]/actions'

type CustomerSiteFormProps = {
  customerId: string
  gridOwners: GridOwnerRow[]
  priceAreas: PriceAreaRow[]
  site?: CustomerSiteRow | null
  cancelHref?: string
}

type SiteFlowType = 'switch' | 'move_in' | 'move_out_takeover'

function SubmitButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
    >
      {pending
        ? 'Sparar...'
        : isEditing
          ? 'Spara ändringar'
          : 'Spara anläggning'}
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

function inferFlowType(site?: CustomerSiteRow | null): SiteFlowType {
  if (!site) return 'switch'

  const hasMovedFromData = Boolean(
    site.moved_from_street ||
      site.moved_from_postal_code ||
      site.moved_from_city ||
      site.moved_from_supplier_name
  )

  if (hasMovedFromData) {
    return 'move_in'
  }

  return 'switch'
}

function gridOwnerOptionLabel(owner: GridOwnerRow): string {
  const parts = [owner.name]

  if (owner.owner_code?.trim()) {
    parts.push(`kod: ${owner.owner_code}`)
  }

  if (owner.ediel_id?.trim()) {
    parts.push(`EDIEL: ${owner.ediel_id}`)
  }

  if (!owner.is_active) {
    parts.push('INAKTIV')
  }

  return parts.join(' • ')
}

export default function CustomerSiteForm({
  customerId,
  gridOwners,
  priceAreas,
  site,
  cancelHref,
}: CustomerSiteFormProps) {
  const isEditing = Boolean(site)
  const [siteFlowType, setSiteFlowType] = useState<SiteFlowType>(inferFlowType(site))

  const activeGridOwners = useMemo(
    () => gridOwners.filter((owner) => owner.is_active),
    [gridOwners]
  )

  const inactiveGridOwners = useMemo(
    () => gridOwners.filter((owner) => !owner.is_active),
    [gridOwners]
  )

  const selectedGridOwner =
    gridOwners.find((owner) => owner.id === (site?.grid_owner_id ?? '')) ?? null

  const flowSummary = useMemo(() => {
    if (siteFlowType === 'move_in') {
      return 'Inflytt. Flyttdatum och ny adress ska vara ifyllda. Flyttar-från-fält kan användas för tidigare adress och leverantör.'
    }

    if (siteFlowType === 'move_out_takeover') {
      return 'Övertag vid utflytt. Övertagsdatum och adress ska vara ifyllda. Flyttar-från-fält kan användas när övertaget behöver extra historik.'
    }

    return 'Vanligt leverantörsbyte. Flyttar-från-fält rensas bort vid sparning så att gammal flyttdata inte ligger kvar.'
  }, [siteFlowType])

  const moveDateLabel =
    siteFlowType === 'move_in'
      ? 'Inflyttningsdatum'
      : siteFlowType === 'move_out_takeover'
        ? 'Övertagsdatum'
        : 'Önskat startdatum'

  const currentSupplierLabel =
    siteFlowType === 'move_in'
      ? 'Nuvarande elleverantör på nya anläggningen'
      : siteFlowType === 'move_out_takeover'
        ? 'Nuvarande elleverantör på anläggningen'
        : 'Nuvarande elleverantör'

  const requiresMoveFields =
    siteFlowType === 'move_in' || siteFlowType === 'move_out_takeover'

  return (
    <form
      action={saveCustomerSiteAction}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isEditing ? 'Redigera anläggning' : 'Ny anläggning'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Lägg till eller uppdatera kundens anläggning med nätägare, elområde och operativa uppgifter.
          </p>
        </div>

        {isEditing && cancelHref ? (
          <Link
            href={cancelHref}
            className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Avbryt redigering
          </Link>
        ) : null}
      </div>

      <input type="hidden" name="id" value={site?.id ?? ''} />
      <input type="hidden" name="customer_id" value={customerId} />

      <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
        <div className="font-semibold text-slate-900 dark:text-white">
          Flödeslogik för anläggningen
        </div>
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Flöde
            </span>
            <select
              name="site_flow_type"
              value={siteFlowType}
              onChange={(event) => setSiteFlowType(event.target.value as SiteFlowType)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
            >
              <option value="switch">Byte av leverantör</option>
              <option value="move_in">Inflytt / flytt</option>
              <option value="move_out_takeover">Övertag vid utflytt</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{flowSummary}</p>
      </div>

      <div className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              Registerkopplingar
            </div>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Saknas rätt nätägare eller elleverantör? Lägg upp eller redigera dem i registren och kom sedan tillbaka hit.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/network-owners"
              className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Nätägare
            </Link>
            <Link
              href="/admin/electricity-suppliers"
              className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Elleverantörer
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          name="site_name"
          label="Anläggningsnamn"
          defaultValue={site?.site_name}
          required
        />

        <Input
          name="facility_id"
          label="Anläggnings-ID"
          defaultValue={site?.facility_id}
        />

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Typ
          </span>
          <select
            name="site_type"
            defaultValue={site?.site_type ?? 'consumption'}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="consumption">Förbrukning</option>
            <option value="production">Produktion</option>
            <option value="mixed">Mixed</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Status
          </span>
          <select
            name="status"
            defaultValue={site?.status ?? 'draft'}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="draft">Draft</option>
            <option value="active">Aktiv</option>
            <option value="pending_move">Pending move</option>
            <option value="inactive">Inaktiv</option>
            <option value="closed">Stängd</option>
          </select>
        </label>

        <label className="grid gap-2 md:col-span-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Nätägare
          </span>
          <select
            name="grid_owner_id"
            defaultValue={site?.grid_owner_id ?? ''}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
          >
            <option value="">Välj nätägare</option>

            {activeGridOwners.length > 0 ? (
              <optgroup label="Aktiva nätägare">
                {activeGridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {gridOwnerOptionLabel(owner)}
                  </option>
                ))}
              </optgroup>
            ) : null}

            {inactiveGridOwners.length > 0 ? (
              <optgroup label="Inaktiva nätägare">
                {inactiveGridOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {gridOwnerOptionLabel(owner)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
            {selectedGridOwner ? (
              <>
                Vald nätägare: <span className="font-medium text-slate-900 dark:text-white">{selectedGridOwner.name}</span>
                {selectedGridOwner.owner_code ? ` • kod ${selectedGridOwner.owner_code}` : ''}
                {selectedGridOwner.ediel_id ? ` • EDIEL ${selectedGridOwner.ediel_id}` : ''}
                {!selectedGridOwner.is_active ? ' • INAKTIV' : ''}
              </>
            ) : (
              <>
                Välj nätägare här. Om rätt nätägare saknas går du till registret och lägger upp den först.
              </>
            )}
          </div>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Elområde
          </span>
          <select
            name="price_area_code"
            defaultValue={site?.price_area_code ?? ''}
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
          name="move_in_date"
          label={moveDateLabel}
          type="date"
          defaultValue={site?.move_in_date}
        />

        <Input
          name="annual_consumption_kwh"
          label="Årsförbrukning kWh"
          type="number"
          defaultValue={
            site?.annual_consumption_kwh !== null &&
            site?.annual_consumption_kwh !== undefined
              ? String(site.annual_consumption_kwh)
              : ''
          }
        />

        <Input
          name="current_supplier_name"
          label={currentSupplierLabel}
          defaultValue={site?.current_supplier_name}
        />

        <Input
          name="current_supplier_org_number"
          label="Nuvarande elleverantör org.nr"
          defaultValue={site?.current_supplier_org_number}
        />

        <Input name="street" label="Gatuadress" defaultValue={site?.street} />
        <Input name="care_of" label="Care of" defaultValue={site?.care_of} />
        <Input name="postal_code" label="Postnummer" defaultValue={site?.postal_code} />
        <Input name="city" label="Stad" defaultValue={site?.city} />
        <Input name="country" label="Land" defaultValue={site?.country ?? 'SE'} />

        {requiresMoveFields ? (
          <>
            <Input
              name="moved_from_street"
              label="Flyttar från - gata"
              defaultValue={site?.moved_from_street}
            />
            <Input
              name="moved_from_postal_code"
              label="Flyttar från - postnummer"
              defaultValue={site?.moved_from_postal_code}
            />
            <Input
              name="moved_from_city"
              label="Flyttar från - stad"
              defaultValue={site?.moved_from_city}
            />
            <Input
              name="moved_from_supplier_name"
              label="Flyttar från - tidigare elleverantör"
              defaultValue={site?.moved_from_supplier_name}
            />
          </>
        ) : null}
      </div>

      <label className="mt-4 grid gap-2">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Intern notering
        </span>
        <textarea
          name="internal_notes"
          rows={4}
          defaultValue={site?.internal_notes ?? ''}
          className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
        />
      </label>

      <div className="mt-6 flex items-center justify-end gap-3">
        {cancelHref ? (
          <Link
            href={cancelHref}
            className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Tillbaka
          </Link>
        ) : null}
        <SubmitButton isEditing={isEditing} />
      </div>
    </form>
  )
}