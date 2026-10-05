// masterplan: ESCO-10, AT-ESCO-10, ESCO-11, AT-ESCO-11, SC-017, SC-007
import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, expect, it } from 'vitest'
import { projectEdielSeriesToBeneficiary } from '@/lib/ediel/services/projection'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import {
  nativeEscoLiteral as lit, nativeEscoSql as sql, resetNativeEscoFixture,
  seedNativeEscoFixture, qualifyNativeEscoFixture,
} from './fixtures/ediel-service-evidence-native'

// Real archive/review, Z14, canonical validation, persistence and projection
// owners. External issuer facts are disposable synthetic inputs; SMTP is
// replaced by the fixture. This test grants no external market/legal approval.
beforeEach(resetNativeEscoFixture)

async function receivedProjection() {
  const f = await seedNativeEscoFixture(), authority = await qualifyNativeEscoFixture(f)
  const incoming = await f.utilts('accepted', 'ESCO-PROJECTION-' + randomUUID().slice(0,8))
  expect(incoming.source.raw_payload).not.toContain(authority.permissionId)
  expect(incoming.source.raw_payload).not.toContain('SYNTHETIC-PERMISSION-')
  await incoming.persist()
  const series = sql<{id:string;start:string;end:string}>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}`)
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
  const request = { beneficiaryCompanyId:f.ids.beneficiary, actorUserId:f.ids.actor,
    grantId:authority.grantId, expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`),
    purpose:f.fields.purpose, seriesId:series.id, fields:['quantity','quality'] as const,
    startInclusive:series.start, endExclusive:series.end }
  const state = () => ({ effects:f.effects(), originals:sql(`SELECT jsonb_build_object('source',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(incoming.source.id)}),'series',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.meter_reading_series s WHERE source_ediel_message_id=${lit(incoming.source.id)}),'values',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_ediel_message_id=${lit(incoming.source.id)}),'binding',(SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(incoming.source.id)}),'acks',(SELECT jsonb_agg(to_jsonb(a) ORDER BY source_transaction_id) FROM public.ediel_ack_transaction_results a WHERE source_message_id=${lit(incoming.source.id)}),'projections',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM gridex_ediel_services.projection_receipts r WHERE company_id=${lit(f.ids.company)}))`) })
  return { f, authority, incoming, request, state, read:()=>projectEdielSeriesToBeneficiary(request) }
}

it('ESCO-10 stores an exact reception receipt without a permission field and distributes only through the current grant', async () => {
  const p = await receivedProjection(), {f,incoming} = p
  const receipt = sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=${lit(incoming.source.id)}`)
  expect(receipt).toMatchObject({source_message_id:incoming.source.id,company_id:f.ids.company,environment:'test',message_code:'E66',
    raw_hash:createHash('sha256').update(incoming.source.raw_payload!,'utf8').digest('hex'),contract_version:2,
    membership:incoming.input.transactions.map(t=>t.transactionId)})
  expect(receipt.bound_at).toBeTruthy()
  expect(sql(`SELECT jsonb_agg(jsonb_build_object('transaction',c.transaction_id,'receipt',c.source_message_id,'version',c.contract_version,'disposition',a.disposition,'persistence',a.persistence_status)) FROM gridex_utilts_binding.contracts c JOIN public.ediel_ack_transaction_results a ON a.persisted_series_id=c.series_id AND a.source_message_id=c.source_message_id WHERE c.source_message_id=${lit(incoming.source.id)}`)).toEqual(incoming.input.transactions.map(t=>({transaction:t.transactionId,receipt:incoming.source.id,version:2,disposition:'accepted',persistence:'persisted'})))
  const page = await p.read(), physical = EdifactEnvelopeCodec.decode(incoming.source.raw_payload!)
  expect(page.provenance).toMatchObject({sourceRole:'DGI',sourceSenderEdielId:f.receiver,sourceApplicationReference:physical.applicationReference,purpose:p.request.purpose})
  expect(page.rows).toEqual(sql(`SELECT jsonb_agg(jsonb_build_object('quantity',quantity::text,'quality',quality) ORDER BY reading_at,id) FROM public.meter_reading_values WHERE series_id=${lit(p.request.seriesId)} AND reading_at>=${lit(p.request.startInclusive)}::timestamptz AND reading_at<${lit(p.request.endExclusive)}::timestamptz`))
  expect(page.provenance.qualityOrigin).toEqual({sourceMessageId:incoming.source.id,seriesId:p.request.seriesId,column:'meter_reading_values.quality'})
  const stranger = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(stranger)},'Synthetic no-grant same-object and SMTP tenant','active');INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,role_key) VALUES(${lit(stranger)},${lit(f.ids.actor)},'operations','active',now(),'member',true,'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(f.ids.actor)},${lit(stranger)},id,key FROM public.permissions WHERE key='metering.read';INSERT INTO public.metering_points(company_id,ediel_metering_point_id) VALUES(${lit(stranger)},${lit(f.point)});INSERT INTO public.communication_routes(company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${lit(stranger)},'Shared synthetic SMTP address','ediel_ack','bilateral_test',true,'dso-native@example.invalid')`)
  const stable = p.state()
  await expect(projectEdielSeriesToBeneficiary({...p.request,beneficiaryCompanyId:stranger})).rejects.toBeDefined()
  await expect(projectEdielSeriesToBeneficiary({...p.request,purpose:'ungranted billing'})).rejects.toMatchObject({message:expect.stringContaining('projection_outside_grant')})
  expect(p.state()).toEqual(stable)
  expect(await p.read()).toEqual(page)
  expect(p.state()).toEqual(stable)
})

it.each(['downstream_use','privacy_roles'] as const)('ESCO-11 rechecks authentic current %s basis while preserving original DGI and prior receipts', async kind => {
  const p = await receivedProjection(), page = await p.read(), stable = p.state()
  const index = kind === 'downstream_use' ? 3 : 4
  sql(`INSERT INTO gridex_ediel_services.issuer_revocations(target_kind,target_id,source_reference,source_hash,revoked_at) VALUES('representation',${lit(p.authority.representationIds[index])},'Synthetic scoped revocation',${lit(p.authority.hash)},now())`)
  expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(p.f.ids.company)},${lit(p.f.assignment)})`)).toMatchObject({status:'held'})
  await expect(p.read()).rejects.toMatchObject({message:expect.stringContaining('assignment_not_authorized')})
  expect(p.state()).toEqual(stable)
  expect(page.provenance).toMatchObject({sourceRole:'DGI',sourceSenderEdielId:p.f.receiver,purpose:p.request.purpose})
})
