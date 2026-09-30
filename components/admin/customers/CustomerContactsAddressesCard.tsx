import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import { assertUserCanOperateCompany } from '@/lib/tenant/scope'
import { changeCustomerContact, ContactCommandError } from '@/lib/customer-operations/contactCommand'
import { changeCustomerAddress, AddressCommandError, type CustomerAddressChanges } from '@/lib/customer-operations/addressCommand'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import CustomerEditForm, { type CustomerEditResponse } from './CustomerEditForm'
import type {
 CustomerAddressRow,
 CustomerContactRow,
 CustomerType,
} from '@/types/customers'
import type { CustomerSiteRow } from '@/lib/masterdata/types'

function formatDateTime(value: string | null | undefined): string {
 if (!value) return '—'

 return new Intl.DateTimeFormat('sv-SE', {
 dateStyle: 'medium',
 timeStyle: 'short',
 }).format(new Date(value))
}

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

async function authorizedCustomerCompany(actorUserId: string, customerId: string): Promise<string> {
 const { data, error } = await supabaseService
 .from('customers')
 .select('id,company_id,status')
 .eq('id', customerId)
 .maybeSingle()

 if (error) throw error
 if (!data?.company_id) throw new Error('Forbidden')
 const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])
 if (guard.userId !== actorUserId || (!guard.isPlatformAdmin && guard.companyId !== data.company_id)) {
 throw new Error('Forbidden')
 }
 const companyId = await assertUserCanOperateCompany(actorUserId, data.company_id)
 if (data.status === 'archived') throw new Error('Archived customer')
 return companyId
}

export async function saveCustomerContactAction(formData: FormData) {
 'use server'
 await executeCustomerContact(formData)
}

async function executeCustomerContact(formData: FormData) {

 const actorUserId = await getActorUserId()
 const session = await currentSupportSession('ops', actorUserId)

 const customerId = getString(formData, 'customer_id')
 const contactId = getString(formData, 'id')
 const customerType = normalizeCustomerType(getString(formData, 'customer_type'))
 const typeInput = getString(formData, 'type') || 'primary'
 const name = normalizeNullableString(getString(formData, 'name'))
 const email = normalizeNullableString(getString(formData, 'email'))
 const phone = normalizeNullableString(getString(formData, 'phone'))
 const titleInput = normalizeNullableString(getString(formData, 'title'))
 const isPrimary = getCheckbox(formData, 'is_primary')
 const expectedRevision = Number(getString(formData, 'expected_revision'))
 const idempotencyKey = getString(formData, 'idempotency_key')

 if (!customerId) {
 throw new Error('customer_id saknas')
 }

 if (!name && !email && !phone) {
 throw new Error('Ange minst namn, e-post eller telefon')
 }

 if ((customerType === 'business' || customerType === 'association') && isPrimary && !name) {
 throw new Error('Företag eller förening kräver namn på primär kontaktperson')
 }

 const companyId = await authorizedCustomerCompany(actorUserId, customerId)

 if (!isPrimary && !['billing', 'operations', 'technical', 'other'].includes(typeInput)) {
   throw new Error('Välj en giltig typ för sekundär kontakt')
 }

 const before = contactId
 ? await supabaseService
 .from('customer_contacts')
 .select('*')
 .eq('id', contactId)
 .eq('customer_id', customerId)
 .eq('company_id', companyId)
 .maybeSingle()
 : { data: null, error: null }

 if (before.error) throw before.error
 if (contactId && !before.data) throw new Error('Forbidden')
 if (!isPrimary && before.data?.is_primary) {
   throw new Error('Primär kontakt kan endast ändras med kontaktkommandot.')
 }

 const result = await changeCustomerContact({
   companyId,
   customerId,
   contactId: contactId || null,
   ...(isPrimary ? {} : {
     contactTarget: 'secondary' as const,
     contactType: typeInput as 'billing' | 'operations' | 'technical' | 'other',
   }),
   actor: { kind: 'ops', userId: session.userId, sessionId: session.sessionId, reason: 'OPS customer contact form' },
   expectedRevision,
   idempotencyKey,
   changes: { name, title: titleInput, email, phone },
 })

 revalidatePath(`/admin/customers/${customerId}`)
 return result
}

export async function saveCustomerContactFormAction(formData: FormData): Promise<CustomerEditResponse> {
 'use server'
 try {
   return await executeCustomerContact(formData)
 } catch (error) {
   unstable_rethrow(error)
   // Never serialize SQL messages, internal details or an untrusted raw error to the browser.
   if (error instanceof ContactCommandError) return { error: true, code: error.code }
   const message = error instanceof Error ? error.message : ''
   if (error && typeof error === 'object' && 'code' in error && error.code === 'support_session_revoked') return { error: true, code: 'support_session_revoked' }
   if (['Forbidden', 'Unauthorized', 'Archived customer'].includes(message) || message.startsWith('Du saknar behörighet')) return { error: true, code: 'contact_actor_forbidden' }
   if (['Ange minst namn, e-post eller telefon', 'Företag eller förening kräver namn på primär kontaktperson', 'Välj en giltig typ för sekundär kontakt'].includes(message)) return { error: true, code: message }
   return { error: true, code: 'contact_save_unconfirmed' }
 }
}

export async function saveCustomerAddressAction(formData: FormData) {
 'use server'
 await executeCustomerAddress(formData)
}

async function executeCustomerAddress(formData: FormData) {

 const actorUserId = await getActorUserId()
 const session = await currentSupportSession('ops', actorUserId)

 const customerId = getString(formData, 'customer_id')
 const addressId = getString(formData, 'id')
 const type = getString(formData, 'type') || 'registered'
 const street1 = getString(formData, 'street_1')
 const street2 = getString(formData, 'street_2') || null
 const postalCode = getString(formData, 'postal_code') || null
 const city = getString(formData, 'city') || null
 const country = (getString(formData, 'country') || 'SE').toUpperCase()
 const municipality = getString(formData, 'municipality') || null
 const movedInAt = getString(formData, 'moved_in_at') || null
 const movedOutAt = getString(formData, 'moved_out_at') || null
 const isActive = getCheckbox(formData, 'is_active')
 const revisionInput = getString(formData, 'expected_address_revision')
 const idempotencyKey = getString(formData, 'idempotency_key')

 if (!customerId) {
 throw new Error('customer_id saknas')
 }

 if (!street1) {
 throw new Error('Gatuadress krävs')
 }

 if (!['registered', 'billing', 'other'].includes(type)) {
 throw new Error('Anläggningsadress ändras under anläggningsuppgifter.')
 }
 const companyId = await authorizedCustomerCompany(actorUserId, customerId)
 if (!/^[0-9]{1,16}$/.test(revisionInput)) throw new AddressCommandError('invalid_address_command', 422)
 const changes: CustomerAddressChanges = {
 type: type as CustomerAddressChanges['type'],
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

 const result = await changeCustomerAddress({
 companyId, customerId, addressId: addressId || null,
 actor: { kind: 'ops', userId: session.userId, sessionId: session.sessionId, reason: 'OPS customer address-book form' },
 expectedRevision: Number(revisionInput), idempotencyKey, changes,
 })

 revalidatePath(`/admin/customers/${customerId}`)
 return result
}

export async function saveCustomerAddressFormAction(formData: FormData): Promise<CustomerEditResponse> {
 'use server'
 try {
   return await executeCustomerAddress(formData)
 } catch (error) {
   unstable_rethrow(error)
   if (error instanceof AddressCommandError) return { error: true, code: error.code }
   if (error && typeof error === 'object' && 'code' in error && error.code === 'support_session_revoked') return { error: true, code: 'support_session_revoked' }
   const message = error instanceof Error ? error.message : ''
   if (['Forbidden', 'Unauthorized', 'Archived customer'].includes(message) || message.startsWith('Du saknar behörighet')) return { error: true, code: 'address_actor_forbidden' }
   if (['Gatuadress krävs', 'Anläggningsadress ändras under anläggningsuppgifter.', 'invalid_customer_address'].includes(message)) return { error: true, code: 'invalid_customer_address' }
   return { error: true, code: 'address_save_unconfirmed' }
 }
}

function badgeTone(active: boolean): string {
 return active
 ? 'bg-emerald-100 text-emerald-700 '
 : 'bg-slate-100 text-slate-700 '
}

function contactIntro(customerType: CustomerType): string {
 if (customerType === 'private') {
 return 'Privatkundens huvudkontakt är normalt kunden själv. Primär kontakt bör därför spegla den person som faktiskt ska nås.'
 }

 if (customerType === 'association') {
 return 'Förening bör ha en tydlig primär kontaktperson, till exempel ordförande, administratör eller styrelsekontakt.'
 }

 return 'Företag bör ha en tydlig primär kontaktperson, till exempel VD, ekonomiansvarig eller driftkontakt.'
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
 contactRevision,
 contact,
 defaultIsPrimary = false,
}: {
 customerId: string
 customerType: CustomerType
 contactRevision: number
 contact?: CustomerContactRow
 defaultIsPrimary?: boolean
}) {
 const isPrimaryContact = contact?.is_primary ?? defaultIsPrimary

 return (
 <CustomerEditForm
 key={`${customerId}:${contact?.id ?? 'new'}:${contactRevision}`}
 action={saveCustomerContactFormAction}
 fallbackAction={saveCustomerContactAction}
 submitLabel={contact ? 'Spara kontakt' : 'Lägg till kontakt'}
 draftKey={`${customerId}/contact/${contact?.id ?? 'new'}`}
 className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="customer_type" value={customerType} />
 <input type="hidden" name="id" value={contact?.id ?? ''} />
 <input type="hidden" name="expected_revision" defaultValue={contactRevision} />
 <input type="hidden" name="idempotency_key" defaultValue={randomUUID()} />

 <div className="grid gap-4 md:grid-cols-2">
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Typ</span>
 <select
 name="type"
 defaultValue={contact?.type ?? (isPrimaryContact ? 'primary' : 'other')}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 >
 <option value="primary">Primär kontakt</option>
 <option value="billing">Fakturering</option>
 <option value="operations">Drift</option>
 <option value="technical">Teknik</option>
 <option value="other">Övrig</option>
 </select>
 </label>

 <label className="grid gap-1 text-sm">
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
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
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
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">E-post</span>
 <input
 type="email"
 autoComplete="email"
 spellCheck={false}
 name="email"
 defaultValue={contact?.email ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Telefon</span>
 <input
 name="phone"
 type="tel"
 autoComplete="tel"
 defaultValue={contact?.phone ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>
 </div>

 <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm ">
 <input
 type="checkbox"
 name="is_primary"
 defaultChecked={isPrimaryContact}
 className="h-4 w-4 rounded border-slate-300"
 />
 <span>Primär kontakt</span>
 </label>

 <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-700 ">
 Primär kontakt synkar kundens huvuduppgifter för e-post och telefon när du sparar.
 </div>

 </CustomerEditForm>
 )
}

function AddressForm({
 customerId,
 customerType,
 addressBookRevision,
 address,
}: {
 customerId: string
 customerType: CustomerType
 addressBookRevision: number
 address?: CustomerAddressRow
}) {
 return (
 <CustomerEditForm
 key={`${customerId}:${address?.id ?? 'new'}:${addressBookRevision}`}
 action={saveCustomerAddressFormAction}
 fallbackAction={saveCustomerAddressAction}
 submitLabel={address ? 'Spara adress' : 'Lägg till adress'}
 draftKey={`${customerId}/address/${address?.id ?? 'new'}`}
 className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="customer_id" value={customerId} />
 <input type="hidden" name="customer_type" value={customerType} />
 <input type="hidden" name="id" value={address?.id ?? ''} />
 <input type="hidden" name="expected_address_revision" defaultValue={addressBookRevision} />
 <input type="hidden" name="idempotency_key" defaultValue={randomUUID()} />

 <div className="grid gap-4 md:grid-cols-2">
 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Typ</span>
 <select
 name="type"
 defaultValue={address?.type ?? defaultAddressType(customerType)}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 >
 <option value="registered">Registered</option>
 <option value="billing">Billing</option>
 <option value="other">Other</option>
 </select>
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Land</span>
 <input
 name="country"
 autoComplete="country"
 minLength={2}
 maxLength={2}
 pattern="[A-Za-z]{2}"
 defaultValue={address?.country ?? 'SE'}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Gatuadress</span>
 <input
 name="street_1"
 autoComplete="address-line1"
 required
 defaultValue={address?.street_1 ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm md:col-span-2">
 <span className="text-slate-700 ">Adressrad 2 / c/o</span>
 <input
 name="street_2"
 autoComplete="address-line2"
 defaultValue={address?.street_2 ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Postnummer</span>
 <input
 name="postal_code"
 autoComplete="postal-code"
 defaultValue={address?.postal_code ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Stad</span>
 <input
 name="city"
 autoComplete="address-level2"
 defaultValue={address?.city ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Kommun</span>
 <input
 name="municipality"
 defaultValue={address?.municipality ?? ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Inflyttad</span>
 <input
 type="date"
 name="moved_in_at"
 defaultValue={address?.moved_in_at ? address.moved_in_at.slice(0, 10) : ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
 />
 </label>

 <label className="grid gap-1 text-sm">
 <span className="text-slate-700 ">Utflyttad</span>
 <input
 type="date"
 name="moved_out_at"
 defaultValue={address?.moved_out_at ? address.moved_out_at.slice(0, 10) : ''}
 className="min-h-11 w-full min-w-0 rounded-2xl border border-slate-300 bg-white px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
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

 </CustomerEditForm>
 )
}

export default function CustomerContactsAddressesCard({
 customerId,
 customerType,
 contacts,
 addresses,
 sites,
 contactRevision,
 addressBookRevision,
 canEdit,
}: {
 customerId: string
 customerType: CustomerType
 contacts: CustomerContactRow[]
 addresses: CustomerAddressRow[]
 sites: CustomerSiteRow[]
 contactRevision: number
 addressBookRevision?: number
 canEdit: boolean
}) {
 const contactAddresses = addresses.filter((address) => ['registered', 'billing', 'other'].includes(address.type))
 const loadedAddressBookRevision = typeof addressBookRevision === 'number' && Number.isSafeInteger(addressBookRevision) && addressBookRevision >= 0
   ? addressBookRevision : null
 return (
 <section className="grid gap-6 xl:grid-cols-2">
 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Kontakter
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {contactIntro(customerType)}
 </p>
 <p className="mt-1 text-xs text-slate-600">Sparad kontaktrevision: {contactRevision}</p>
 {!canEdit ? <p className="mt-2 text-sm font-semibold text-slate-800">Läsläge – kontaktuppgifter och adresser kan inte ändras med din roll eller kundens status.</p> : null}
 </div>

 <div className="space-y-4 p-6">
 {contacts.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-700 ">
 Inga kontaktposter ännu.
 </div>
 ) : (
 contacts.map((contact) => (
 <article
 key={contact.id}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="font-medium text-slate-900 ">
 {contact.name ?? 'Namnlös kontakt'}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {contact.type}
 {contact.title ? ` • ${contact.title}` : ''}
 </div>
 </div>

 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
 contact.is_primary
 )}`}
 >
 {contact.is_primary ? 'Primär' : 'Sekundär'}
 </span>
 </div>

 <div className="mt-3 space-y-1 break-words text-sm text-slate-700">
 <div>E-post: {contact.email ?? '—'}</div>
 <div>Telefon: {contact.phone ?? '—'}</div>
 <div>Skapad: {formatDateTime(contact.created_at)}</div>
 </div>

 {canEdit ? <details className="mt-4">
 <summary className="min-h-11 cursor-pointer rounded-xl p-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
 Redigera kontakt
 </summary>
 <div className="mt-4">
 <ContactForm
 customerId={customerId}
 customerType={customerType}
 contactRevision={contactRevision}
 contact={contact}
 />
 </div>
 </details> : null}
 </article>
 ))
 )}

 {canEdit ? <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 ">
 <summary className="min-h-11 cursor-pointer rounded-xl p-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
 Lägg till ny kontakt
 </summary>
 <div className="mt-4">
 <ContactForm customerId={customerId} customerType={customerType} contactRevision={contactRevision} defaultIsPrimary={!contacts.some((contact) => contact.is_primary)} />
 </div>
 </details> : null}
 </div>
 </div>

 <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ">
 <div className="border-b border-slate-200 px-6 py-5 ">
 <h2 className="text-lg font-semibold text-slate-900 ">
 Adresser
 </h2>
 <p className="mt-1 text-sm text-slate-700 ">
 {addressIntro(customerType)}
 </p>
 <p className="mt-1 text-xs text-slate-600">Sparad adressrevision: {loadedAddressBookRevision ?? 'saknas'}</p>
 {canEdit && loadedAddressBookRevision === null ? <p className="mt-2 text-sm font-semibold text-slate-800">Läsläge – sparad adressrevision saknas. Läs om uppgifterna innan du ändrar adressboken.</p> : null}
 </div>

 <div className="space-y-4 p-6">
 <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-800">
 <div className="font-semibold text-slate-950">Anläggningsadress</div>
 <p className="mt-1 text-xs leading-5 text-slate-700">Används för nätägarmatchning, Z01 och leverantörsbyte. Ändras under anläggningsuppgifter.</p>
 <div className="mt-3 space-y-2">
 {sites.length === 0 ? <div className="text-slate-600">Ingen anläggning registrerad ännu.</div> : sites.map((site) => (
 <div key={site.id} className="rounded-xl border border-sky-100 bg-white px-3 py-2">
 <div className="font-medium text-slate-950">{site.site_name}</div>
 <div className="mt-1 text-slate-700">{[site.care_of, site.street, [site.postal_code, site.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adress saknas'}</div>
 <div className="mt-1 text-xs text-slate-500">Anläggnings-ID: {site.facility_id ?? 'saknas'}</div>
 </div>
 ))}
 </div>
 </div>

 {contactAddresses.length === 0 ? (
 <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-700 ">
 Inga kontakt- eller fakturaadresser ännu.
 </div>
 ) : (
 contactAddresses.map((address) => (
 <article
 key={address.id}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="font-medium text-slate-900 ">
 {address.street_1}
 </div>
 <div className="mt-1 text-xs text-slate-700 ">
 {address.type}
 {address.street_2 ? ` • ${address.street_2}` : ''}
 </div>
 </div>

 <span
 className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badgeTone(
 address.is_active
 )}`}
 >
 {address.is_active ? 'Aktiv' : 'Inaktiv'}
 </span>
 </div>

 <div className="mt-3 space-y-1 break-words text-sm text-slate-700">
 <div>
 {address.postal_code ?? '—'} {address.city ?? ''}
 </div>
 <div>Land: {address.country}</div>
 <div>Inflyttad: {formatDateTime(address.moved_in_at)}</div>
 </div>

 {canEdit && loadedAddressBookRevision !== null ? <details className="mt-4">
 <summary className="min-h-11 cursor-pointer rounded-xl p-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
 Redigera adress
 </summary>
 <div className="mt-4">
 <AddressForm
 customerId={customerId}
 customerType={customerType}
 addressBookRevision={loadedAddressBookRevision}
 address={address}
 />
 </div>
 </details> : null}
 </article>
 ))
 )}

 {canEdit && loadedAddressBookRevision !== null ? <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 ">
 <summary className="min-h-11 cursor-pointer rounded-xl p-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700">
 Lägg till ny adress
 </summary>
 <div className="mt-4">
 <AddressForm customerId={customerId} customerType={customerType} addressBookRevision={loadedAddressBookRevision} />
 </div>
 </details> : null}
 </div>
 </div>
 </section>
 )
}
