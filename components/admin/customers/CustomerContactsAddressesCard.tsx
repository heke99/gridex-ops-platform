import { formatAdminDate, formatAdminDateTime } from '@/lib/ui/format'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import type {
 CustomerAddressRow,
 CustomerContactRow,
 CustomerType,
} from '@/types/customers'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

function getString(formData: FormData, key: string): string {
 return String(formData.get(key) ?? '').trim()
}

function getCheckbox(formData: FormData, key: string): boolean {
 const value = formData.get(key)
 return value === 'on' || value === 'true' || value === '1'
}

function normalizeCustomerType(value: string | null | undefined): CustomerType {
 if (value === 'business') return 'business'
 if (value === 'association') return 'association'
 return 'private'
}

function normalizeNullableString(value: string): string | null {
 return value.trim() ? value.trim() : null
}

async function getActorUserId(): Promise<string> {
 await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

 const supabase = await createSupabaseServerClient()
 const {
 data: { user },
 } = await supabase.auth.getUser()

 if (!user) {
 throw new Error('Unauthorized')
 }

 return user.id
}

async function insertAuditLog(params: {
 actorUserId: string
 entityType: string
 entityId: string
 action: string
 oldValues?: unknown
 newValues?: unknown
 metadata?: unknown
}) {
 const { error } = await supabaseService.from('audit_logs').insert({
 actor_user_id: params.actorUserId,
 entity_type: params.entityType,
 entity_id: params.entityId,
 action: params.action,
 old_values: params.oldValues ?? null,
 new_values: params.newValues ?? null,
 metadata: params.metadata ?? null,
 })

 if (error) throw error
}

async function saveCustomerContactAction(formData: FormData) {
 'use server'

 const actorUserId = await getActorUserId()

 const customerId = getString(formData, 'customer_id')
 const contactId = getString(formData, 'id')
 const customerType = normalizeCustomerType(getString(formData, 'customer_type'))
 const typeInput = getString(formData, 'type') || 'primary'
 const name = normalizeNullableString(getString(formData, 'name'))
 const email = normalizeNullableString(getString(formData, 'email'))
 const phone = normalizeNullableString(getString(formData, 'phone'))
 const titleInput = normalizeNullableString(getString(formData, 'title'))
 const isPrimary = getCheckbox(formData, 'is_primary')

 if (!customerId) {
 throw new Error('customer_id saknas')
 }

 if (!name && !email && !phone) {
 throw new Error('Ange minst namn, e-post eller telefon')
 }

 if ((customerType === 'business' || customerType === 'association') && isPrimary && !name) {
 throw new Error('Företag eller förening kräver namn på primär kontaktperson')
 }

 const type = isPrimary ? 'primary' : typeInput
 const title = customerType === 'private' && isPrimary ? titleInput : titleInput

 const before = contactId
 ? await supabaseService
 .from('customer_contacts')
 .select('*')
 .eq('id', contactId)
 .eq('customer_id', customerId)
 .maybeSingle()
 : { data: null, error: null }

 if (before.error) throw before.error

 if (isPrimary) {
 const query = supabaseService
 .from('customer_contacts')
 .update({ is_primary: false })
 .eq('customer_id', customerId)

 const { error: clearError } = contactId
 ? await query.neq('id', contactId)
 : await query

 if (clearError) throw clearError
 }

 const payload = {
 customer_id: customerId,
 type,
 name,
 email,
 phone,
 title,
 is_primary: isPrimary,
 }

 const { data, error } = contactId
 ? await supabaseService
 .from('customer_contacts')
 .update(payload)
 .eq('id', contactId)
 .eq('customer_id', customerId)
 .select('*')
 .single()
 : await supabaseService
 .from('customer_contacts')
 .insert(payload)
 .select('*')
 .single()

 if (error) throw error

 if (isPrimary) {
 const { error: customerSyncError } = await supabaseService
 .from('customers')
 .update({
 email,
 phone,
 updated_at: new Date().toISOString(),
 })
 .eq('id', customerId)

 if (customerSyncError) throw customerSyncError
 }

 await insertAuditLog({
 actorUserId,
 entityType: 'customer_contact',
 entityId: data.id,
 action: contactId ? 'customer_contact_updated' : 'customer_contact_created',
 oldValues: before.data,
 newValues: data,
 metadata: {
 customerId,
 customerType,
 isPrimary,
 },
 })

 revalidatePath(`/admin/customers/${customerId}`)
}

async function saveCustomerAddressAction(formData: FormData) {
 'use server'

 const actorUserId = await getActorUserId()

 const customerId = getString(formData, 'customer_id')
 const addressId = getString(formData, 'id')
 const customerType = normalizeCustomerType(getString(formData, 'customer_type'))
 const type = getString(formData, 'type') || 'registered'
 const street1 = getString(formData, 'street_1')
 const street2 = getString(formData, 'street_2') || null
 const postalCode = getString(formData, 'postal_code') || null
 const city = getString(formData, 'city') || null
 const country = getString(formData, 'country') || 'SE'
 const municipality = getString(formData, 'municipality') || null
 const movedInAt = getString(formData, 'moved_in_at') || null
 const movedOutAt = getString(formData, 'moved_out_at') || null
 const isActive = getCheckbox(formData, 'is_active')

 if (!customerId) {
 throw new Error('customer_id saknas')
 }

 if (!street1) {
 throw new Error('Gatuadress krävs')
 }

 if (!['registered', 'billing', 'other'].includes(type)) {
 throw new Error('Anläggningsadress ändras under anläggningsuppgifter.')
 }

 const before = addressId
 ? await supabaseService
 .from('customer_addresses')
 .select('*')
 .eq('id', addressId)
 .eq('customer_id', customerId)
 .maybeSingle()
 : { data: null, error: null }

 if (before.error) throw before.error

 const payload = {
 customer_id: customerId,
 type,
 street_1: street1,
 street_2: street2,
 postal_code: postalCode,
 city,
 country,
 municipality,
 moved_in_at: movedInAt,
 moved_out_at: movedOutAt,
 is_active: isActive,
 }

 const { data, error } = addressId
 ? await supabaseService
 .from('customer_addresses')
 .update(payload)
 .eq('id', addressId)
 .eq('customer_id', customerId)
 .select('*')
 .single()
 : await supabaseService
 .from('customer_addresses')
 .insert(payload)
 .select('*')
 .single()

 if (error) throw error

 await insertAuditLog({
 actorUserId,
 entityType: 'customer_address',
 entityId: data.id,
 action: addressId ? 'customer_address_updated' : 'customer_address_created',
 oldValues: before.data,
 newValues: data,
 metadata: {
 customerId,
 customerType,
 isActive,
 },
 })

 revalidatePath(`/admin/customers/${customerId}`)
}

function badgeTone(active: boolean): string {
 return active
 ? 'bg-emerald-100 text-emerald-700 '
 : 'bg-slate-100 text-slate-700 '
}

function contactIntro(customerType: CustomerType): string {
 if (customerType === 'private') {
 return 'Huvudkontakten är normalt kunden själv. Huvudkontakten är den person som ska nås.'
 }

 if (customerType === 'association') {
 return 'Förening bör ha en tydlig huvudkontakt, till exempel ordförande, administratör eller styrelsekontakt.'
 }

 return 'Företag bör ha en tydlig huvudkontakt, till exempel VD, ekonomiansvarig eller driftkontakt.'
}

function addressIntro(customerType: CustomerType): string {
 if (customerType === 'private') {
 return 'För privatkunder är registrerad adress och fakturaadress vanligast. Anläggningsadress hanteras under anläggningsuppgifter.'
 }

 if (customerType === 'association') {
 return 'För föreningar är registrerad adress och fakturaadress ofta olika. Anläggningsadress hanteras separat under anläggningsuppgifter.'
 }

 return 'För företag är registrerad adress och fakturaadress ofta olika. Anläggningsadress hanteras separat under anläggningsuppgifter.'
}

function defaultAddressType(customerType: CustomerType): string {
 return customerType === 'private' ? 'registered' : 'billing'
}

function ContactForm({
 customerId,
 customerType,
 contact,
}: {
 customerId: string
 customerType: CustomerType
 contact?: CustomerContactRow
}) {
 const isPrimaryContact = contact?.is_primary ?? !contact

 return (
 <form
 action={saveCustomerContactAction}
 className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="customer_type" value={customerType} />
 <input type="hidden" name="id" value={contact?.id ?? ''} />

 <div className="grid min-w-0 gap-3 md:grid-cols-2 [&_input]:min-w-0 [&_input]:w-full [&_select]:min-w-0 [&_select]:w-full">
 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Typ</span>
 <select
 name="type"
 defaultValue={contact?.type ?? (isPrimaryContact ? 'primary' : 'other')}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 >
 {contact?.type && !['primary', 'billing', 'operations', 'technical', 'other'].includes(contact.type) ? <option value={contact.type}>Befintlig kontaktroll</option> : null}
 <option value="primary">Huvudkontakt</option>
 <option value="billing">Faktura</option>
 <option value="operations">Kundärenden</option>
 <option value="technical">Anläggningsfrågor</option>
 <option value="other">Övrigt</option>
 </select>
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Titel / roll</span>
 <input
 name="title"
 defaultValue={contact?.title ?? ''}
 placeholder={
 customerType === 'private'
 ? 'Ex. privatkund'
 : customerType === 'association'
 ? 'Ex. ordförande'
 : 'Ex. VD'
 }
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">
 {customerType === 'private' ? 'Namn' : 'Kontaktperson namn'}
 </span>
 <input
 name="name"
 defaultValue={contact?.name ?? ''}
 placeholder={
 customerType === 'private'
 ? 'Fullständigt namn'
 : 'Kontaktpersonens fullständiga namn'
 }
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">E-post</span>
 <input
 type="email"
 name="email"
 defaultValue={contact?.email ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Telefon</span>
 <input
 name="phone"
 defaultValue={contact?.phone ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>
 </div>

 <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm ">
 <input
 type="checkbox"
 name="is_primary"
 defaultChecked={contact?.is_primary ?? !contact}
 className="h-4 w-4 rounded border-slate-300"
 />
 <span>Primär kontakt</span>
 </label>

 <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 ">
 Huvudkontakten uppdaterar kundens e-post och telefon när du sparar.
 </div>

 <div className="flex justify-end">
 <button className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 {contact ? 'Spara kontakt' : 'Lägg till kontakt'}
 </button>
 </div>
 </form>
 )
}

function AddressForm({
 customerId,
 customerType,
 address,
}: {
 customerId: string
 customerType: CustomerType
 address?: CustomerAddressRow
}) {
 return (
 <form
 action={saveCustomerAddressAction}
 className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="customer_type" value={customerType} />
 <input type="hidden" name="id" value={address?.id ?? ''} />

 <div className="grid min-w-0 gap-3 md:grid-cols-2 [&_input]:min-w-0 [&_input]:w-full [&_select]:min-w-0 [&_select]:w-full">
 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Typ</span>
 <select
 name="type"
 required
 defaultValue={address?.type ? ['registered', 'billing', 'other'].includes(address.type) ? address.type : '' : defaultAddressType(customerType)}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 >
 <option value="" disabled>Välj adresstyp</option>
 <option value="registered">Registrerad adress</option>
 <option value="billing">Faktura</option>
 <option value="other">Övrigt</option>
 </select>
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Land</span>
 <input
 name="country"
 defaultValue={address?.country ?? 'SE'}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Gatuadress</span>
 <input
 name="street_1"
 defaultValue={address?.street_1 ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Adressrad 2 / c/o</span>
 <input
 name="street_2"
 defaultValue={address?.street_2 ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Postnummer</span>
 <input
 name="postal_code"
 defaultValue={address?.postal_code ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Stad</span>
 <input
 name="city"
 defaultValue={address?.city ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Kommun</span>
 <input
 name="municipality"
 defaultValue={address?.municipality ?? ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Inflyttad</span>
 <input
 type="date"
 name="moved_in_at"
 defaultValue={address?.moved_in_at ? address.moved_in_at.slice(0, 10) : ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>

 <label className="grid min-w-0 gap-1 text-sm">
 <span className="text-slate-700 ">Utflyttad</span>
 <input
 type="date"
 name="moved_out_at"
 defaultValue={address?.moved_out_at ? address.moved_out_at.slice(0, 10) : ''}
 className="rounded-2xl border border-slate-300 px-4 py-3 "
 />
 </label>
 </div>

 <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm ">
 <input
 type="checkbox"
 name="is_active"
 defaultChecked={address?.is_active ?? true}
 className="h-4 w-4 rounded border-slate-300"
 />
 <span>Aktiv adress</span>
 </label>

 <div className="flex justify-end">
 <button className="inline-flex items-center rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 {address ? 'Spara adress' : 'Lägg till adress'}
 </button>
 </div>
 </form>
 )
}

const CONTACT_LABELS: Record<string, string> = { primary: 'Huvudkontakt', billing: 'Fakturakontakt', operations: 'Kundärenden', technical: 'Anläggningsfrågor', other: 'Övrig kontakt' }
const ADDRESS_LABELS: Record<string, string> = { registered: 'Registrerad adress', billing: 'Fakturaadress', facility: 'Anläggningsadress', other: 'Övrig adress' }

export default function CustomerContactsAddressesCard({ customerId, companyId, customerType, contacts, addresses, sites, canWrite = false }: {
  customerId: string
  companyId: string | null
  customerType: CustomerType
  contacts: CustomerContactRow[]
  addresses: CustomerAddressRow[]
  sites: CustomerSiteRow[]
  canWrite?: boolean
}) {
  if (!companyId) return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Kontakt- och adressuppgifter kunde inte visas för valt bolag.</p>
  const ownContacts = contacts.filter(row => row.customer_id === customerId && row.company_id === companyId)
  const ownSites = sites.filter(row => row.customer_id === customerId && row.company_id === companyId)
  const contactAddresses = addresses.filter(row => row.customer_id === customerId && row.company_id === companyId && row.type !== 'facility')
  const activeAddresses = contactAddresses.filter(row => row.is_active)
  const formerAddresses = contactAddresses.filter(row => !row.is_active)
  const renderAddress = (address: CustomerAddressRow) => <article key={address.id} className="min-w-0 break-words rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-semibold text-slate-950">{address.street_1 || 'Gatuadress saknas'}</p><p className="mt-1 text-xs text-slate-600">{ADDRESS_LABELS[address.type] ?? 'Adresstyp behöver kontrolleras'}{address.street_2 ? ` · ${address.street_2}` : ''}</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(address.is_active)}`}>{address.is_active ? 'Aktiv' : 'Tidigare adress'}</span>
    </div>
    <p className="mt-2 text-sm text-slate-700">{[address.postal_code, address.city, address.country].filter(Boolean).join(' ')}</p>
    {address.moved_in_at || address.moved_out_at ? <p className="mt-1 text-xs text-slate-600">Inflytt: {formatAdminDate(address.moved_in_at)} · Utflytt: {formatAdminDate(address.moved_out_at)}</p> : null}
    {canWrite ? <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Redigera adress</summary><div className="mt-3"><AddressForm customerId={customerId} customerType={customerType} address={address} /></div></details> : null}
  </article>
  return <section className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Kontakter</h2>
      <p className="mt-1 text-sm text-slate-600">{contactIntro(customerType)}</p>
      {ownContacts.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga kontakter registrerade ännu.</p> : <div role="region" aria-label="Kundens kontakter" tabIndex={0} className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
        {ownContacts.map(contact => <article key={contact.id} className="min-w-0 break-words rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="font-semibold text-slate-950">{contact.name || 'Namn saknas'}</p><p className="mt-1 text-xs text-slate-600">{CONTACT_LABELS[contact.type] ?? 'Kontaktroll behöver kontrolleras'}{contact.title ? ` · ${contact.title}` : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(contact.is_primary)}`}>{contact.is_primary ? 'Huvudkontakt' : 'Övrig kontakt'}</span></div>
          <p className="mt-2 text-sm text-slate-700">E-post: {contact.email || 'Inte angiven'}</p><p className="mt-1 text-sm text-slate-700">Telefon: {contact.phone || 'Inte angiven'}</p>
          <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Fler uppgifter</summary><p className="mt-2">Registrerad {formatAdminDateTime(contact.created_at)}</p></details>
          {canWrite ? <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Redigera kontakt</summary><div className="mt-3"><ContactForm customerId={customerId} customerType={customerType} contact={contact} /></div></details> : null}
        </article>)}
      </div>}
      {canWrite ? <details className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Lägg till kontakt</summary><div className="mt-3"><ContactForm customerId={customerId} customerType={customerType} /></div></details> : null}
    </div>
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">Adresser</h2>
      <p className="mt-1 text-sm text-slate-600">{addressIntro(customerType)}</p>
      <details className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-950">Anläggningsadresser ({ownSites.length})</summary><p className="mt-2 text-xs text-slate-600">Används för nätägare och leverantörsbyte. Se anläggningsfliken för fler uppgifter.</p>
        {ownSites.length === 0 ? <p className="mt-2 text-sm text-slate-600">Ingen anläggning registrerad ännu.</p> : <div role="region" aria-label="Kundens anläggningsadresser" tabIndex={0} className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{ownSites.map(site => <div key={site.id} className="min-w-0 break-words rounded-lg border border-sky-100 bg-white p-3"><p className="text-sm font-semibold text-slate-950">{site.site_name || 'Anläggning'}</p><p className="mt-1 text-sm text-slate-700">{[site.care_of, site.street, [site.postal_code, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adress saknas'}</p><p className="mt-1 text-xs text-slate-600">Anläggningsnummer: {site.facility_id || 'saknas'}</p></div>)}</div>}
      </details>
      {activeAddresses.length === 0 ? <p className="mt-3 text-sm text-slate-600">Inga aktuella kontakt- eller fakturaadresser.</p> : <div role="region" aria-label="Aktuella kontakt- och fakturaadresser" tabIndex={0} className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{activeAddresses.map(renderAddress)}</div>}
      {formerAddresses.length > 0 ? <details id="former-customer-addresses" className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Tidigare adresser ({formerAddresses.length})</summary><div role="region" aria-label="Tidigare kontakt- och fakturaadresser" tabIndex={0} className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{formerAddresses.map(renderAddress)}</div></details> : null}
      {canWrite ? <details className="mt-3 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">Lägg till adress</summary><div className="mt-3"><AddressForm customerId={customerId} customerType={customerType} /></div></details> : null}
    </div>
  </section>
}
