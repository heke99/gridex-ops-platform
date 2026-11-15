import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CustomerAddressRow, CustomerContactRow } from '@/types/customers'
import { customerProfileEditHref } from '@/lib/admin/customerProfileLinks'
import type { CustomerSiteRow } from '@/lib/masterdata/types'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => { throw new Error('Unexpected database access during rendering') } } }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => { throw new Error('Unexpected session read during rendering') } }))
vi.mock('@/lib/admin/guards', () => ({ requireAdminActionAccess: async () => { throw new Error('No writes authorized during rendering') } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/admin/customers/[id]/profile-actions', () => ({ archiveCustomerAction: async () => {}, closeCustomerLifecycleAction: async () => {}, deleteCustomerForRecreateAction: async () => {}, markCustomerAsTestDataAction: async () => {}, saveCustomerProfileAction: async () => {} }))
import ProfileSummary, { projectCustomerProfile } from '@/components/admin/customers/CustomerProfileSummary'
import ContactsCard from '@/components/admin/customers/CustomerContactsAddressesCard'
const customer = { id: 'customer', customer_type: 'private', status: 'active', first_name: 'Syntetisk', last_name: 'Kund', company_name: null, personal_number: '200001011234', org_number: null, email: 'kund@example.invalid', phone: '0701234567', apartment_number: '1234', updated_at: '2026-11-15T10:00:00Z', lifecycle_status_reason: 'RAW_LIFECYCLE_REASON', data_retention_note: 'RAW_RETENTION_NOTE', request_payload: { value: 'RAW_PAYLOAD' }, portal_user_id: 'RAW_PORTAL_ID' }
const contact = (id: string, extra = {}) => ({ id, customer_id: 'customer', company_id: 'company-a', type: 'billing', name: `Kontakt ${id}`, email: 'kontakt@example.invalid', phone: '0701234567', is_primary: true, created_at: '2026-11-15T10:00:00Z', ...extra }) as CustomerContactRow
const address = (id: string, extra = {}) => ({ id, customer_id: 'customer', company_id: 'company-a', type: 'registered', street_1: `Testvägen ${id}`, country: 'SE', postal_code: '11122', city: 'Teststad', is_active: true, moved_in_at: '2026-11-01', moved_out_at: null, ...extra }) as CustomerAddressRow
const site = (id: string, extra = {}) => ({ id, customer_id: 'customer', company_id: 'company-a', site_name: `Anläggning ${id}`, facility_id: '735999000000000001', street: 'Anläggningsvägen 1', ...extra }) as CustomerSiteRow
const renderContacts = (canWrite = false, contacts = [contact('one')], addresses = [address('one'), address('old', { is_active: false, moved_out_at: '2026-11-10' })], sites = [site('one')]) => renderToStaticMarkup(React.createElement(ContactsCard, { customerId: 'customer', companyId: 'company-a', customerType: 'private', contacts, addresses, sites, canWrite }))
beforeEach(() => { vi.stubGlobal('React', React) })
it('gives readers a server profile with business information and no mutation forms', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer }))
  expect(html).toContain('Syntetisk Kund')
  expect(html).toContain('kund@example.invalid')
  expect(html).not.toContain('<form')
  expect(html).not.toContain('RAW_')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/profile-reader-company.html`, `<main>${html}</main>`)
})
it('allowlists client profile fields and preserves concurrency and identity fields', () => {
  const projected = projectCustomerProfile(customer)
  expect(projected.updated_at).toBe(customer.updated_at)
  expect(projected.personal_number).toBe(customer.personal_number)
  expect(JSON.stringify(projected)).not.toContain('RAW_')
  expect(projected).not.toHaveProperty('request_payload')
  expect(projected).not.toHaveProperty('portal_user_id')
  expect(projectCustomerProfile(customer, true).data_retention_note).toBe('RAW_RETENTION_NOTE')
  expect(projectCustomerProfile(customer, true)).not.toHaveProperty('request_payload')
})
it('keeps authorized profile edit fields collapsed and the expected revision intact', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer, canWrite: true }))
  expect(html).toMatch(/<details[^>]*id="edit-customer-profile"[^>]*>/)
  expect(html).not.toMatch(/<details[^>]*id="edit-customer-profile"[^>]*open/)
  expect(html).toContain('name="expected_updated_at" value="2026-11-15T10:00:00Z"')
  expect(html).toContain('Spara kundprofil')
  expect(html).not.toContain('Arkivera kund')
  expect(html).not.toContain('RAW_')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/profile-writer-company.html`, `<main>${html}</main>`)
})
it('retains platform lifecycle tools behind the same profile edit disclosure', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer, canWrite: true, isPlatformAdmin: true }))
  expect(html).toContain('RAW_RETENTION_NOTE')
  expect(html).toContain('name="customer_id" value="customer"')
  expect(html).toContain('Arkivera')
  expect(html).not.toContain('RAW_PAYLOAD')
})
it('requires explicit type and status selections for unknown legacy values', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer: { ...customer, customer_type: 'RAW_CUSTOMER_TYPE', status: 'RAW_STATUS' }, canWrite: true }))
  expect(html).not.toContain('RAW_CUSTOMER_TYPE')
  expect(html).not.toContain('RAW_STATUS')
  expect(html).toContain('<option value="" disabled="" selected="">Välj kundtyp</option>')
  expect(html).toContain('<option value="" disabled="" selected="">Välj status</option>')
})
it('keeps archived profile edits locked', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer: { ...customer, status: 'archived' }, canWrite: true }))
  expect(html).toContain('Arkiverad – profil låst')
  expect(html).toContain('disabled=""')
})
it('shows Swedish contact/address roles to readers without mutation forms or technical copy', () => {
  const html = renderContacts()
  expect(html).toContain('Fakturakontakt')
  expect(html).toContain('Registrerad adress')
  for (const hidden of ['<form', '>billing<', '>registered<', 'Z01', '>Primary<', '>Registered<']) expect(html).not.toContain(hidden)
  expect(html).toContain('Tidigare adresser (1)')
  expect(html).toContain('2026-11-10')
  expect(html).not.toMatch(/<details[^>]*id="former-customer-addresses"[^>]*open/)
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/contacts-reader-company.html`, `<main>${html}</main>`)
})
it('retains writer payload names and adds no writes during rendering', () => {
  const html = renderContacts(true)
  for (const field of ['customer_id', 'customer_type', 'id', 'is_primary', 'is_active', 'moved_in_at', 'moved_out_at']) expect(html).toContain(`name="${field}"`)
  expect(html).toContain('<option value="billing" selected="">Faktura</option>')
  expect(html).toContain('<option value="registered" selected="">Registrerad adress</option>')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/contacts-writer-company.html`, `<main>${html}</main>`)
})
it('does not expose foreign customers, companies or their edit forms', () => {
  const html = renderContacts(true, [contact('own'), contact('foreign-company', { company_id: 'other' }), contact('foreign-customer', { customer_id: 'other' })], [address('own'), address('foreign-address', { company_id: 'other' })], [site('own'), site('foreign-site', { customer_id: 'other' })])
  expect(html).toContain('Kontakt own')
  for (const foreign of ['foreign-company', 'foreign-customer', 'foreign-address', 'foreign-site']) expect(html).not.toContain(foreign)
})
it('uses readable fallbacks for unknown contact/address types', () => {
  const html = renderContacts(false, [contact('one', { type: 'RAW_CONTACT_ROLE' })], [address('one', { type: 'RAW_ADDRESS_TYPE' })])
  expect(html).toContain('Kontaktroll behöver kontrolleras')
  expect(html).toContain('Adresstyp behöver kontrolleras')
  expect(html).not.toContain('RAW_')
})
it('keeps all loaded rows in bounded keyboard accessible lists', () => {
  const html = renderContacts(false, Array.from({ length: 30 }, (_, i) => contact(`long-${i}`)), Array.from({ length: 30 }, (_, i) => address(`long-${i}`)), Array.from({ length: 30 }, (_, i) => site(`long-${i}`)))
  for (const last of ['Kontakt long-29', 'Testvägen long-29', 'Anläggning long-29']) expect(html).toContain(last)
  expect(html).toContain('tabindex="0"')
  expect(html).toContain('overflow-y-auto')
  if (process.env.GRIDEX_UI_FIXTURE_DIR) fs.writeFileSync(`${process.env.GRIDEX_UI_FIXTURE_DIR}/contacts-long-company.html`, `<main>${html}</main>`)
})
it('server callers pass scoped write permissions and a working direct edit target', () => {
  const page = fs.readFileSync('app/admin/customers/[id]/page.part-4.tsx', 'utf8')
  const target = new URL(customerProfileEditHref('customer'), 'https://ops.example.invalid')
  expect(target.pathname).toBe('/admin/customers/customer')
  expect(target.searchParams.get('tab')).toBe('profile')
  expect(target.hash).toBe('#edit-customer-profile')
  expect(page).toContain('<CustomerProfileEditLink')
  expect(page).toContain('href={customerTabHref(id, "profile")}')
  expect(page).not.toContain('#profile#edit-customer-profile')
  expect(page.match(/canWrite={isPlatformAdmin \|\| canEditCustomer}/g)).toHaveLength(3)
  expect(page.match(/companyId={customerCompanyId}/g)?.length).toBeGreaterThanOrEqual(2)
})

it('preserves an existing custom contact role while requiring an explicit supported address type', () => {
  const html = renderContacts(true, [contact('one', { type: 'custom-role' })], [address('one', { type: 'old-unsupported-address-type' })])
  expect(html).toContain('<option value="custom-role" selected="">Befintlig kontaktroll</option>')
  expect(html).toContain('<option value="" disabled="" selected="">Välj adresstyp</option>')
})

it('shows the stored full name and customer number when separate name fields are absent', () => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer: { ...customer, first_name: null, last_name: null, full_name: 'Syntetiskt fullständigt namn', customer_number: 'K-123' } }))
  expect(html).toContain('Syntetiskt fullständigt namn')
  expect(html).toContain('K-123')
})
it.each(['private', 'business', 'association'])('preserves the appropriate editable identity fields for %s', customerType => {
  const html = renderToStaticMarkup(React.createElement(ProfileSummary, { customer: { ...customer, customer_type: customerType, company_name: 'Syntetiskt bolag', org_number: '5555555555' }, canWrite: true }))
  if (customerType === 'private') expect(html).toMatch(/<input(?=[^>]*name="personal_number")(?=[^>]*value="200001011234")(?=[^>]*readOnly="")[^>]*>/)
  else expect(html).toMatch(/<input(?=[^>]*name="org_number")(?=[^>]*value="5555555555")(?=[^>]*readOnly="")[^>]*>/)
})
