import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getAdminNavigationGroups } from '@/lib/admin/navigation'
import { customerEditError, isConfirmedCustomerEditResponse } from '@/components/admin/customers/CustomerEditForm'
import CustomerProfileCard from '@/components/admin/customers/CustomerProfileCard'
import AdminSidebar from '@/components/admin/AdminSidebar'
import { draftRevisionIsStale } from '@/components/admin/AdminUnsavedChanges'
import { CustomerLookupProblem, customerTabHref, normalizeWorkspaceTab } from '@/app/admin/customers/[id]/page.part-1'

vi.mock('@/app/admin/customers/[id]/profile-actions', () => ({
  saveCustomerProfileAction: vi.fn(), closeCustomerLifecycleAction: vi.fn(),
  markCustomerAsTestDataAction: vi.fn(), archiveCustomerAction: vi.fn(), deleteCustomerForRecreateAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/admin/customers/customer-a' }))
vi.mock('@/app/admin/navigation-mode/actions', () => ({ updateAdminNavigationPreference: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/operations/controlTower', () => ({ getSwitchLifecycle: vi.fn() }))

describe('tenantservice navigation is a projection of current permissions', () => {
  it('exposes customer support without technical platform tools for a tenant agent', () => {
    const groups = getAdminNavigationGroups({ permissions: ['customers.read', 'cases.read'], roles: ['customer_service_agent'], isPlatformAdmin: false })
    const items = groups.flatMap((group) => group.items)
    expect(items.map((item) => item.href)).toContain('/admin/customer-cases')
    expect(items.filter((item) => item.platformOnly || item.href.startsWith('/admin/platform') || item.href.startsWith('/admin/ediel'))).toEqual([])
  })
  it('does not mistake customer read permission for case read permission', () => {
    expect(getAdminNavigationGroups({ permissions: ['customers.read'], isPlatformAdmin: false }).flatMap((group) => group.items).map((item) => item.href)).not.toContain('/admin/customer-cases')
  })
  it('keeps the company projection when a platform operator selects company mode', () => {
    expect(getAdminNavigationGroups({ permissions: [], isPlatformAdmin: true, mode: 'company_view' }).flatMap((group) => group.items).filter((item) => item.platformOnly)).toEqual([])
  })
  it('allows an ordinary operator to select only supplied company memberships without emitting platform controls', () => {
    const markup = renderToStaticMarkup(createElement(AdminSidebar, { permissions: ['customers.read'], roles: ['viewer'], isPlatformAdmin: false, selectedCompanyId: 'tenant-a', companyOptions: [{ id: 'tenant-a', name: 'Synthetic A' }, { id: 'tenant-b', name: 'Synthetic B' }], compact: true }))
    expect(markup).toContain('name="company_id"')
    expect(markup).toContain('value="tenant-a" selected=""')
    expect(markup).toContain('aria-label="Tenantnavigation"')
    expect(markup).not.toContain('value="platform"')
    expect(markup).not.toContain('href="/admin/platform')
    expect(markup).not.toContain('<h1')
  })
  it('keeps bookmarked contact routes on the one shared profile panel and encodes the resource segment', () => {
    expect(normalizeWorkspaceTab('contacts-addresses')).toBe('profile')
    expect(customerTabHref('customer/a?tab=technical-details', 'profile')).toBe('/admin/customers/customer%2Fa%3Ftab%3Dtechnical-details?tab=profile#profile')
  })
  it('does not expose technical navigation from a tenant customer lookup error', () => {
    const props = { title: 'Synthetic lookup', description: 'Synthetic unavailable customer', lookupId: 'opaque-id' }
    expect(renderToStaticMarkup(createElement(CustomerLookupProblem, props))).not.toContain('href="/admin/ediel"')
    expect(renderToStaticMarkup(createElement(CustomerLookupProblem, { ...props, showPlatformLink: true }))).toContain('href="/admin/ediel"')
  })
})

describe('editable cards surface safe, actionable command outcomes', () => {
  it('requires a validated completion before showing success, including a nonnegative safe revision', () => {
    expect(isConfirmedCustomerEditResponse({ revision: 4, changed: true, replayed: false })).toBe(true)
    expect(isConfirmedCustomerEditResponse({ revision: 4, changed: true, replayed: false, notice: 'Adressförslaget behöver granskas.' })).toBe(true)
    expect(isConfirmedCustomerEditResponse({ revision: 4, changed: true, replayed: false, notice: { error: 'unconfirmed' } })).toBe(false)
    for (const value of [null, undefined, {}, { status: 'success' }, { revision: -1, changed: true, replayed: false }, { revision: Infinity, changed: true, replayed: false }, { revision: 4, changed: 'true', replayed: false }, { error: true, code: 'billing_profile_unconfirmed' }]) expect(isConfirmedCustomerEditResponse(value)).toBe(false)
    expect(isConfirmedCustomerEditResponse({ confirmed: true, changed: true, replayed: false })).toBe(false)
  })
  it('explains a pre-write address validation failure and never encourages replaying an unconfirmed legacy insertion', () => {
    expect(customerEditError({ code: 'invalid_customer_address' }).message).toContain('gatuadress')
    expect(customerEditError({ code: 'address_save_unconfirmed' }).message).toContain('Läs om sidan')
    expect(customerEditError({ code: 'address_save_unconfirmed' }).message).not.toContain('Försök igen')
  })
  it('does not rebase a restored draft onto a new saved revision', () => {
    const draft = [{ name: 'expected_revision', value: '4' }, { name: 'idempotency_key', value: 'attempt-a' }, { name: 'phone', value: 'draft-phone' }]
    expect(draftRevisionIsStale([{ name: 'expected_revision', value: '5' }], draft)).toBe(true)
    expect(draftRevisionIsStale([{ name: 'expected_revision', value: '4' }, { name: 'idempotency_key', value: 'attempt-b' }], draft)).toBe(false)
    expect(draftRevisionIsStale([{ name: 'expected_override_revision', value: '2' }], [{ name: 'expected_override_revision', value: '1' }])).toBe(true)
    expect(draft).toContainEqual({ name: 'expected_revision', value: '4' })
  })
  it('retains the address-book revision when a restored address draft is stale', () => {
    const draft = [{ name: 'expected_address_revision', value: '3' }, { name: 'idempotency_key', value: 'address-attempt-key' }]
    expect(draftRevisionIsStale([{ name: 'expected_address_revision', value: '4' }], draft)).toBe(true)
    expect(draft).toContainEqual({ name: 'expected_address_revision', value: '3' })
  })
  it('keeps a stale site draft bound to its original persisted revision', () => {
    const draft = [{ name: 'expected_site_revision', value: '2' }, { name: 'idempotency_key', value: 'site-attempt-key' }]
    expect(draftRevisionIsStale([{ name: 'expected_site_revision', value: '3' }], draft)).toBe(true)
    expect(draftRevisionIsStale([{ name: 'expected_site_revision', value: '2' }], draft)).toBe(false)
    expect(customerEditError({ code: 'site_revision_conflict' }).conflict).toBe(true)
    expect(customerEditError({ code: 'site_idempotency_conflict' }).conflict).toBe(true)
    expect(draft).toContainEqual({ name: 'expected_site_revision', value: '2' })
  })
  it.each(['contact_revision_conflict', 'contact_selection_conflict', 'billing_profile_revision_conflict', 'billing_profile_override_revision_conflict', 'support_revision_conflict', 'legal_profile_revision_conflict', 'customer_lifecycle_revision_conflict', 'address_book_revision_conflict', 'lifecycle_revision_conflict', 'lifecycle_state_conflict', 'lifecycle_resource_conflict'])('preserves the draft and explains %s', (code) => {
    expect(customerEditError({ code })).toMatchObject({ conflict: true, message: expect.stringContaining('Ditt utkast är kvar') })
  })
  it.each(['contact_idempotency_conflict', 'billing_profile_idempotency_conflict', 'billing_profile_override_idempotency_conflict', 'support_idempotency_conflict', 'legal_profile_idempotency_conflict', 'customer_lifecycle_idempotency_conflict', 'address_book_idempotency_conflict', 'lifecycle_idempotency_conflict'])('prevents blindly retrying the changed payload for %s', (code) => {
    expect(customerEditError({ code }).conflict).toBe(true)
  })
  it('does not expose a database error or credentials in UI text', () => {
    const message = customerEditError(new Error('postgres://secret/password unexpected column customer_private')).message
    expect(message).not.toContain('postgres')
    expect(message).not.toContain('password')
    expect(message).toContain('försöksnyckel')
  })
  it('makes legal profile read-only unless the server supplied a write capability', () => {
    const customer = { id: 'synthetic-customer', customer_type: 'private', status: 'active', first_name: 'Synthetic', last_name: 'Customer', company_name: null, personal_number: null, org_number: null, email: 'synthetic@example.invalid', phone: '+461234567', contact_revision: 4, apartment_number: null }
    const markup = renderToStaticMarkup(createElement(CustomerProfileCard, { customer, showLifecycleTools: true, canEdit: false }))
    expect(markup).toContain('Läsläge')
    expect(markup).not.toContain('<form')
    expect(markup).not.toContain('Radera testkund')
    expect(markup).not.toContain('Spara kundprofil')
  })
  it('does not invent legal revision zero when the loaded revision is absent', () => {
    const customer = { id: 'synthetic-customer', customer_type: 'private', status: 'active', first_name: 'Synthetic', last_name: 'Customer', company_name: null, personal_number: null, org_number: null, email: null, phone: null, contact_revision: 4, apartment_number: null }
    const markup = renderToStaticMarkup(createElement(CustomerProfileCard, { customer, canEdit: true, showLifecycleTools: false, idempotencyKey: 'synthetic-legal-key' }))
    expect(markup).not.toContain('<form')
    expect(markup).toContain('profilrevision eller försöksnyckel saknas')
  })
  it('binds permitted legal editing to the displayed revision and keeps status outside that command', () => {
    const customer = { id: 'synthetic-customer', customer_type: 'business', status: 'active', first_name: null, last_name: null, company_name: 'Synthetic Business', personal_number: null, org_number: 'synthetic', email: null, phone: null, contact_revision: 4, legal_profile_revision: 5, apartment_number: null }
    const markup = renderToStaticMarkup(createElement(CustomerProfileCard, { customer, canEdit: true, showLifecycleTools: false, idempotencyKey: 'synthetic-legal-key' }))
    expect(markup).toContain('name="expected_legal_profile_revision" value="5"')
    expect(markup).toContain('name="idempotency_key" value="synthetic-legal-key"')
    expect(markup).toContain('Registrerat förnamn')
    expect(markup).not.toContain('<select name="status"')
    expect(markup).not.toContain('Kontaktperson förnamn')
    expect(markup).not.toContain('name="email"')
    expect(markup).not.toContain('name="phone"')
  })
  it('projects authorized tenant lifecycle capability independently of dangerous platform controls', () => {
    const customer = { id: 'synthetic-customer', customer_type: 'private', status: 'active', first_name: 'Synthetic', last_name: 'Customer', company_name: null, personal_number: null, org_number: null, email: null, phone: null, contact_revision: 4, legal_profile_revision: 5, lifecycle_revision: 2, apartment_number: null }
    const markup = renderToStaticMarkup(createElement(CustomerProfileCard, { customer, canEdit: true, showLifecycleTools: true, showPlatformTools: false, idempotencyKey: 'synthetic-legal-key' }))
    expect(markup).toContain('Registrera flytt / avslut')
    expect(markup).toContain('name="expected_lifecycle_revision" value="2"')
    expect(markup).toContain('name="idempotency_key" value="synthetic-legal-key:lifecycle"')
    expect(markup).toContain('name="confirm_close"')
    expect(markup).not.toContain('Markera som testdata')
    expect(markup).not.toContain('Radera testkund')
    expect(markup).not.toContain('Arkivera kund')
  })
})
