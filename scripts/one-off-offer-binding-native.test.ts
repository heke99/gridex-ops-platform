import { randomUUID } from 'node:crypto'
import { beforeAll, expect, it, vi } from 'vitest'

// Real disposable replay, real save/publish/legal/publication functions and
// every customer_contracts trigger. The existing fixture provisions a tenant
// whose catalog offer publishes through the same gated command; nothing here
// seeds a published, locked or reserved row.
vi.mock('server-only', () => ({}))
import { supabaseService } from '@/lib/supabase/service'
import { futureNativeSupplyDate, literal, nativeSql as sql, seedNormalSwitchNativeFixture, type NormalSwitchStageNativeFixture } from './helpers/ediel-normal-switch-native-fixture'

type Fixture = NormalSwitchStageNativeFixture
type Chain = { status: string; contract_offer_id: string | null; contract_publication_version_id: string | null;
  offer_active: boolean | null; offer_lifecycle: string | null; publication_status: string | null; publication_locked: boolean | null;
  legal_locked: boolean | null; reserved_for: string | null }

let f: Fixture

beforeAll(async () => {
  f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(), deferOriginal: true })
  grantContractPublishing()
})

function chain(contractId: string): Chain {
  return sql<Chain>(`SELECT jsonb_build_object('status',c.status,'contract_offer_id',c.contract_offer_id,
    'contract_publication_version_id',c.contract_publication_version_id,'offer_active',o.is_active,
    'offer_lifecycle',o.lifecycle_status,'publication_status',v.status,'publication_locked',v.locked_at IS NOT NULL,
    'legal_locked',l.locked_at IS NOT NULL,'reserved_for',r.consumed_contract_id)
    FROM public.customer_contracts c
    LEFT JOIN public.contract_offers o ON o.id=c.contract_offer_id
    LEFT JOIN public.contract_publication_versions v ON v.id=c.contract_publication_version_id
    LEFT JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
    LEFT JOIN gridex_one_off_offer_binding.reservations r ON r.offer_id=c.contract_offer_id
    WHERE c.id=${literal(contractId)} AND c.company_id=${literal(f.companyId)}`)
}

// The fixture keeps only explicit per-actor permissions. A staff member who
// creates or sends a one-off contract publishes its offer, so this actor gets
// exactly the contract/pricing permissions the gated commands check.
function grantContractPublishing() {
  const keys = ['contracts.create', 'contracts.edit_draft', 'contracts.publish', 'pricing.write', 'pricing.publish']
  sql(`INSERT INTO public.permissions(key,name,description,category)
    SELECT k,k,'Native fixture catalog key','native_fixture' FROM unnest(ARRAY[${keys.map(literal).join(',')}]) k
    WHERE NOT EXISTS(SELECT FROM public.permissions p WHERE p.key=k);
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions WHERE key IN (${keys.map(literal).join(',')})
    ON CONFLICT DO NOTHING;`)
}

// Same commercial snapshot shape the app builds (and the fixture's catalog
// offer publishes with); SQL consumers carry only the contract's price_area_used.
const pricing = { schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption',
  interval_resolution: 'hourly', vat_rate: 0.25,
  base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: 'SE3' }],
  price_components: [
    { component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
    { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', website_card_visible: true }] }

// Customer-card create, as lib/customer-contracts/db.ts createCustomerContract
// composes it: preallocate the contract ID, bind for it, then INSERT with it.
// (The TS function itself also writes legacy columns the clean replay omits.)
async function cardCreate(actorUserId = f.actorUserId) {
  const id = randomUUID()
  const { data, error } = await supabaseService.rpc('gridex_prepare_manual_contract_binding', {
    p_company_id: f.companyId,
    p_payload: { intended_contract_id: id, name: `Kundspecifikt ${id}`, contract_type: 'variable_hourly', customer_type: 'both',
      pricing_model: 'spot', energy_direction: 'consumption', spot_markup_ore_per_kwh: 4, monthly_fee_sek: 49, invoice_fee_sek: 19,
      green_fee_mode: 'none', vat_rate: 25, valid_from: futureNativeSupplyDate() },
    p_pricing_snapshot: { ...pricing, price_areas: ['SE3'] },
    p_actor_user_id: actorUserId,
  })
  if (error) throw new Error(error.message)
  const b = data as Record<string, unknown>
  const inserted = await supabaseService.from('customer_contracts').insert({
    id, company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId,
    status: 'pending_signature', source_type: 'manual_override', contract_name: b.offer_reference,
    contract_type: 'variable_hourly', energy_direction: 'consumption', spot_markup_ore_per_kwh: 4, monthly_fee_sek: 49,
    invoice_fee_sek: 19, green_fee_mode: 'none', starts_at: futureNativeSupplyDate(), price_snapshot: { ...pricing, price_areas: ['SE3'] },
    contract_offer_id: b.contract_offer_id, contract_product_id: b.contract_product_id,
    contract_product_version_id: b.contract_product_version_id, contract_publication_version_id: b.contract_publication_version_id,
    price_plan_id: b.price_plan_id, price_plan_version_id: b.price_plan_version_id, price_book_id: b.price_book_id,
    legal_bundle_version_id: b.legal_bundle_version_id, offer_reference: b.offer_reference,
    commercial_snapshot: b.commercial_snapshot, legal_snapshot: b.legal_snapshot, created_by: actorUserId, updated_by: actorUserId,
  })
  if (inserted.error) throw new Error(inserted.error.message)
  return { id }
}

// An intake draft: no binding yet, only the contract's resolved price_area_used.
async function draft(snapshot: Record<string, unknown> = pricing) {
  const id = randomUUID()
  const { error } = await supabaseService.from('customer_contracts').insert({
    id, company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId,
    status: 'draft', source_type: 'manual_override', contract_name: `Kundspecifikt ${id}`, contract_type: 'variable_hourly',
    energy_direction: 'consumption', spot_markup_ore_per_kwh: 4, monthly_fee_sek: 49, invoice_fee_sek: 19, green_fee_mode: 'none',
    starts_at: futureNativeSupplyDate(), price_area_used: 'SE3', price_snapshot: snapshot,
    created_by: f.actorUserId, updated_by: f.actorUserId,
  })
  if (error) throw new Error(error.message)
  if (snapshot === pricing) expect(sql<boolean>(`SELECT to_jsonb(NOT (price_snapshot ? 'price_areas')) FROM public.customer_contracts WHERE id=${literal(id)}`)).toBe(true)
  return { id }
}

function expectBoundOneOff(contractId: string, status: string) {
  // Supply still starts in the future; only the one-off offer is sellable today.
  expect(sql<boolean>(`SELECT to_jsonb(c.starts_at::date > current_date AND o.valid_from <= current_date)
    FROM public.customer_contracts c JOIN public.contract_offers o ON o.id=c.contract_offer_id
    WHERE c.id=${literal(contractId)}`)).toBe(true)
  const c = chain(contractId)
  expect(c).toMatchObject({ status, offer_active: false, offer_lifecycle: 'published', publication_status: 'published',
    publication_locked: true, legal_locked: true, reserved_for: contractId })
  expect(c.contract_publication_version_id).toMatch(/^[0-9a-f-]{36}$/)
  return c
}

it('customer-card create: a non-draft one-off contract publishes, locks, archives and binds its own offer', async () => {
  const contract = await cardCreate()
  expectBoundOneOff(contract.id, 'pending_signature')
})

it('signature preparation: a draft one-off contract is bound and moved to pending_signature by the real RPC', async () => {
  const contract = await draft()
  expect(chain(contract.id)).toMatchObject({ status: 'draft', contract_offer_id: null })
  const { data, error } = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', {
    p_company_id: f.companyId, p_customer_id: f.customerId, p_contract_id: contract.id,
    p_token_hash: 'a'.repeat(64), p_recipient_email: `synthetic-${randomUUID()}@example.invalid`,
    p_expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(), p_actor_user_id: f.actorUserId, p_channel: 'internal',
  })
  expect(error, JSON.stringify(error)).toBeNull()
  expect(data, JSON.stringify(data)).toMatchObject({ ok: true })
  expectBoundOneOff(contract.id, 'pending_signature')
})

it('refuses a second contract on a consumed one-off offer with no effect', async () => {
  const first = await cardCreate()
  const { contract_offer_id: offerId } = expectBoundOneOff(first.id, 'pending_signature')
  const before = sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_contracts WHERE contract_offer_id=${literal(offerId)}`)
  const { error } = await supabaseService.from('customer_contracts').insert({
    company_id: f.companyId, customer_id: f.customerId, status: 'pending_signature', contract_offer_id: offerId,
    contract_name: 'Reuse attempt', contract_type: 'variable_hourly', source_type: 'manual_override',
  })
  expect(error?.message).toContain('contract_offer_not_available')
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_contracts WHERE contract_offer_id=${literal(offerId)}`)).toBe(before)
})

it('an actor without contract permissions creates no offer, publication or reservation', async () => {
  const outsider = randomUUID()
  const offers = () => sql<number>(`SELECT to_jsonb(count(*)) FROM public.contract_offers WHERE company_id=${literal(f.companyId)}`)
  const reservations = () => sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_one_off_offer_binding.reservations WHERE company_id=${literal(f.companyId)}`)
  const [beforeOffers, beforeReservations] = [offers(), reservations()]
  await expect(cardCreate(outsider)).rejects.toMatchObject({ message: expect.stringContaining('contract_permission_denied') })
  expect([offers(), reservations()]).toEqual([beforeOffers, beforeReservations])
})

it('pins the consuming contract: its ID cannot be changed while it holds the one-off offer', async () => {
  const contract = await cardCreate()
  expectBoundOneOff(contract.id, 'pending_signature')
  const { error } = await supabaseService.from('customer_contracts').update({ id: randomUUID() })
    .eq('id', contract.id).eq('company_id', f.companyId)
  expect(error).not.toBeNull()
  expectBoundOneOff(contract.id, 'pending_signature')
})

// Same service-role route as the admin import (saveCustomerAuthorizationDocument),
// so the real permission gate sees a service_role JWT and the actual actor.
function importSignedAgreement(contractId: string) {
  return supabaseService.from('customer_authorization_documents').insert({
    company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId,
    customer_contract_id: contractId, document_type: 'complete_agreement', status: 'active', title: 'Synthetic signed one-off',
    mime_type: 'application/pdf', storage_bucket: 'customer-documents', file_path: `${f.companyId}/${contractId}/signed.pdf`,
    file_checksum: 'b'.repeat(64), uploaded_at: new Date().toISOString(), created_by: f.actorUserId,
    metadata: { source: 'customer_intake', documentRole: 'signed_agreement', channel: 'admin_contract_create' },
  })
}

function effectCounts(contractId: string) {
  return sql<number[]>(`SELECT jsonb_build_array(
    (SELECT count(*) FROM public.contract_offers WHERE company_id=${literal(f.companyId)}),
    (SELECT count(*) FROM gridex_one_off_offer_binding.reservations WHERE company_id=${literal(f.companyId)}),
    (SELECT count(*) FROM public.contract_publication_versions v JOIN public.contract_publications p ON p.id=v.contract_publication_id
       JOIN public.tenant_contract_assignments a ON a.id=p.assignment_id WHERE a.company_id=${literal(f.companyId)}),
    (SELECT count(*) FROM public.customer_authorization_documents WHERE customer_contract_id=${literal(contractId)}))`)
}

it('signed-PDF import: a draft one-off contract is bound and finalized by the real import trigger', async () => {
  const contract = await draft()
  const { error } = await importSignedAgreement(contract.id)
  expect(error, JSON.stringify(error)).toBeNull()
  expectBoundOneOff(contract.id, 'signed')
})

it('signed-PDF import refuses an explicit price_areas list without the contract area, with no effect', async () => {
  const contract = await draft({ ...pricing, price_areas: ['SE4'] })
  const before = effectCounts(contract.id)
  const { error } = await importSignedAgreement(contract.id)
  expect(error).toMatchObject({ code: '23514', message: 'one_off_price_area_not_in_price_areas' })
  expect(effectCounts(contract.id)).toEqual(before)
  expect(chain(contract.id)).toMatchObject({ status: 'draft', contract_offer_id: null })
})

it('signature preparation refuses an explicit price_areas list without the contract area, with no effect', async () => {
  const contract = await draft({ ...pricing, price_areas: ['SE4'] })
  const before = effectCounts(contract.id)
  const { error } = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', {
    p_company_id: f.companyId, p_customer_id: f.customerId, p_contract_id: contract.id,
    p_token_hash: 'c'.repeat(64), p_recipient_email: `synthetic-${randomUUID()}@example.invalid`,
    p_expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(), p_actor_user_id: f.actorUserId, p_channel: 'internal',
  })
  expect(error).toMatchObject({ code: '23514', message: 'one_off_price_area_not_in_price_areas' })
  expect(effectCounts(contract.id)).toEqual(before)
  expect(chain(contract.id)).toMatchObject({ status: 'draft', contract_offer_id: null })
})
