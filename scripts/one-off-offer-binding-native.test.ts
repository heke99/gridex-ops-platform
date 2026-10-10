import { randomUUID } from 'node:crypto'
import { beforeAll, expect, it, vi } from 'vitest'

// Real disposable replay, real save/publish/legal/publication functions and
// every customer_contracts trigger. The existing fixture provisions a tenant
// whose catalog offer publishes through the same gated command; nothing here
// seeds a published, locked or reserved row.
vi.mock('server-only', () => ({}))
import { createCustomerContract } from '@/lib/customer-contracts/db'
import { supabaseService } from '@/lib/supabase/service'
import { futureNativeSupplyDate, literal, nativeSql as sql, seedNormalSwitchNativeFixture, type NormalSwitchStageNativeFixture } from './helpers/ediel-normal-switch-native-fixture'

type Fixture = NormalSwitchStageNativeFixture
type Chain = { status: string; contract_offer_id: string | null; contract_publication_version_id: string | null;
  offer_active: boolean | null; offer_lifecycle: string | null; publication_status: string | null; publication_locked: boolean | null;
  legal_locked: boolean | null; reserved_for: string | null }

let f: Fixture

beforeAll(async () => {
  f = await seedNormalSwitchNativeFixture({ requestedStartDate: futureNativeSupplyDate(), deferOriginal: true })
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

function manualContract(status: 'draft' | 'pending_signature', actorUserId = f.actorUserId) {
  return createCustomerContract({
    companyId: f.companyId, customerId: f.customerId, siteId: f.siteId, meteringPointId: f.pointId,
    sourceType: 'manual_override', status, contractName: `Kundspecifikt ${randomUUID()}`,
    contractType: 'variable_hourly', energyDirection: 'consumption', spotMarkupOrePerKwh: 4, monthlyFeeSek: 49,
    invoiceFeeSek: 19, priceSnapshot: { interval_resolution: 'hourly' },
    // Future supply start: signing must still be possible today.
    greenFeeMode: 'none', startsAt: futureNativeSupplyDate(), actorUserId,
  })
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
  const contract = await manualContract('pending_signature')
  expectBoundOneOff(contract.id, 'pending_signature')
})

it('signature preparation: a draft one-off contract is bound and moved to pending_signature by the real RPC', async () => {
  const contract = await manualContract('draft')
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
  const first = await manualContract('pending_signature')
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
  await expect(manualContract('pending_signature', outsider)).rejects.toMatchObject({ message: expect.stringContaining('contract_permission_denied') })
  expect([offers(), reservations()]).toEqual([beforeOffers, beforeReservations])
})

it('pins the consuming contract: its ID cannot be changed while it holds the one-off offer', async () => {
  const contract = await manualContract('pending_signature')
  expectBoundOneOff(contract.id, 'pending_signature')
  const { error } = await supabaseService.from('customer_contracts').update({ id: randomUUID() })
    .eq('id', contract.id).eq('company_id', f.companyId)
  expect(error).not.toBeNull()
  expectBoundOneOff(contract.id, 'pending_signature')
})

it('signed-PDF import: a draft one-off contract is bound and finalized by the real import trigger', async () => {
  const contract = await manualContract('draft')
  const checksum = 'b'.repeat(64)
  sql(`INSERT INTO public.customer_authorization_documents(company_id,customer_id,site_id,metering_point_id,customer_contract_id,
    document_type,status,title,mime_type,storage_bucket,file_path,file_checksum,uploaded_at,created_by,metadata)
    VALUES(${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},${literal(contract.id)},
    'complete_agreement','active','Synthetic signed one-off','application/pdf','customer-documents',
    ${literal(`${f.companyId}/${contract.id}/signed.pdf`)},${literal(checksum)},now(),${literal(f.actorUserId)},
    '{"source":"customer_intake","documentRole":"signed_agreement","channel":"admin_contract_create"}'::jsonb);`)
  expectBoundOneOff(contract.id, 'signed')
})
