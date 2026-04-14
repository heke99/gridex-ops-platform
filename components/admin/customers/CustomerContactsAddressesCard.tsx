import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import type { CustomerAddressRow, CustomerContactRow } from '@/types/customers'

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
  const type = getString(formData, 'type') || 'primary'
  const name = getString(formData, 'name') || null
  const email = getString(formData, 'email') || null
  const phone = getString(formData, 'phone') || null
  const title = getString(formData, 'title') || null
  const isPrimary = getCheckbox(formData, 'is_primary')

  if (!customerId) {
    throw new Error('customer_id saknas')
  }

  if (!name && !email && !phone) {
    throw new Error('Ange minst namn, e-post eller telefon')
  }

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

  await insertAuditLog({
    actorUserId,
    entityType: 'customer_contact',
    entityId: data.id,
    action: contactId ? 'customer_contact_updated' : 'customer_contact_created',
    oldValues: before.data,
    newValues: data,
    metadata: {
      customerId,
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
  const type = getString(formData, 'type') || 'facility'
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
      isActive,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
}

function badgeTone(active: boolean): string {
  return active
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
}

function ContactForm({
  customerId,
  contact,
}: {
  customerId: string
  contact?: CustomerContactRow
}) {
  return (
    <form
      action={saveCustomerContactAction}
      className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
    >
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="id" value={contact?.id ?? ''} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Typ</span>
          <select
            name="type"
            defaultValue={contact?.type ?? 'primary'}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <option value="primary">Primary</option>
            <option value="billing">Billing</option>
            <option value="operations">Operations</option>
            <option value="technical">Technical</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Titel / roll</span>
          <input
            name="title"
            defaultValue={contact?.title ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Namn</span>
          <input
            name="name"
            defaultValue={contact?.name ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">E-post</span>
          <input
            type="email"
            name="email"
            defaultValue={contact?.email ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Telefon</span>
          <input
            name="phone"
            defaultValue={contact?.phone ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>
      </div>

      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
        <input
          type="checkbox"
          name="is_primary"
          defaultChecked={contact?.is_primary ?? false}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span>Primär kontakt</span>
      </label>

      <div className="flex justify-end">
        <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
          {contact ? 'Spara kontakt' : 'Lägg till kontakt'}
        </button>
      </div>
    </form>
  )
}

function AddressForm({
  customerId,
  address,
}: {
  customerId: string
  address?: CustomerAddressRow
}) {
  return (
    <form
      action={saveCustomerAddressAction}
      className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
    >
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="id" value={address?.id ?? ''} />

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Typ</span>
          <select
            name="type"
            defaultValue={address?.type ?? 'facility'}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <option value="registered">Registered</option>
            <option value="billing">Billing</option>
            <option value="facility">Facility</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Land</span>
          <input
            name="country"
            defaultValue={address?.country ?? 'SE'}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Gatuadress</span>
          <input
            name="street_1"
            defaultValue={address?.street_1 ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm md:col-span-2">
          <span className="text-slate-600 dark:text-slate-300">Adressrad 2 / c/o</span>
          <input
            name="street_2"
            defaultValue={address?.street_2 ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Postnummer</span>
          <input
            name="postal_code"
            defaultValue={address?.postal_code ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Stad</span>
          <input
            name="city"
            defaultValue={address?.city ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Kommun</span>
          <input
            name="municipality"
            defaultValue={address?.municipality ?? ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Inflyttad</span>
          <input
            type="date"
            name="moved_in_at"
            defaultValue={address?.moved_in_at ? address.moved_in_at.slice(0, 10) : ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Utflyttad</span>
          <input
            type="date"
            name="moved_out_at"
            defaultValue={address?.moved_out_at ? address.moved_out_at.slice(0, 10) : ''}
            className="rounded-2xl border border-slate-300 px-4 py-3 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          />
        </label>
      </div>

      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={address?.is_active ?? true}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span>Aktiv adress</span>
      </label>

      <div className="flex justify-end">
        <button className="inline-flex items-center rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black dark:bg-white dark:text-slate-950">
          {address ? 'Spara adress' : 'Lägg till adress'}
        </button>
      </div>
    </form>
  )
}

export default function CustomerContactsAddressesCard({
  customerId,
  contacts,
  addresses,
}: {
  customerId: string
  contacts: CustomerContactRow[]
  addresses: CustomerAddressRow[]
}) {
  return (
    <section className="grid gap-6 xl:grid-cols-2">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Kontakter
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Primär kontakt, faktura, drift och tekniska kontaktpersoner.
          </p>
        </div>

        <div className="space-y-4 p-6">
          {contacts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Inga kontaktposter ännu.
            </div>
          ) : (
            contacts.map((contact) => (
              <article
                key={contact.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">
                      {contact.name ?? 'Namnlös kontakt'}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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

                <div className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <div>E-post: {contact.email ?? '—'}</div>
                  <div>Telefon: {contact.phone ?? '—'}</div>
                  <div>Skapad: {formatDateTime(contact.created_at)}</div>
                </div>

                <details className="mt-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
                    Redigera kontakt
                  </summary>
                  <div className="mt-4">
                    <ContactForm customerId={customerId} contact={contact} />
                  </div>
                </details>
              </article>
            ))
          )}

          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
              Lägg till ny kontakt
            </summary>
            <div className="mt-4">
              <ContactForm customerId={customerId} />
            </div>
          </details>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Adresser
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Registrerad adress, fakturaadress och anläggningsadress per kund.
          </p>
        </div>

        <div className="space-y-4 p-6">
          {addresses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Inga adressposter ännu.
            </div>
          ) : (
            addresses.map((address) => (
              <article
                key={address.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">
                      {address.street_1}
                    </div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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

                <div className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <div>
                    {address.postal_code ?? '—'} {address.city ?? ''}
                  </div>
                  <div>Land: {address.country}</div>
                  <div>Inflyttad: {formatDateTime(address.moved_in_at)}</div>
                </div>

                <details className="mt-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
                    Redigera adress
                  </summary>
                  <div className="mt-4">
                    <AddressForm customerId={customerId} address={address} />
                  </div>
                </details>
              </article>
            ))
          )}

          <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 dark:text-white">
              Lägg till ny adress
            </summary>
            <div className="mt-4">
              <AddressForm customerId={customerId} />
            </div>
          </details>
        </div>
      </div>
    </section>
  )
}