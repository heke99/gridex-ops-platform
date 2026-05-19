'use client'

import { useMemo, useState } from 'react'
import {
 closeCustomerLifecycleAction,
 deleteCustomerForRecreateAction,
 saveCustomerProfileAction,
} from '@/app/admin/customers/[id]/profile-actions'

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
 apartment_number: string | null
 moved_out_at?: string | null
 lifecycle_closed_at?: string | null
 lifecycle_status_reason?: string | null
}

function inputClassName() {
 return 'h-11 rounded-2xl border border-slate-300 bg-white px-4 '
}

export default function CustomerProfileCard({
 customer,
}: {
 customer: CustomerProfile
}) {
 const [customerType, setCustomerType] = useState(customer.customer_type ?? 'private')


 const helperText = useMemo(() => {
 if (customerType === 'business') {
 return 'Företag sparas med företagsnamn och organisationsnummer. För- och efternamn används som kontaktperson.'
 }

 if (customerType === 'association') {
 return 'Förening sparas med föreningsnamn och organisationsnummer. För- och efternamn används som kontaktperson.'
 }

 return 'Privatkund sparas med personuppgifter som huvudidentitet. Företags- och organisationsfält döljs.'
 }, [customerType])

 return (
 <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm ">
 <div className="flex items-start justify-between gap-3">
 <div>
 <h2 className="text-lg font-semibold text-slate-950 ">
 Kundprofil
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 Uppdatera kundtyp, identitet och kontaktuppgifter. Primär kontakt synkas automatiskt när du sparar.
 </p>
 </div>
 </div>

 <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 ">
 {helperText}
 </div>

 <form action={saveCustomerProfileAction} className="mt-6 grid gap-4 md:grid-cols-2">
 <input type="hidden" name="customer_id" value={customer.id} />

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Kundtyp</span>
 <select
 name="customer_type"
 value={customerType}
 onChange={(event) => setCustomerType(event.target.value)}
 className={inputClassName()}
 >
 <option value="private">Privat</option>
 <option value="business">Företag</option>
 <option value="association">Förening</option>
 </select>
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Status</span>
 <select
 name="status"
 defaultValue={customer.status ?? 'draft'}
 className={inputClassName()}
 >
 <option value="draft">Förbereds</option>
 <option value="pending_verification">Väntar verifiering</option>
 <option value="active">Aktiv</option>
 <option value="inactive">Inaktiv</option>
 <option value="moved">Flyttad</option>
 <option value="terminated">Avslutad</option>
 <option value="blocked">Blockerad</option>
 </select>
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">
 {customerType === 'private' ? 'Förnamn' : 'Kontaktperson förnamn'}
 </span>
 <input
 name="first_name"
 defaultValue={customer.first_name ?? ''}
 required
 className={inputClassName()}
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">
 {customerType === 'private' ? 'Efternamn' : 'Kontaktperson efternamn'}
 </span>
 <input
 name="last_name"
 defaultValue={customer.last_name ?? ''}
 required
 className={inputClassName()}
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
 className={inputClassName()}
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
 className={inputClassName()}
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
 className={inputClassName()}
 />
 </label>
 ) : (
 <input type="hidden" name="org_number" value="" />
 )}

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">E-post</span>
 <input
 name="email"
 type="email"
 defaultValue={customer.email ?? ''}
 className={inputClassName()}
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Telefon</span>
 <input
 name="phone"
 defaultValue={customer.phone ?? ''}
 className={inputClassName()}
 />
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Lägenhetsnummer</span>
 <input
 name="apartment_number"
 defaultValue={customer.apartment_number ?? ''}
 className={inputClassName()}
 />
 </label>

 <div className="md:col-span-2 flex justify-end">
 <button className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Spara kundprofil
 </button>
 </div>
 </form>

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

 <form
 action={closeCustomerLifecycleAction}
 onSubmit={(event) => {
 if (!window.confirm('Registrera flytt/avslut? Kunden raderas inte, men aktiva flöden och avtal mjukt avslutas.')) {
 event.preventDefault()
 }
 }}
 className="mt-5 grid gap-4 md:grid-cols-2"
 >
 <input type="hidden" name="customer_id" value={customer.id} />

 <label className="grid gap-1 text-sm">
 <span className="text-emerald-900 ">Åtgärd</span>
 <select name="lifecycle_mode" className="h-11 rounded-2xl border border-emerald-200 bg-white px-4 text-slate-950 ">
 <option value="move_out">Kunden flyttar / leveransen upphör</option>
 <option value="terminate">Avsluta kundrelation manuellt</option>
 </select>
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-emerald-900 ">Utflytts-/avslutsdatum</span>
 <input
 name="move_out_date"
 type="date"
 defaultValue={new Date().toISOString().slice(0, 10)}
 className="h-11 rounded-2xl border border-emerald-200 bg-white px-4 text-slate-950 "
 />
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-emerald-900 ">Orsak / intern notering</span>
 <textarea
 name="reason"
 rows={3}
 placeholder="Exempel: Kunden har anmält utflytt. Vänta på slutliga mätvärden och Z05LK från nätägare."
 className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-950 "
 />
 </label>

 <label className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-white/80 px-4 py-3 text-sm text-slate-700 md:col-span-2">
 <input name="create_follow_up_task" type="checkbox" defaultChecked className="mt-1 h-4 w-4 rounded border-emerald-300 text-emerald-700" />
 <span>
 Skapa uppföljningsuppgift för att invänta nätägarens avslutsbekräftelse, Z05LK/UTILTS E66 där relevant och slutligt faktureringsunderlag.
 </span>
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-emerald-900 ">Skriv AVSLUTA för att bekräfta</span>
 <input
 name="confirm_close"
 placeholder="AVSLUTA"
 className="h-11 rounded-2xl border border-emerald-200 bg-white px-4 text-slate-950 "
 />
 </label>

 <div className="flex flex-col gap-2 md:col-span-2 md:flex-row md:items-center md:justify-between">
 <p className="text-xs leading-5 text-emerald-900/75 ">
 Permanent radering ska inte användas för verkliga kunder som flyttar. Den här åtgärden behåller historiken men stoppar aktiva flöden på ett spårbart sätt.
 </p>
 <button className="inline-flex h-11 items-center justify-center rounded-2xl bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800">
 Registrera flytt / avslut
 </button>
 </div>
 </form>
 </div>

 <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 ">
 <h3 className="text-sm font-semibold text-red-800 ">
 Permanent radering – endast test/felregistrering
 </h3>
 <p className="mt-1 text-sm leading-6 text-red-700 ">
 Använd inte detta för verkliga kunder som flyttar. Permanent radering är endast för felaktiga testposter eller felregistrering innan kunden hunnit användas i drift. Vid flytt ska du använda mjukt avslut ovan.
 </p>
 <form
 action={deleteCustomerForRecreateAction}
 onSubmit={(event) => {
 if (!window.confirm('Radera kunden permanent? Detta kan inte ångras.')) {
 event.preventDefault()
 }
 }}
 className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"
 >
 <input type="hidden" name="customer_id" value={customer.id} />
 <label className="grid gap-1 text-sm">
 <span className="text-red-700 ">Skriv RADERA för att bekräfta</span>
 <input
 name="confirm_delete"
 placeholder="Skriv RADERA för att bekräfta"
 className="h-11 rounded-2xl border border-red-300 bg-white px-4 text-red-950 "
 />
 </label>
 <div className="flex items-end">
 <button className="inline-flex h-11 items-center rounded-2xl bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800">
 Radera kund
 </button>
 </div>
 </form>
 </div>
 </section>
 )
}