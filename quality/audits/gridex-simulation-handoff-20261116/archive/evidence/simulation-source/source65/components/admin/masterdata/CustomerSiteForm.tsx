'use client'

import Link from 'next/link'
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState } from 'react'
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

type SiteSaveState = Awaited<ReturnType<typeof saveCustomerSiteAction>>
const initialSaveState: SiteSaveState = { ok: false, message: '', fieldErrors: {} }
async function submitSite(_previous: SiteSaveState, formData: FormData): Promise<SiteSaveState> {
 return saveCustomerSiteAction(formData)
}

type SiteFlowType = 'switch' | 'move_in' | 'move_out_takeover'

function SubmitButton({ isEditing, pending }: { isEditing: boolean; pending: boolean }) {

 return (
 <button
 type="submit"
 disabled={pending}
 className="inline-flex items-center justify-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 "
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
 error,
 errorId,
}: {
 name: string
 label: string
 defaultValue?: string | null
 type?: string
 required?: boolean
 error?: string
 errorId?: string
}) {
 return (
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 {label}
 </span>
 <input
 name={name}
 type={type}
 defaultValue={defaultValue ?? ''}
 required={required}
 aria-invalid={error ? true : undefined}
 aria-describedby={error ? errorId : undefined}
 className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 />
 {error ? <span id={errorId} className="text-sm text-rose-700">{error}</span> : null}
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

export default function CustomerSiteForm({
 customerId,
 gridOwners,
 priceAreas,
 site,
 cancelHref,
}: CustomerSiteFormProps) {
 const [saveState, saveAction, savePending] = useActionState(submitSite, initialSaveState)
 const siteNameErrorId = useId()
 const isEditing = Boolean(site)
 const [siteFlowType, setSiteFlowType] = useState<SiteFlowType>(inferFlowType(site))
 const formRef = useRef<HTMLFormElement>(null)
 useEffect(() => {
 if (saveState.ok && !isEditing) {
 formRef.current?.reset()
 }
 }, [saveState, isEditing])


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
 ref={formRef}
 onReset={() => setSiteFlowType(inferFlowType(site))}
 action={saveAction}
 aria-busy={savePending}
 onSubmit={(event) => {
 event.preventDefault()
 if (savePending) return
 // Capture before disabling; explicit dispatch preserves uncontrolled input on validation errors.
 const formData = new FormData(event.currentTarget)
 startTransition(() => saveAction(formData))
 }}
 className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm "
 >
 {saveState.message && !saveState.ok ? <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{saveState.message}</p> : null}
 <p role="status" aria-live="polite" className={savePending || saveState.ok ? 'mb-4 text-sm text-slate-700' : 'sr-only'}>{savePending ? 'Sparar anläggningen…' : saveState.ok ? saveState.message : ''}</p>
 <fieldset disabled={savePending} className="contents">
 <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
 <div>
 <h2 className="text-lg font-semibold text-slate-900 ">
 {isEditing ? 'Redigera anläggning' : 'Ny anläggning'}
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Lägg till eller uppdatera kundens anläggning med nätägare, elområde och operativa uppgifter.
 </p>
 </div>

 {isEditing && cancelHref ? (
 <Link
 href={cancelHref}
 className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
 >
 Avbryt redigering
 </Link>
 ) : null}
 </div>

 <input type="hidden" name="id" value={site?.id ?? ''} />
 <input type="hidden" name="customer_id" value={customerId} />

 <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 <div className="font-semibold text-slate-900 ">
 Flödeslogik för anläggningen
 </div>
 <div className="mt-2 grid gap-4 md:grid-cols-2">
 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Flöde
 </span>
 <select
 name="site_flow_type"
 value={siteFlowType}
 onChange={(event) => setSiteFlowType(event.target.value as SiteFlowType)}
 className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 >
 <option value="switch">Byte av leverantör</option>
 <option value="move_in">Inflytt / flytt</option>
 <option value="move_out_takeover">Övertag vid utflytt</option>
 </select>
 </label>
 </div>
 <p className="mt-3 text-xs text-slate-700 ">{flowSummary}</p>
 </div>

 <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 ">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 Registerkopplingar
 </div>
 <p className="mt-1 text-sm text-slate-700 ">
 Saknas rätt nätägare eller elleverantör? Lägg upp eller redigera dem i registren och kom sedan tillbaka hit.
 </p>
 </div>

 <div className="flex flex-wrap gap-2">
 <Link
 href="/admin/network-owners"
 className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 "
 >
 Nätägare
 </Link>
 <Link
 href="/admin/electricity-suppliers"
 className="inline-flex items-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 "
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
 error={saveState.fieldErrors.site_name}
 errorId={siteNameErrorId}
 required
 />

 <Input
 name="facility_id"
 label="Anläggnings-ID"
 defaultValue={site?.facility_id}
 />

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Typ
 </span>
 <select
 name="site_type"
 defaultValue={site?.site_type ?? 'consumption'}
 className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 >
 <option value="consumption">Förbrukning</option>
 <option value="production">Produktion</option>
 <option value="mixed">Mixed</option>
 </select>
 </label>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Status
 </span>
 <select
 name="status"
 defaultValue={site?.status ?? 'draft'}
 className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 >
 <option value="draft">Draft</option>
 <option value="active">Aktiv</option>
 <option value="pending_move">Pending move</option>
 <option value="inactive">Inaktiv</option>
 <option value="closed">Stängd</option>
 </select>
 </label>

 <div className="grid gap-2 md:col-span-2">
 <span className="text-sm font-medium text-slate-700 ">Nätägare</span>
 <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-slate-700">
 Systemet hittar och verifierar nätägare automatiskt från den fullständiga anläggningsadressen. En nätägare skickas aldrig till innan kontaktväg och Ediel-routing har verifierats.
 {selectedGridOwner ? (
 <div className="mt-2 text-xs text-slate-600">
 Tidigare registrerad uppgift: <span className="font-medium text-slate-900">{selectedGridOwner.name}</span>. Den behandlas som en kandidat tills systemet har verifierat den.
 </div>
 ) : null}
 </div>
 </div>

 <label className="grid gap-2">
 <span className="text-sm font-medium text-slate-700 ">
 Elområde (uppgift)
 </span>
 <select
 name="price_area_code"
 defaultValue={site?.price_area_code ?? ''}
 className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 >
 <option value="">Låt systemet avgöra</option>
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
 <span className="text-sm font-medium text-slate-700 ">
 Intern notering
 </span>
 <textarea
 name="internal_notes"
 rows={4}
 defaultValue={site?.internal_notes ?? ''}
 className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 "
 />
 </label>

 <div className="mt-6 flex items-center justify-end gap-3">
 {cancelHref ? (
 <Link
 href={cancelHref}
 className="inline-flex items-center rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 "
 >
 Tillbaka
 </Link>
 ) : null}
 <SubmitButton isEditing={isEditing} pending={savePending} />
 </div>
 </fieldset>
 </form>
 )
}