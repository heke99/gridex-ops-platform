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
  const b = data as Record<string, string>
  sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,status,source_type,contract_name,
    contract_type,energy_direction,spot_markup_ore_per_kwh,monthly_fee_sek,invoice_fee_sek,green_fee_mode,starts_at,price_snapshot,
    contract_offer_id,contract_product_id,contract_product_version_id,contract_publication_version_id,price_plan_id,
    price_plan_version_id,price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot,created_by,updated_by)
    VALUES(${literal(id)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},'pending_signature',
    'manual_override',${literal(b.offer_reference)},'variable_hourly','consumption',4,49,19,'none',${literal(futureNativeSupplyDate())},
    ${literal({ ...pricing, price_areas: ['SE3'] })},${literal(b.contract_offer_id)},${literal(b.contract_product_id)},
    ${literal(b.contract_product_version_id)},${literal(b.contract_publication_version_id)},${literal(b.price_plan_id)},
    ${literal(b.price_plan_version_id)},${literal(b.price_book_id)},${literal(b.legal_bundle_version_id)},${literal(b.offer_reference)},
    ${literal(b.commercial_snapshot)},${literal(b.legal_snapshot)},${literal(actorUserId)},${literal(actorUserId)});`)
  return { id }
}

// An intake draft: no binding yet, only the contract's resolved price_area_used.
function draft() {
  const id = randomUUID()
  sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,status,source_type,contract_name,
    contract_type,energy_direction,spot_markup_ore_per_kwh,monthly_fee_sek,invoice_fee_sek,green_fee_mode,starts_at,price_area_used,
    price_snapshot,created_by,updated_by)
    VALUES(${literal(id)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},'draft',
    'manual_override',${literal(`Kundspecifikt ${id}`)},'variable_hourly','consumption',4,49,19,'none',${literal(futureNativeSupplyDate())},
    'SE3',${literal(pricing)},${literal(f.actorUserId)},${literal(f.actorUserId)});`)
  expect(sql<boolean>(`SELECT to_jsonb(NOT (price_snapshot ? 'price_areas')) FROM public.customer_contracts WHERE id=${literal(id)}`)).toBe(true)
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
  const contract = draft()
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

it('signed-PDF import: a draft one-off contract is bound and finalized by the real import trigger', async () => {
  const contract = draft()
  const checksum = 'b'.repeat(64)
  sql(`INSERT INTO public.customer_authorization_documents(company_id,customer_id,site_id,metering_point_id,customer_contract_id,
    document_type,status,title,mime_type,storage_bucket,file_path,file_checksum,uploaded_at,created_by,metadata)
    VALUES(${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(contract.id)},
    'complete_agreement','active','Synthetic signed one-off','application/pdf','customer-documents',
    ${literal(`${f.companyId}/${contract.id}/signed.pdf`)},${literal(checksum)},now(),${literal(f.actorUserId)},
    '{"source":"customer_intake","documentRole":"signed_agreement","channel":"admin_contract_create"}'::jsonb);`)
  expectBoundOneOff(contract.id, 'signed')
})
