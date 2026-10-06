// masterplan: SC-003, SC-005, TEN-09, AT-TEN-09
import {createHash,randomUUID} from 'node:crypto'
import {beforeEach,expect,it} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {projectEdielSeriesToBeneficiary} from '@/lib/ediel/services/projection'
import {coordinateEdielServicePermission,resolveEdielServicePermissionCommand} from '@/lib/ediel/services/commands'
import {
 nativeEscoLiteral as lit,nativeEscoSql as sql,nativeEscoExternal as external,
 resetNativeEscoFixture,seedNativeEscoFixture,qualifyNativeEscoFixture,
} from './fixtures/ediel-service-evidence-native'

// One genuine local PostgreSQL/PostgREST case. The unchanged shared fixture
// runs real archive/review, commands, origin/rendering, permission transitions,
// UTILTS validation/persistence and ACK owners. Only SMTP is substituted;
// issuer keys, legal representations and tenant bootstrap are synthetic inputs,
// not external legal or market approval. No private approval/receipt is seeded.
beforeEach(resetNativeEscoFixture)
type Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>
type Authority=Awaited<ReturnType<typeof qualifyNativeEscoFixture>>

async function samePermissionMission(f:Fixture):Promise<Fixture>{
 const beneficiary=randomUUID(),key=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(beneficiary)},'Synthetic independent second mission','active')`)
 const fields={...f.fields,beneficiary_company_id:beneficiary,field_sets:['reading_at','quantity','unit']}
 const made=await f.command({action:'create_assignment',commandId:randomUUID(),fields})
 expect(made.status).toBe('held')
 const assignment=String(made.assignmentId),current=()=>sql<ReturnType<Fixture['current']>>(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,'scope',gridex_service_administration.scope_v1(a),'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex')) FROM public.ediel_service_assignments a WHERE company_id=${lit(f.ids.company)} AND id=${lit(assignment)}`)
 return {...f,ids:{...f.ids,beneficiary,key},fields,assignment,current}
}
function beneficiaryRead(f:Fixture,authority:Authority,sourceId:string){
 const actor=randomUUID()
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${lit(actor)},'authenticated','authenticated',${lit(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(actor)},${lit(actor+'@example.invalid')},'Synthetic beneficiary reader','active') ON CONFLICT(id) DO UPDATE SET user_status='active';INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${lit(f.ids.beneficiary)},${lit(actor)},'operations','active',now(),'{}','member',true,now(),'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(actor)},${lit(f.ids.beneficiary)},id,key FROM public.permissions WHERE key='metering.read'`)
 const series=sql<{id:string;start:string;end:string}>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(sourceId)}`)
 const request={beneficiaryCompanyId:f.ids.beneficiary,actorUserId:actor,grantId:authority.grantId,expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`),purpose:f.fields.purpose,seriesId:series.id,fields:['reading_at','quantity'] as const,startInclusive:series.start,endExclusive:series.end,limit:100}
 return {request,read:()=>projectEdielSeriesToBeneficiary(request)}
}

it('SC003/SC005 legal provider DGI uses one permission and one E66 storage/disposition/physical ACK for two independently valid scoped missions',async()=>{
 const f=await seedNativeEscoFixture(),first=await qualifyNativeEscoFixture(f)
 const second=await samePermissionMission(f),beforeReuse=f.effects(),other=await qualifyNativeEscoFixture(second,first)
 expect(other.permissionId).toBe(first.permissionId);expect(other.z13.id).toBe(first.z13.id);expect(other.z14.id).toBe(first.z14.id)
 expect(other.grantId).not.toBe(first.grantId);expect(second.assignment).not.toBe(f.assignment)
 expect(f.fields.object_ids).toEqual(second.fields.object_ids);expect(f.fields.data_start).toBe(second.fields.data_start);expect(f.fields.data_end).toBe(second.fields.data_end)
 expect(f.effects().messages).toBe(beforeReuse.messages);expect(external.send).toHaveBeenCalledTimes(1)
 expect(first.z13.company_id).toBe(f.ids.company)
 const wire=first.z13.raw_payload!,envelope=EdifactEnvelopeCodec.decode(wire)
 expect(envelope.applicationReference).toBe('23-DGI-PRODAT')
 const tokenized=tokenizeEdifact(wire),legalFrom=tokenized.segments.filter(s=>s.tag==='NAD'&&segmentComposite(s,1,tokenized.una)[0]==='FR')
 expect(legalFrom).toHaveLength(1);expect(segmentComposite(legalFrom[0],2,tokenized.una)).toEqual([f.sender,'160','SVK'])
 expect(first.z13.parsed_payload?.sourcePermissionBasis).toMatchObject({companyId:f.ids.company,assignmentId:f.assignment,providerActorId:f.ids.legal,legalSenderId:f.sender})
 for(const uuid of [f.ids.beneficiary,second.ids.beneficiary,f.assignment,second.assignment])expect(wire).not.toContain(uuid)
 expect(sql(`SELECT jsonb_agg(jsonb_build_object('assignment',a.id,'beneficiary',a.beneficiary_company_id,'provider',a.provider_actor_id,'permission',l.permission_id) ORDER BY a.id) FROM public.ediel_service_assignments a JOIN public.ediel_assignment_permission_links l ON l.company_id=a.company_id AND l.assignment_id=a.id WHERE a.company_id=${lit(f.ids.company)} AND a.id IN(${lit(f.assignment)},${lit(second.assignment)})`)).toEqual([
  {assignment:f.assignment,beneficiary:f.ids.beneficiary,provider:f.ids.legal,permission:first.permissionId},
  {assignment:second.assignment,beneficiary:second.ids.beneficiary,provider:f.ids.legal,permission:first.permissionId},
 ].sort((a,b)=>a.assignment.localeCompare(b.assignment)))

 const incoming=await f.utilts('accepted','SC005-ONE-SHARED-'+randomUUID().slice(0,8)),before=f.effects()
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND direction='inbound' AND message_family='UTILTS' AND message_code='E66'`)).toBe(1)
 const companies=[f.ids.company,f.ids.beneficiary,second.ids.beneficiary].map(lit).join(',')
 const invoices=()=>sql(`SELECT jsonb_build_object('invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]') FROM public.customer_invoices i WHERE company_id IN(${companies})),'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') FROM public.customer_invoice_lines l WHERE company_id IN(${companies})))`)
 const invoiceBefore=invoices(),sourceHash=createHash('sha256').update(incoming.source.raw_payload!,'utf8').digest('hex')
 const sourceBytes=()=>sql(`SELECT jsonb_build_object('raw',raw_payload,'hash',encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),'sealedHash',immutable_payload_hash,'renderedAt',immutable_rendered_at) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND id=${lit(incoming.source.id)}`)
 const rawBefore=sourceBytes()
 await incoming.persist();const ack=await incoming.ack();await incoming.finalize(ack)
 expect(f.effects().series).toBe(before.series+1);expect(f.effects().contracts).toBe(before.contracts+1)
 expect(f.effects().reservations).toBe(before.reservations+1);expect(f.effects().acks).toBe(before.acks+1)
 expect(sourceBytes()).toEqual(rawBefore);expect(invoices()).toEqual(invoiceBefore)
 const scopes=sql<{version:number;transactions:{scopes:{grant:{id:string};assignment:{beneficiary_company_id:string}}[]}[]}>(`SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE company_id=${lit(f.ids.company)} AND ack_raw_hash=encode(sha256(convert_to(${lit(ack.raw_payload)},'UTF8')),'hex')`)
 expect(scopes.version).toBe(2);expect(scopes.transactions).toHaveLength(1)
 expect(scopes.transactions[0].scopes.map(x=>x.grant.id).sort()).toEqual([first.grantId,other.grantId].sort())
 expect(scopes.transactions[0].scopes.map(x=>x.assignment.beneficiary_company_id).sort()).toEqual([f.ids.beneficiary,second.ids.beneficiary].sort())
 const one=beneficiaryRead(f,first,incoming.source.id),two=beneficiaryRead(second,other,incoming.source.id)
 expect(one.request.seriesId).toBe(two.request.seriesId)
 const snapshot=()=>sql<{source:unknown;binding:unknown[];series:unknown[];valueRows:unknown[];values:{reading_at:string;quantity:string}[];contracts:unknown[];dispositions:Record<string,unknown>[];acks:Record<string,unknown>[];archives:unknown[]}>(`SELECT jsonb_build_object(
  'source',(SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${lit(incoming.source.id)} AND company_id=${lit(f.ids.company)}),
  'binding',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.source_message_id),'[]') FROM gridex_utilts_binding.receipts r WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(incoming.source.id)}),
  'series',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM public.meter_reading_series s WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(incoming.source.id)}),
  'values',(SELECT coalesce(jsonb_agg(jsonb_build_object('reading_at',v.reading_at,'quantity',v.quantity::text) ORDER BY v.reading_at,v.id),'[]') FROM public.meter_reading_values v WHERE company_id=${lit(f.ids.company)} AND series_id=${lit(one.request.seriesId)}),
  'valueRows',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.reading_at,v.id),'[]') FROM public.meter_reading_values v WHERE company_id=${lit(f.ids.company)} AND series_id=${lit(one.request.seriesId)}),
  'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.series_id),'[]') FROM gridex_utilts_binding.contracts c WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(incoming.source.id)}),
  'dispositions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.source_transaction_id),'[]') FROM public.ediel_ack_transaction_results d WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(incoming.source.id)}),
  'acks',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.ediel_messages a WHERE company_id=${lit(f.ids.company)} AND direction='outbound' AND related_message_id=${lit(incoming.source.id)} AND message_family='APERAK' AND ack_outcome='positive'),
  'archives',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM gridex_ediel_services.artifacts a WHERE company_id=${lit(f.ids.company)}))`)
 const stored=snapshot(),stable=f.effects()
 expect(stored.binding).toHaveLength(1);expect(stored.series).toHaveLength(1);expect(stored.contracts).toHaveLength(1)
 expect(stored.dispositions).toHaveLength(1);expect(stored.dispositions[0]).toMatchObject({disposition:'accepted',persistence_status:'persisted',final_response_type:'positive_aperak',response_message_id:ack.id,persisted_series_id:one.request.seriesId})
 expect(stored.acks).toHaveLength(1);expect(stored.acks[0]).toMatchObject({id:ack.id,raw_payload:ack.raw_payload})
 expect(incoming.input.contracts).toHaveLength(1)
 expect(stored.values.length).toBeGreaterThan(0);expect(stored.values).toHaveLength(incoming.input.contracts[0].observations.length)
 expect(f.effects().values).toBe(before.values+incoming.input.contracts[0].observations.length)
 expect(stored.values.length).toBeLessThanOrEqual(100)
 const energy=()=>sql(`SELECT jsonb_build_object('count',count(*),'sum',sum(quantity)::text) FROM public.meter_reading_values WHERE company_id=${lit(f.ids.company)} AND series_id=${lit(one.request.seriesId)}`),energyBefore=energy()
 const retained=()=>{expect(snapshot()).toEqual(stored);expect(sourceBytes()).toEqual(rawBefore);expect(energy()).toEqual(energyBefore);expect(invoices()).toEqual(invoiceBefore);expect(f.effects()).toEqual(stable)}
 const pages=[]
 for(const p of [one,two]){
  const page=await p.read();pages.push(page)
  expect(page.rows).toEqual(stored.values);expect(page.next).toBeNull();expect(page.grantId).toBe(p.request.grantId)
  expect(page.provenance).toMatchObject({sourceMessageId:incoming.source.id,sourceRawHash:sourceHash,sourceRole:'DGI',sourceApplicationReference:'23-DGI-E66-T',purpose:f.fields.purpose})
  for(const row of page.rows)expect(Object.keys(row).sort()).toEqual(['quantity','reading_at'])
  retained()
 }
 expect(pages[0].consumerReceiptId).not.toBe(pages[1].consumerReceiptId)
 expect(pages[0].provenance.contractHash).toBe(pages[1].provenance.contractHash)
 await incoming.persist();expect((await incoming.ack()).id).toBe(ack.id);await incoming.finalize(ack);retained()
 await expect(projectEdielSeriesToBeneficiary({...one.request,grantId:other.grantId,expectedGrantVersion:two.request.expectedGrantVersion})).rejects.toBeDefined()
 await expect(projectEdielSeriesToBeneficiary({...one.request,beneficiaryCompanyId:second.ids.beneficiary})).rejects.toBeDefined()
 await expect(projectEdielSeriesToBeneficiary({...two.request,purpose:'uncontracted wider use'})).rejects.toBeDefined()
 await expect(projectEdielSeriesToBeneficiary({...two.request,fields:['quality']})).rejects.toBeDefined();retained()
 expect(await second.command({action:'revoke_grant',commandId:randomUUID(),assignmentId:second.assignment,expectedVersion:second.current().version,grantId:other.grantId,expectedGrantVersion:two.request.expectedGrantVersion})).toMatchObject({status:'revoked'})
 await expect(two.read()).rejects.toMatchObject({message:expect.stringContaining('ediel_grant_not_current')})
 expect((await one.read()).rows).toEqual(stored.values)
 await expect(incoming.ack()).rejects.toMatchObject({message:expect.stringContaining('ediel_ack_service_scope_captured_grant_not_current')})
 retained();expect(external.send).toHaveBeenCalledTimes(1)
})


it('TEN09 rechecks the protected explicit resolver and coordinator without another beneficiary request or broader grant',async()=>{
 const f=await seedNativeEscoFixture(),first=await qualifyNativeEscoFixture(f)
 const second=await samePermissionMission(f),other=await qualifyNativeEscoFixture(second,first)
 const grants=()=>sql(`SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)}`)
 const permissions=()=>sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.metering_permissions p WHERE company_id=${lit(f.ids.company)}`)
 const links=()=>sql(`SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.ediel_assignment_permission_links l WHERE company_id=${lit(f.ids.company)}`)
 const before={effects:f.effects(),grants:grants(),permissions:permissions(),links:links()}
 const command={providerCompanyId:f.ids.company,assignmentId:second.assignment,actorUserId:f.ids.actor,expectedVersion:second.current().version}
 expect(await resolveEdielServicePermissionCommand({...command,permissionId:first.permissionId})).toMatchObject({status:'reuse_permission',permissionId:first.permissionId,marketPermissionState:'approved',accessGranted:false})
 expect(await coordinateEdielServicePermission({...command,command:'request_access'})).toMatchObject({status:'reuse_permission',permissionId:first.permissionId})
 expect(await resolveEdielServicePermissionCommand({...command,permissionId:randomUUID()})).toMatchObject({status:'held',missing:['immutable_service_request_permission_mismatch']})
 await expect(resolveEdielServicePermissionCommand({...command,permissionId:first.permissionId,expectedVersion:command.expectedVersion+1})).rejects.toBeDefined()
 await expect(resolveEdielServicePermissionCommand({...command,permissionId:first.permissionId,actorUserId:randomUUID()})).rejects.toBeDefined()
 await expect(resolveEdielServicePermissionCommand({...command,permissionId:first.permissionId,providerCompanyId:second.ids.beneficiary})).rejects.toBeDefined()
 expect({effects:f.effects(),grants:grants(),permissions:permissions(),links:links()}).toEqual(before)
 expect(first.grantId).not.toBe(other.grantId);expect(external.send).toHaveBeenCalledTimes(1)
})

it('TEN09 ending one mission revokes only its grant and preserves the shared market permission until the last mission ends',async()=>{
 const f=await seedNativeEscoFixture(),first=await qualifyNativeEscoFixture(f)
 const second=await samePermissionMission(f),other=await qualifyNativeEscoFixture(second,first)
 const permission=()=>sql(`SELECT to_jsonb(p) FROM public.metering_permissions p WHERE company_id=${lit(f.ids.company)} AND id=${lit(first.permissionId)}`)
 const grant=(id:string)=>sql<{status:string;assignment_id:string;beneficiary_company_id:string}>(`SELECT to_jsonb(g) FROM public.ediel_data_access_grants g WHERE company_id=${lit(f.ids.company)} AND id=${lit(id)}`)
 const originalPermission=permission(),ownGrant=grant(first.grantId),before=f.effects()
 expect(grant(other.grantId)).toMatchObject({status:'active',assignment_id:second.assignment,beneficiary_company_id:second.ids.beneficiary})
 expect(await coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:second.assignment,actorUserId:f.ids.actor,expectedVersion:second.current().version,command:'end_assignment'})).toEqual({status:'assignment_ended',permissionId:first.permissionId})
 expect(grant(other.grantId)).toMatchObject({status:'revoked',assignment_id:second.assignment})
 expect(grant(first.grantId)).toEqual(ownGrant);expect(permission()).toEqual(originalPermission)
 expect(sql(`SELECT to_jsonb(status) FROM public.ediel_service_assignments WHERE company_id=${lit(f.ids.company)} AND id=${lit(second.assignment)}`)).toBe('ended')
 expect(sql(`SELECT to_jsonb(status) FROM public.ediel_service_assignments WHERE company_id=${lit(f.ids.company)} AND id=${lit(f.assignment)}`)).toBe('active')
 expect(f.effects()).toEqual(before);expect(external.send).toHaveBeenCalledTimes(1)
 expect(await coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version,command:'end_assignment'})).toEqual({status:'market_termination_required',permissionId:first.permissionId})
 expect(grant(first.grantId).status).toBe('revoked');expect(permission()).toEqual(originalPermission)
 // A decision that termination is now required is not a created or sent Z15.
 expect(f.effects()).toEqual(before);expect(external.send).toHaveBeenCalledTimes(1)
})
