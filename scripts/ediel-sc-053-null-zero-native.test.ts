// masterplan: SC-053
// SC-053 / U-09 on the real local Supabase stack: a received UTILTS E66 energy
// source whose first quarter is missing (QTY+136:NULL, STS+8+46) and whose
// second quarter is a verified zero (QTY+136:0, STS+8+21) passes the actual
// canonical decision, qualification, contract preparation, service RPC
// persistence, positive APERAK creation/finalization and the authorized
// beneficiary projection RPC (ediel_beneficiary_series_page_v1). Only SMTP is a
// port (shared ESCO fixture). No storage, grant or ACK row is seeded directly.
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { projectEdielSeriesToBeneficiary } from '@/lib/ediel/services/projection'
import { readCanonicalPeriodicReasonAuthority, readCanonicalUtiltsIssuerIdentityAuthority } from '@/lib/ediel/core/runtimeDecision'
import { initialCanonicalUtiltsDecision, recordFinalCanonicalUtiltsDecision } from '@/lib/ediel/flows/utiltsCanonicalValidation'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { qualifyReceivedUtiltsStructure } from '@/lib/ediel/utilts/qualifyReceivedStructure'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, finalizeUtiltsTransactionAck, persistUtiltsTransactionResults } from '@/lib/ediel/utilts/transactionPersistence'
import { buildAperakDraft } from '@/lib/ediel/ack'
import { createCanonicalAckMessage } from '@/lib/ediel/core/kernel'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround } from './helpers/utiltsConsumptionParties'
import { utiltsErrGatewayFixture } from '../__tests__/helpers/utiltsErrGatewayFixture'
import { utiltsNativeSourceFixture, utiltsRecountUnt } from '../__tests__/helpers/utiltsNativeSourceFixture'
import {
  nativeEscoLiteral as lit, nativeEscoSql as sql,
  resetNativeEscoFixture, seedNativeEscoFixture, qualifyNativeEscoFixture,
} from './fixtures/ediel-service-evidence-native'

type Fixture = Awaited<ReturnType<typeof seedNativeEscoFixture>>
type Quantity = { qualifier: string | null; value: string | null; quality?: string | null; readingAt?: string }
beforeEach(resetNativeEscoFixture)

// Two quarters of one E66 transaction: the first missing, the second zero.
const NULL_ZERO = ["SEQ++1'", "QTY+136:NULL'", "DTM+597:202607010000:203'", "STS+8+46'",
  "SEQ++2'", "QTY+136:0'", "DTM+597:202607010015:203'", "STS+8+21'"]

async function nullZeroSource(f: Fixture, reference: string, extra: string[] = []) {
  registerUtiltsIssuer(sql, lit, f.receiver, f.ids.actor)
  const physical = utiltsErrGatewayFixture({ company: f.ids.company, receiver: f.sender, transactions: [{ reference, outcome: 'accepted' }] })
  const lines = physical.raw_payload!.replaceAll('91100', f.receiver).replaceAll('23-DDQ-E66-T', '23-DGI-E66-T').replace("NAD+DDQ'", "NAD+DGI'")
    .replace("STS+7++E88::260'", "STS+7++E23::260'").replaceAll('GRIDEX2607E66MSG001', `D${randomUUID().replaceAll('-', '').slice(0, 16)}`)
    .replace('202607010000202607010015:719', '202607010000202607010030:719').split('\n')
  const seq = lines.findIndex(line => line.startsWith('SEQ+')), unt = lines.findIndex(line => line.startsWith('UNT+'))
  expect(lines.slice(seq, unt)).toEqual(["SEQ++1'", "QTY+136:500'", "DTM+597:202607010000:203'", "STS+7++21::260'"])
  const raw = utiltsRecountUnt([...lines.slice(0, seq), ...NULL_ZERO, ...extra, ...lines.slice(unt)].join('\n'))
  const fresh = utiltsNativeSourceFixture(raw, randomUUID()), source = await f.insert(fresh.raw, 'UTILTS', 'E66')
  seedUtiltsIssuerHistoryGround(sql, lit, source.id, f.ids.actor)
  const initial = await initialCanonicalUtiltsDecision(source)
  const issuerIdentityAuthority = readCanonicalUtiltsIssuerIdentityAuthority({ decision: initial, message: source }) ?? undefined
  const periodicReasonAuthority = readCanonicalPeriodicReasonAuthority({ decision: initial, message: source }) ?? undefined
  const qualified = await qualifyReceivedUtiltsStructure({ message: source, canonicalPolicy: initial.policy, issuerIdentityAuthority, periodicReasonAuthority,
    runtime: runUtiltsRuntimeForMessage(source, { canonicalPolicy: initial.policy, issuerIdentityAuthority, periodicReasonAuthority }) })
  expect(qualified.runtime.transactionDispositions.map(x => [x.disposition, x.responseType]), JSON.stringify(qualified.runtime.validation.issues)).toEqual([['accepted', 'positive_aperak']])
  await recordFinalCanonicalUtiltsDecision({ original: source, validated: source, initialDecision: initial, runtime: qualified.runtime })
  const matches = qualified.runtime.facts.transactions.map(t => ({ transactionReference: t.transactionId, meteringPointId: f.ids.point, customerId: f.ids.customer, siteId: f.ids.site,
    gridOwnerId: f.ids.grid, externalMeteringPointId: f.point, externalGridAreaId: 'TES', matchStatus: 'matched' as const }))
  const contracts = await prepareUtiltsConsumptionContracts({ message: source, runtime: qualified.runtime, policy: initial.policy, matches, dataRequest: null,
    fallback: { customerId: f.ids.customer, siteId: f.ids.site, meteringPointId: f.ids.point, gridOwnerId: f.ids.grid }, allowConsumption: true })
  const input = { actorUserId: f.ids.actor, companyId: f.ids.company, environment: source.environment, sourceMessageId: source.id, messageCode: 'E66', rawPayload: source.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: 'E66', transactions: qualified.runtime.facts.transactions, rawSegments: qualified.runtime.facts.rawSegments, dispositions: qualified.runtime.transactionDispositions, matches }) }
  return {
    source, input,
    persist: (override = input) => persistUtiltsTransactionResults(override),
    ack: () => createCanonicalAckMessage({ actorUserId: f.ids.actor, sourceMessage: source, ackFamily: 'APERAK', outcome: 'positive',
      draft: buildAperakDraft({ actorUserId: f.ids.actor, sourceMessage: source, outcome: 'positive', relatedTransactionReference: reference, ackScope: 'transaction' }) }),
    finalize: (ackId: string) => finalizeUtiltsTransactionAck({ companyId: f.ids.company, environment: 'test', sourceMessageId: source.id, transactionId: reference, responseType: 'positive_aperak', responseMessageId: ackId }),
  }
}

function reader(company: string) {
  const actor = randomUUID()
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${lit(actor)},'authenticated','authenticated',${lit(actor + '@example.invalid')},now(),'{}','{}',now(),now(),false,false);
   INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(actor)},${lit(actor + '@example.invalid')},'Synthetic SC053 reader','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${lit(company)},${lit(actor)},'operations','active',now(),'{}','member',true,now(),'operations');
   INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(actor)},${lit(company)},id,key FROM public.permissions WHERE key='metering.read'`)
  return actor
}

const stored = (f: Fixture, sourceId: string) => sql<{ quantity: string | null; quality: string; qualifier: string; reading_at: string | null; unit: string }[] | null>(
  `SELECT jsonb_agg(jsonb_build_object('quantity',v.quantity::text,'quality',v.quality,'qualifier',v.qualifier,'reading_at',v.reading_at,'unit',v.unit) ORDER BY v.reading_at NULLS LAST,v.id)
   FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id AND s.company_id=v.company_id
   WHERE s.company_id=${lit(f.ids.company)} AND s.source_ediel_message_id=${lit(sourceId)}`) ?? null
const ackRows = (f: Fixture, sourceId: string) => sql<Record<string, unknown>[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome) ORDER BY id),'[]') FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND direction='outbound' AND related_message_id=${lit(sourceId)}`)
const disposition = (f: Fixture, sourceId: string) => sql<Record<string, unknown> | null>(`SELECT to_jsonb(d) FROM public.ediel_ack_transaction_results d WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(sourceId)}`) ?? null

it('SC-053 missing NULL/46 and verified 0/21 are stored apart, read as missing by the authorized projection, and ACKed only after durable persistence', async () => {
  const f = await seedNativeEscoFixture(), authority = await qualifyNativeEscoFixture(f)
  const reference = 'SC053-' + randomUUID().slice(0, 8), incoming = await nullZeroSource(f, reference)
  // Only the verified zero is consumable energy; the missing quarter is not zero-filled.
  expect(incoming.input.contracts[0].observations.map(o => [o.sourceOrdinal, String(o.quantity)])).toEqual([[1, '0']])

  // Prohibited: a positive APERAK before durable persistence.
  const before = f.effects()
  await expect(incoming.ack()).rejects.toBeDefined()
  expect(ackRows(f, incoming.source.id)).toEqual([])
  expect(disposition(f, incoming.source.id)).toBeNull()
  expect(f.effects()).toEqual(before)

  const rpc = vi.spyOn(supabaseService, 'rpc')
  const [result] = await incoming.persist()
  expect(result).toMatchObject({ persistenceStatus: 'persisted' })
  // The actual service RPC payload carries each quantity's own source STS+8 quality.
  const sent = rpc.mock.calls.find(([name]) => name === 'gridex_persist_utilts_consumption_v1')![1] as { p_transactions: { quantities: Quantity[] }[] }
  rpc.mockRestore()
  expect(sent.p_transactions[0].quantities.map(q => [q.qualifier, q.value, q.quality])).toEqual([['136', null, '46'], ['136', '0', '21']])
  // Expected: separate value and quality representations, no zero-filling.
  expect(stored(f, incoming.source.id)).toEqual([
    { quantity: null, quality: '46', qualifier: '136', reading_at: '2026-06-30T22:00:00+00:00', unit: 'KWH' },
    { quantity: '0', quality: '21', qualifier: '136', reading_at: '2026-06-30T22:15:00+00:00', unit: 'KWH' },
  ])
  expect(sql(`SELECT count(*) FROM public.meter_reading_values WHERE company_id=${lit(f.ids.company)} AND series_id=${lit(result.seriesId)} AND quantity IS NOT DISTINCT FROM 0`)).toBe(1)
  expect(disposition(f, incoming.source.id)).toMatchObject({ disposition: 'accepted', persistence_status: 'persisted', persisted_series_id: result.seriesId, response_message_id: null })

  const ack = await incoming.ack()
  await incoming.finalize(ack.id)
  // Correlation: the APERAK relates to this source and its transaction reference.
  expect(ack).toMatchObject({ related_message_id: incoming.source.id, message_family: 'APERAK', ack_outcome: 'positive', direction: 'outbound' })
  const documentNumber = /BGM\+[^+']*\+([^+']+)/.exec(incoming.source.raw_payload!)![1]
  expect(ack.raw_payload).toContain(`DOC+E66:SVK:260+${documentNumber}'`)
  expect(ack.raw_payload).toContain(`RFF+ACW:${reference}'`)
  expect(ack.raw_payload).toContain("ERC+100::260'")
  expect(disposition(f, incoming.source.id)).toMatchObject({ persistence_status: 'persisted', final_response_type: 'positive_aperak', response_message_id: ack.id, persisted_series_id: result.seriesId })
  expect(ackRows(f, incoming.source.id)).toEqual([{ id: ack.id, family: 'APERAK', outcome: 'positive' }])

  // Authorized read through the real beneficiary projection RPC.
  const series = sql<{ start: string; end: string }>(`SELECT jsonb_build_object('start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND id=${lit(result.seriesId)}`)
  const request = { beneficiaryCompanyId: f.ids.beneficiary, actorUserId: reader(f.ids.beneficiary), grantId: authority.grantId,
    expectedGrantVersion: sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`),
    purpose: f.fields.purpose, seriesId: result.seriesId!, fields: ['reading_at', 'quantity', 'quality', 'qualifier'] as const,
    startInclusive: series.start, endExclusive: series.end, limit: 100 }
  const page = await projectEdielSeriesToBeneficiary(request)
  expect(page.rows.map(r => [r.quantity, r.quality, r.qualifier])).toEqual([[null, '46', '136'], ['0', '21', '136']])
  expect(page.provenance).toMatchObject({ sourceMessageId: incoming.source.id, qualityOrigin: { column: 'meter_reading_values.quality', seriesId: result.seriesId } })

  // Contrast: another tenant (no grant, own membership) cannot read the series.
  const other = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(other)},'Synthetic SC053 other tenant','active')`)
  await expect(projectEdielSeriesToBeneficiary({ ...request, beneficiaryCompanyId: other, actorUserId: reader(other) })).rejects.toBeDefined()
  // Nor can the provider tenant's own operator use the beneficiary's grant.
  await expect(projectEdielSeriesToBeneficiary({ ...request, beneficiaryCompanyId: f.ids.company, actorUserId: f.ids.actor })).rejects.toBeDefined()
  // Nor can an actor of another tenant name the beneficiary company.
  await expect(projectEdielSeriesToBeneficiary({ ...request, actorUserId: reader(other) })).rejects.toBeDefined()

  // Replay is idempotent: same series, same ACK, no new rows.
  const stable = f.effects(), values = stored(f, incoming.source.id)
  const [again] = await incoming.persist()
  expect(again).toMatchObject({ seriesId: result.seriesId, idempotentReplay: true })
  expect((await incoming.ack()).id).toBe(ack.id)
  await incoming.finalize(ack.id)
  expect(f.effects()).toEqual(stable)
  expect(stored(f, incoming.source.id)).toEqual(values)
  expect((await projectEdielSeriesToBeneficiary(request)).rows).toEqual(page.rows)
})

// A service caller bypassing the TypeScript adapter (which re-derives quality
// from the wire) sends the RPC payload itself. PostgreSQL must refuse it.
it.each([
  ['swapped qualities', (q: Quantity[]) => { q[0].quality = '21'; q[1].quality = '46' }],
  ['missing quarter relabelled verified', (q: Quantity[]) => { q[0].quality = '21' }],
  ['verified zero relabelled missing', (q: Quantity[]) => { q[1].quality = '46' }],
  ['missing quarter zero-filled', (q: Quantity[]) => { q[0].value = '0' }],
  ['quality key dropped', (q: Quantity[]) => { delete q[0].quality }],
  ['energy relabelled as meter reading', (q: Quantity[]) => { q[1].qualifier = '220' }],
  ['energy relabelled as power', (q: Quantity[]) => { q[1].qualifier = '42' }],
] as const)('SC-053 forged quality payload (%s) is rejected by the native RPC with no rows or ACK', async (_label, forge) => {
  const f = await seedNativeEscoFixture(); await qualifyNativeEscoFixture(f)
  const incoming = await nullZeroSource(f, 'SC053F-' + randomUUID().slice(0, 8))
  // Capture the adapter's genuine RPC arguments without executing them.
  const rpc = vi.spyOn(supabaseService, 'rpc').mockImplementationOnce((() => Promise.resolve({ data: null, error: { message: 'captured' } })) as never)
  await expect(incoming.persist()).rejects.toThrow('captured')
  const genuine = structuredClone(rpc.mock.calls[0][1]) as { p_transactions: { quantities: Quantity[] }[] } & Record<string, unknown>
  rpc.mockRestore()
  expect(genuine.p_transactions[0].quantities.map(q => [q.value, q.quality])).toEqual([[null, '46'], ['0', '21']])
  const before = f.effects(), forged = structuredClone(genuine)
  forge(forged.p_transactions[0].quantities)
  const { data, error } = await (supabaseService.rpc as unknown as (n: string, a: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }>)('gridex_persist_utilts_consumption_v1', forged)
  expect(data).toBeNull()
  expect(error?.message).toBeTruthy()
  expect(stored(f, incoming.source.id)).toBeNull()
  expect(disposition(f, incoming.source.id)).toBeNull()
  expect(ackRows(f, incoming.source.id)).toEqual([])
  expect(f.effects()).toEqual(before)
  await expect(incoming.ack()).rejects.toBeDefined()
  // The genuine payload is still accepted afterwards: nothing was poisoned.
  expect((await incoming.persist())[0]).toMatchObject({ persistenceStatus: 'persisted' })
  expect(stored(f, incoming.source.id)!.map(v => [v.quantity, v.quality])).toEqual([[null, '46'], ['0', '21']])
})

// Prohibited mixing: a QTY+42 power value beside the NULL/0 energy quarters is
// kept under its own qualifier with its own quality, is never consumed as
// energy, has no invented interval and is not returned by the energy read.
// (A dated QTY+220 meter reading needs an authoritative register readset and
// is held as internal_review before persistence natively; it is covered by
// the PGlite regression in __tests__/ediel-sc-053-null-vs-zero-storage.test.ts.)
it('SC-053 a power QTY+42 beside NULL/0 energy is stored apart and never mixed into energy or the authorized read', async () => {
  const f = await seedNativeEscoFixture(), authority = await qualifyNativeEscoFixture(f)
  const reference = 'SC053P-' + randomUUID().slice(0, 8)
  const incoming = await nullZeroSource(f, reference, ["SEQ++3'", "QTY+42:7.5'", "STS+8+56'"])
  expect(incoming.input.transactions[0].quantities.map(q => [q.qualifier, q.value])).toEqual([['136', null], ['136', 0], ['42', 7.5]])
  // Only the verified zero energy quarter is consumable; power is not energy.
  expect(incoming.input.contracts[0].observations.map(o => [o.sourceOrdinal, String(o.quantity), o.unit])).toEqual([[1, '0', 'kWh']])
  const [result] = await incoming.persist()
  expect(result).toMatchObject({ persistenceStatus: 'persisted', responseType: 'positive_aperak' })
  expect(stored(f, incoming.source.id)).toEqual([
    { quantity: null, quality: '46', qualifier: '136', reading_at: '2026-06-30T22:00:00+00:00', unit: 'KWH' },
    { quantity: '0', quality: '21', qualifier: '136', reading_at: '2026-06-30T22:15:00+00:00', unit: 'KWH' },
    { quantity: '7.5', quality: '56', qualifier: '42', reading_at: null, unit: 'KWH' },
  ])
  expect(sql(`SELECT jsonb_build_object('n',count(*),'sum',sum(quantity)::text) FROM public.meter_reading_values WHERE company_id=${lit(f.ids.company)} AND series_id=${lit(result.seriesId)} AND qualifier='136'`)).toEqual({ n: 2, sum: '0' })
  const ack = await incoming.ack(); await incoming.finalize(ack.id)
  expect(disposition(f, incoming.source.id)).toMatchObject({ final_response_type: 'positive_aperak', response_message_id: ack.id, persisted_series_id: result.seriesId })
  const series = sql<{ start: string; end: string }>(`SELECT jsonb_build_object('start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND id=${lit(result.seriesId)}`)
  const page = await projectEdielSeriesToBeneficiary({ beneficiaryCompanyId: f.ids.beneficiary, actorUserId: reader(f.ids.beneficiary), grantId: authority.grantId,
    expectedGrantVersion: sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`),
    purpose: f.fields.purpose, seriesId: result.seriesId!, fields: ['quantity', 'quality', 'qualifier'], startInclusive: series.start, endExclusive: series.end, limit: 100 })
  expect(page.rows).toEqual([{ quantity: null, quality: '46', qualifier: '136' }, { quantity: '0', quality: '21', qualifier: '136' }])
})
