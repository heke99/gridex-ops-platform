import type { TenantLegalProfile } from '@/lib/contracts/canonical'
import {
  addressField,
  contactField,
  legalObjectText,
} from '@/lib/legal/tenantLegalProfile'

type LegalProfileFormProps = {
  companyId: string
  profile: TenantLegalProfile | null
  action: (formData: FormData) => void | Promise<void>
  returnTo: string
  title?: string
  description?: string
}

function Input({
  name,
  label,
  defaultValue,
  type = 'text',
  placeholder,
}: {
  name: string
  label: string
  defaultValue?: string
  type?: string
  placeholder?: string
}) {
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-800">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
      />
    </label>
  )
}

function Textarea({
  name,
  label,
  defaultValue,
  rows = 3,
}: {
  name: string
  label: string
  defaultValue?: string
  rows?: number
}) {
  return (
    <label className="grid gap-1 text-sm font-bold text-slate-800 md:col-span-2">
      <span>{label}</span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ''}
        className="rounded-2xl border border-slate-300 bg-white px-4 py-3"
      />
    </label>
  )
}

function AddressFields({
  prefix,
  title,
  value,
}: {
  prefix: string
  title: string
  value: Record<string, unknown> | null | undefined
}) {
  return (
    <fieldset className="rounded-3xl border border-slate-200 bg-slate-50 p-5 md:col-span-2">
      <legend className="px-2 text-sm font-black text-slate-950">{title}</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <Input name={`${prefix}_line_1`} label="Gatuadress" defaultValue={addressField(value, 'address_line_1') || legalObjectText(value, 'text')} placeholder="Storgatan 1" />
        <Input name={`${prefix}_line_2`} label="Adressrad 2" defaultValue={addressField(value, 'address_line_2')} placeholder="C/O eller våning" />
        <Input name={`${prefix}_postal_code`} label="Postnummer" defaultValue={addressField(value, 'postal_code')} placeholder="211 20" />
        <Input name={`${prefix}_city`} label="Ort" defaultValue={addressField(value, 'city')} placeholder="Malmö" />
        <Input name={`${prefix}_country_code`} label="Landkod" defaultValue={addressField(value, 'country_code') || 'SE'} placeholder="SE" />
      </div>
    </fieldset>
  )
}

function ContactFields({
  prefix,
  title,
  value,
}: {
  prefix: string
  title: string
  value: Record<string, unknown> | null | undefined
}) {
  return (
    <fieldset className="rounded-3xl border border-slate-200 bg-slate-50 p-5 md:col-span-2">
      <legend className="px-2 text-sm font-black text-slate-950">{title}</legend>
      <div className="grid gap-4 md:grid-cols-2">
        <Input name={`${prefix}_name`} label="Namn/funktion" defaultValue={contactField(value, 'name')} />
        <Input name={`${prefix}_email`} label="E-post" type="email" defaultValue={contactField(value, 'email')} />
        <Input name={`${prefix}_phone`} label="Telefon" defaultValue={contactField(value, 'phone')} />
        <Input name={`${prefix}_address`} label="Postadress" defaultValue={contactField(value, 'address')} />
        <Textarea name={`${prefix}_description`} label="Beskrivning och instruktion" defaultValue={contactField(value, 'description') || legalObjectText(value, 'text')} />
      </div>
    </fieldset>
  )
}

export default function TenantLegalProfileForm({
  companyId,
  profile,
  action,
  returnTo,
  title = 'Bolagets juridikprofil',
  description = 'Uppgifterna låses i varje publicerad avtalsversion. Strukturerade kontakt- och adressfält används av juridik, e-post och PDF.',
}: LegalProfileFormProps) {
  const missingFields = Array.isArray(profile?.missing_fields) ? profile.missing_fields : []

  return (
    <form
      id="tenant-legal-profile"
      action={action}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Juridikprofil</p>
      <h2 className="mt-2 text-xl font-black text-slate-950">{title}</h2>
      <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-700">{description}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
        <span className={`rounded-full border px-3 py-1 ${profile?.completeness_status === 'verified' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          Status: {profile?.completeness_status ?? 'incomplete'}
        </span>
        {profile?.review_required ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-900">Ny granskning krävs</span>
        ) : null}
      </div>
      {missingFields.length > 0 ? (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          Saknade obligatoriska uppgifter: {missingFields.join(', ')}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Input name="legal_name" label="Juridiskt bolagsnamn" defaultValue={profile?.legal_name ?? ''} />
        <Input name="organization_number" label="Organisationsnummer" defaultValue={profile?.organization_number ?? ''} />
        <Input name="customer_service_email" label="Kundservice e-post" type="email" defaultValue={profile?.customer_service_email ?? ''} />
        <Input name="phone" label="Telefon" defaultValue={profile?.phone ?? ''} />
        <Input name="website" label="Webbplats" defaultValue={profile?.website ?? ''} placeholder="https://bolag.se" />

        <AddressFields prefix="postal_address" title="Juridisk postadress" value={profile?.postal_address} />
        <AddressFields prefix="customer_service_address" title="Kundserviceadress" value={profile?.customer_service_address} />
        <ContactFields prefix="complaints" title="Klagomålskontakt" value={profile?.complaints_contact} />
        <ContactFields prefix="data_protection" title="Dataskyddskontakt" value={profile?.data_protection_contact} />

        <fieldset className="rounded-3xl border border-slate-200 bg-slate-50 p-5 md:col-span-2">
          <legend className="px-2 text-sm font-black text-slate-950">Faktureringsuppgifter</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Input name="billing_email" label="Faktura-e-post" type="email" defaultValue={legalObjectText(profile?.billing_information, 'email')} />
            <Input name="billing_phone" label="Telefon" defaultValue={legalObjectText(profile?.billing_information, 'phone')} />
            <Input name="billing_address" label="Fakturaadress" defaultValue={legalObjectText(profile?.billing_information, 'address')} />
            <Input name="billing_bankgiro" label="Bankgiro" defaultValue={legalObjectText(profile?.billing_information, 'bankgiro')} />
            <Textarea name="billing_description" label="Faktureringsvillkor och kontaktinstruktion" defaultValue={legalObjectText(profile?.billing_information, 'description', 'text')} />
          </div>
        </fieldset>

        <fieldset className="rounded-3xl border border-slate-200 bg-slate-50 p-5 md:col-span-2">
          <legend className="px-2 text-sm font-black text-slate-950">Tvistlösning</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <Input name="dispute_authority" label="Myndighet/nämnd" defaultValue={legalObjectText(profile?.dispute_resolution_information, 'authority')} />
            <Input name="dispute_url" label="Webbadress" defaultValue={legalObjectText(profile?.dispute_resolution_information, 'url')} />
            <Input name="dispute_email" label="E-post" type="email" defaultValue={legalObjectText(profile?.dispute_resolution_information, 'email')} />
            <Input name="dispute_address" label="Postadress" defaultValue={legalObjectText(profile?.dispute_resolution_information, 'address')} />
            <Textarea name="dispute_description" label="Tvistlösningsinformation" defaultValue={legalObjectText(profile?.dispute_resolution_information, 'description', 'text')} />
          </div>
        </fieldset>
      </div>

      <button className="mt-6 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white hover:bg-slate-800">
        Spara och verifiera juridikprofil
      </button>
    </form>
  )
}
