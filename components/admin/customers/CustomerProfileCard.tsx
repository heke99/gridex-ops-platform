'use client'

import { useActionState, useMemo, useState } from 'react'
import { useAdminDraftMemory } from '@/components/admin/AdminUnsavedChanges'
import CustomerEditForm from './CustomerEditForm'
import {
 archiveCustomerAction,
 closeCustomerLifecycleAction,
 deleteCustomerForRecreateAction,
 markCustomerAsTestDataAction,
 saveCustomerProfileAction,
} from '@/app/admin/customers/[id]/profile-actions'
import {
 IDLE_CUSTOMER_ACTION_STATE,
 type CustomerActionState,
} from '@/app/admin/customers/[id]/customer-action-state'

function ActionBanner({ state }: { state: CustomerActionState }) {
 if (state.status === 'error') {
 return (
 <p
 role="alert"
 tabIndex={-1}
 className="rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
 >
 {state.message ?? 'Åtgärden kunde inte slutföras.'}
 </p>
 )
 }

 if (state.status === 'success') {
 return (
 <p
 role="status"
 className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
 >
 {state.message ?? 'Åtgärden slutfördes.'}
 </p>
 )
 }

 return null
}

type CustomerProfile = {
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
 contact_revision: number
 legal_profile_revision?: number
 lifecycle_revision?: number
 apartment_number: string | null
 moved_out_at?: string | null
 lifecycle_closed_at?: string | null
 lifecycle_status_reason?: string | null
 is_test_data?: boolean | null
 archived_at?: string | null
 archive_reason?: string | null
 data_retention_note?: string | null
}

function inputClassName() {
 return 'min-h-11 min-w-0 rounded-2xl border border-slate-300 bg-white px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
}

export default function CustomerProfileCard({
 customer,
 showLifecycleTools = true,
 showPlatformTools = false,
 canEdit = false,
 idempotencyKey,
}: {
 customer: CustomerProfile
 showLifecycleTools?: boolean
 showPlatformTools?: boolean
 canEdit?: boolean
 idempotencyKey?: string
}) {
 const memory = useAdminDraftMemory()
 const draftKey = `${customer.id}/legal-profile`
 const [customerType, setCustomerType] = useState(() => memory.get(draftKey)?.find((field) => field.name === 'customer_type')?.value ?? customer.customer_type ?? 'private')
 async function saveProfile(data: FormData) {
   const saved = await saveCustomerProfileAction(IDLE_CUSTOMER_ACTION_STATE, data)
   if (saved.status === 'error') return { error: true as const, code: saved.code ?? 'legal_profile_unconfirmed' }
   if (saved.status !== 'success' || typeof saved.revision !== 'number' || !Number.isSafeInteger(saved.revision) || saved.revision < 0 || typeof saved.changed !== 'boolean' || typeof saved.replayed !== 'boolean') return { error: true as const, code: 'legal_profile_unconfirmed' }
   return { revision: saved.revision, changed: 'changed' in saved && saved.changed === true, replayed: 'replayed' in saved && saved.replayed === true }
 }
 async function saveLifecycle(data: FormData) {
   const saved = await closeCustomerLifecycleAction(IDLE_CUSTOMER_ACTION_STATE, data)
   if (saved.status === 'error') return { error: true as const, code: saved.code ?? 'customer_lifecycle_unconfirmed' }
   if (saved.status !== 'success' || typeof saved.revision !== 'number' || !Number.isSafeInteger(saved.revision) || saved.revision < 0 || typeof saved.changed !== 'boolean' || typeof saved.replayed !== 'boolean') return { error: true as const, code: 'customer_lifecycle_unconfirmed' }
   return { revision: saved.revision, changed: 'changed' in saved && saved.changed === true, replayed: 'replayed' in saved && saved.replayed === true }
 }
 const [testDataState, testDataAction, testDataPending] = useActionState(
 markCustomerAsTestDataAction,
 IDLE_CUSTOMER_ACTION_STATE,
 )
 const [archiveState, archiveAction, archivePending] = useActionState(
 archiveCustomerAction,
 IDLE_CUSTOMER_ACTION_STATE,
 )
 const [deleteState, deleteAction, deletePending] = useActionState(
 deleteCustomerForRecreateAction,
 IDLE_CUSTOMER_ACTION_STATE,
 )
 const isArchived = String(customer.status ?? '').toLowerCase() === 'archived' || Boolean(customer.archived_at)
 const revisionAvailable = typeof customer.legal_profile_revision === 'number' && Number.isSafeInteger(customer.legal_profile_revision) && customer.legal_profile_revision >= 0
 const canEditLegalProfile = canEdit && revisionAvailable && Boolean(idempotencyKey) && !isArchived
 const lifecycleRevisionAvailable = typeof customer.lifecycle_revision === 'number' && Number.isSafeInteger(customer.lifecycle_revision) && customer.lifecycle_revision >= 0
 const archivedFieldProps = isArchived ? { disabled: true, 'aria-disabled': true } : {}
 const archivedInputClassName = isArchived ? `${inputClassName()} opacity-70 cursor-not-allowed` : inputClassName()

 const helperText = useMemo(() => {
 if (customerType === 'business') {
 return 'Företag sparas med företagsnamn och organisationsnummer. Registrerade namn i kundprofilen är separata från kontaktpanelen.'
 }

 if (customerType === 'association') {
 return 'Förening sparas med föreningsnamn och organisationsnummer. Registrerade namn i kundprofilen är separata från kontaktpanelen.'
 }

 return 'Privatkund sparas med personuppgifter som huvudidentitet. Företags- och organisationsfält döljs.'
 }, [customerType])

 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Juridisk kundprofil
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Kundtyp, juridisk identitet och kontostatus. Kontaktuppgifter ändras i kontaktpanelen och inloggning hanteras separat.
 </p>
 <p className="mt-1 text-sm text-slate-700">Juridisk profilrevision: {revisionAvailable ? customer.legal_profile_revision : 'inte tillgänglig'}.</p>
 </div>
 </div>

 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 {helperText}
 </div>

 {isArchived ? (
 <div className="mt-4 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-800">
 Denna kund är arkiverad. Historik är bevarad. Kunden visas inte i aktiv kundlista och aktiva kundåtgärder är spärrade.
 </div>
 ) : null}
 {(customer.is_test_data || customer.archived_at) ? (
 <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
 {customer.is_test_data ? <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800">Testdata – exkludera från drift</span> : null}
 {customer.archived_at ? <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-slate-700">Arkiverad {customer.archived_at.slice(0, 10)}</span> : null}
 </div>
 ) : null}

 {canEditLegalProfile ? <CustomerEditForm key={`${customer.id}:${customer.legal_profile_revision}`} action={saveProfile} draftKey={draftKey} onCancel={() => setCustomerType(customer.customer_type ?? 'private')} submitLabel="Spara kundprofil" className="mt-6 space-y-4">
 <input type="hidden" name="customer_id" value={customer.id} />
 <input type="hidden" name="expected_legal_profile_revision" defaultValue={customer.legal_profile_revision} />
 <input type="hidden" name="idempotency_key" defaultValue={idempotencyKey} />
 <div className="grid min-w-0 gap-4 md:grid-cols-2">

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Kundtyp</span>
 <select
 name="customer_type"
 value={customerType}
 onChange={(event) => setCustomerType(event.target.value)}
 className={archivedInputClassName}
 {...archivedFieldProps}
 >
 <option value="private">Privat</option>
 <option value="business">Företag</option>
 <option value="association">Förening</option>
 </select>
 </label>

 <div className="grid content-start gap-1 text-sm"><span className="text-slate-700">Status</span><p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">{customer.status ?? 'Saknas'}</p><p className="text-xs text-slate-700">Status ändras genom tillåtna livscykelåtgärder, separat från den juridiska profilen.</p></div>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">
 {customerType === 'private' ? 'Förnamn' : 'Registrerat förnamn'}
 </span>
 <input
 name="first_name"
 defaultValue={customer.first_name ?? ''}
 required={customerType === 'private'}
 className={archivedInputClassName}
 {...archivedFieldProps}
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">
 {customerType === 'private' ? 'Efternamn' : 'Registrerat efternamn'}
 </span>
 <input
 name="last_name"
 defaultValue={customer.last_name ?? ''}
 required={customerType === 'private'}
 className={archivedInputClassName}
 {...archivedFieldProps}
 />
 </label>

 {customerType !== 'private' ? (
 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">
 {customerType === 'association' ? 'Föreningsnamn' : 'Företagsnamn'}
 </span>
 <input
 name="company_name"
 defaultValue={customer.company_name ?? ''}
 required
 className={archivedInputClassName}
 {...archivedFieldProps}
 />
 </label>
 ) : (
 <input type="hidden" name="company_name" value="" />
 )}

 {customerType === 'private' ? (
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Personnummer</span>
 <input
 name="personal_number"
 defaultValue={customer.personal_number ?? ''}
 className={archivedInputClassName}
 {...archivedFieldProps}
 />
 </label>
 ) : (
 <input type="hidden" name="personal_number" value="" />
 )}

 {customerType !== 'private' ? (
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Organisationsnummer</span>
 <input
 name="org_number"
 defaultValue={customer.org_number ?? ''}
 required
 className={archivedInputClassName}
 {...archivedFieldProps}
 />
 </label>
 ) : (
 <input type="hidden" name="org_number" value="" />
 )}

 <div className="text-sm text-slate-700">
 <p>E-post: {customer.email ?? '—'}</p>
 <p>Telefon: {customer.phone ?? '—'}</p>
 <p className="mt-1 text-xs">Ändra primär kontakt under Kontakter. Sparad kontaktrevision: {customer.contact_revision}.</p>
 </div>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Lägenhetsnummer</span>
 <input
 name="apartment_number"
 defaultValue={customer.apartment_number ?? ''}
 className={archivedInputClassName}
 {...archivedFieldProps}
 />
 </label>

 </div>
 </CustomerEditForm> : <div className="mt-6 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
 <p className="font-semibold text-slate-800">{!canEdit ? 'Läsläge – du saknar rättighet att ändra juridisk profil.' : isArchived ? 'Läsläge – arkiverad juridisk profil är låst.' : 'Läsläge – profilrevision eller försöksnyckel saknas. Läs om sidan innan profilen ändras.'}</p>
 <dl className="grid gap-2 sm:grid-cols-2">
 <div><dt className="text-slate-600">Namn</dt><dd className="break-words font-medium">{customer.company_name || [customer.first_name, customer.last_name].filter(Boolean).join(' ') || '—'}</dd></div>
 <div><dt className="text-slate-600">Person-/organisationsnummer</dt><dd className="break-all font-medium">{customer.personal_number || customer.org_number || '—'}</dd></div>
 <div><dt className="text-slate-600">Kundtyp</dt><dd>{customerType === 'private' ? 'Privat' : customerType === 'business' ? 'Företag' : 'Förening'}</dd></div>
 </dl>
 </div>}

 {showLifecycleTools && canEdit ? (
 <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 ">
 <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
 <div>
 <h3 className="text-sm font-semibold text-emerald-950 ">
 Kund flyttar / avsluta leverans korrekt
 </h3>
 <p className="mt-1 text-sm leading-6 text-emerald-900/80 ">
 Använd detta när kunden flyttar eller när leveransen ska avslutas. Systemet gör ett mjukt avslut: kundhistorik, Ediel-kedjor, fullmakter, mätvärden och faktureringsunderlag sparas för revision och slutdebitering.
 </p>
 </div>
 {customer.moved_out_at || customer.lifecycle_closed_at ? (
 <span className="inline-flex rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 ">
 Avslutad {customer.moved_out_at ?? customer.lifecycle_closed_at?.slice(0, 10)}
 </span>
 ) : null}
 </div>

 {customer.lifecycle_status_reason ? (
 <div className="mt-4 rounded-2xl border border-emerald-100 bg-white/80 px-4 py-3 text-sm text-slate-700 ">
 Senaste orsak: {customer.lifecycle_status_reason}
 </div>
 ) : null}

 <p className="mt-3 text-sm text-emerald-950">Livscykelrevision: {lifecycleRevisionAvailable ? customer.lifecycle_revision : 'inte tillgänglig'}.</p>
 {lifecycleRevisionAvailable && idempotencyKey && !isArchived ? <CustomerEditForm
 key={`${customer.id}:${customer.lifecycle_revision}`}
 action={saveLifecycle}
 confirmMessage="Registrera flytt/avslut? Kunden raderas inte, men aktiva flöden och avtal mjukt avslutas."
 draftKey={`${customer.id}/lifecycle-close`}
 submitLabel="Registrera flytt / avslut"
 className="mt-5 space-y-4"
 >
 <input type="hidden" name="customer_id" value={customer.id} />
 <input type="hidden" name="expected_lifecycle_revision" defaultValue={customer.lifecycle_revision} />
 <input type="hidden" name="idempotency_key" defaultValue={`${idempotencyKey}:lifecycle`} />
 <div className="grid min-w-0 gap-4 md:grid-cols-2">

 <label className="grid gap-1 text-sm">
 <span className="text-emerald-900 ">Åtgärd</span>
 <select name="lifecycle_mode" required disabled={isArchived} className={archivedInputClassName}>
 <option value="move_out">Kunden flyttar / leveransen upphör</option>
 <option value="terminate">Avsluta kundrelation manuellt</option>
 </select>
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-emerald-900 ">Utflytts-/avslutsdatum</span>
 <input
 name="move_out_date"
 type="date"
 required
 defaultValue={new Date().toISOString().slice(0, 10)}
 disabled={isArchived}
 className="h-11 rounded-2xl border border-emerald-200 bg-white px-4 text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 "
 />
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-emerald-900 ">Orsak / intern notering</span>
 <textarea
 name="reason"
 rows={3}
 required
 maxLength={200}
 placeholder="Exempel: Kunden har anmält utflytt. Vänta på slutliga mätvärden och Z05LK från nätägare."
 disabled={isArchived}
 className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 "
 />
 <span className="text-xs text-emerald-900">Ange en konkret orsak till avslutet, högst 200 tecken.</span>
 </label>

 <label className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-white/80 px-4 py-3 text-sm text-slate-700 md:col-span-2">
 <input name="create_follow_up_task" type="checkbox" defaultChecked disabled={isArchived} className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60" />
 <span>
 Skapa uppföljningsuppgift för att invänta nätägarens avslutsbekräftelse, Z05LK/UTILTS E66 där relevant och slutligt faktureringsunderlag.
 </span>
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-emerald-900 ">Skriv AVSLUTA för att bekräfta</span>
 <input
 name="confirm_close"
 required
 pattern="AVSLUTA"
 autoComplete="off"
 placeholder="AVSLUTA"
 disabled={isArchived}
 className="h-11 rounded-2xl border border-emerald-200 bg-white px-4 text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 "
 />
 </label>

 <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
 <p className="text-xs leading-5 text-emerald-900/75 ">
 Permanent radering ska inte användas för verkliga kunder som flyttar. Den här åtgärden behåller historiken men stoppar aktiva flöden på ett spårbart sätt.
 </p>
 </div>
 </div>
 </CustomerEditForm> : <p className="mt-4 rounded-2xl border border-emerald-200 bg-white p-4 text-sm font-semibold text-emerald-950">{isArchived ? 'Arkiverad – avslut låst.' : 'Livscykelrevision eller försöksnyckel saknas. Läs om sidan innan flytt eller avslut registreras.'}</p>}
 </div>
 ) : null}

 {showPlatformTools && canEdit ? <>
 <div className="mt-6 grid gap-4 xl:grid-cols-2">
 <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 ">
 <h3 className="text-sm font-semibold text-amber-950 ">Testdata och driftstatus</h3>
 <p className="mt-1 text-sm leading-6 text-amber-900/80 ">
 Markera bara felaktiga testposter som testdata. Testkunder och testanläggningar ska döljas från ordinarie drift, fakturering och leverantörsbytesköer.
 </p>
 <form action={testDataAction} className="mt-4 grid gap-3">
 <input type="hidden" name="customer_id" value={customer.id} />
 <ActionBanner state={testDataState} />
 <label className="grid gap-1 text-sm">
 <span className="text-amber-950 ">Intern orsak</span>
 <input
 name="reason"
 defaultValue={customer.data_retention_note ?? 'Testkund/felregistrering – ska inte användas i produktion.'}
 className="h-11 rounded-2xl border border-amber-200 bg-white px-4 text-slate-950 "
 />
 </label>
 <button disabled={testDataPending} className="inline-flex h-11 items-center justify-center rounded-2xl bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60">
 {testDataPending ? 'Sparar…' : 'Markera som testdata'}
 </button>
 </form>
 </div>

 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 ">
 <h3 className="text-sm font-semibold text-slate-950 ">Arkivera kund</h3>
 <p className="mt-1 text-sm leading-6 text-slate-700 ">
 Använd arkivering för kunder som inte ska visas i ordinarie listor men där historik, avtal, fullmakter, mätvärden eller fakturaunderlag måste sparas.
 </p>
 <form
 action={archiveAction}
 onSubmit={(event) => {
 if (isArchived) {
 event.preventDefault()
 return
 }
 if (!window.confirm('Arkivera kunden? Kunden raderas inte och historiken sparas.')) {
 event.preventDefault()
 }
 }}
 className="mt-4 grid gap-3"
 >
 <input type="hidden" name="customer_id" value={customer.id} />
 <ActionBanner state={archiveState} />
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Orsak</span>
 <input
 name="archive_reason"
 defaultValue={customer.archive_reason ?? ''}
 placeholder="Exempel: Testansökan avslutad eller kundrelation avslutad."
 disabled={isArchived}
 className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 "
 />
 </label>
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Skriv ARKIVERA för att bekräfta</span>
 <input
 name="confirm_archive"
 placeholder="ARKIVERA"
 disabled={isArchived}
 className="h-11 rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 "
 />
 </label>
 <button disabled={isArchived || archivePending} className="inline-flex h-11 items-center justify-center rounded-2xl bg-slate-800 px-4 text-sm font-semibold text-white hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
 {isArchived ? 'Redan arkiverad' : archivePending ? 'Arkiverar…' : 'Arkivera kund'}
 </button>
 </form>
 </div>
 </div>

 <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 ">
 <h3 className="text-sm font-semibold text-red-800 ">
 Permanent radering – endast testdata utan skyddad historik
 </h3>
 <p className="mt-1 text-sm leading-6 text-red-700 ">
 Permanent radering är endast tillåten för testdata/felregistreringar som saknar avtal, fakturor, Ediel-meddelanden, partnerexport och leverantörsbyten. Verkliga kunder ska arkiveras eller anonymiseras enligt retention/GDPR-process.
 </p>
 <form
 action={deleteAction}
 onSubmit={(event) => {
 if (!window.confirm('Radera testkunden permanent? Detta kan inte ångras.')) {
 event.preventDefault()
 }
 }}
 className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
 >
 <input type="hidden" name="customer_id" value={customer.id} />
 <div className="md:col-span-2">
 <ActionBanner state={deleteState} />
 </div>
 <label className="grid gap-1 text-sm">
 <span className="text-red-700 ">Skriv RADERA för att bekräfta</span>
 <input
 name="confirm_delete"
 placeholder="Skriv RADERA för att bekräfta"
 className="h-11 rounded-2xl border border-red-300 bg-white px-4 text-red-950 "
 />
 </label>
 <div className="flex items-end">
 <button disabled={deletePending} className="inline-flex h-11 items-center rounded-2xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60">
 {deletePending ? 'Raderar…' : 'Radera testkund'}
 </button>
 </div>
 </form>
 </div>
 </>
 : null}
 </section>
 )
}
