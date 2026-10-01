import {randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveRegulatedSupplyGround,reviewRegulatedSupplyGround,readRegulatedSupplyGroundBytes} from '@/lib/ediel/production/regulatedSupplyGroundIntake'
/** Real disposable contract/signature/PDF/POA and current role owners. The
 * trusted issuer configuration is explicitly synthetic: these assertions grant
 * no real legal-ground, bilateral or Ediel acceptance approval. Private archives,
 * reviews, grounds and origin receipts are always minted by their actual RPC. */

import {createRegulatedSupplyGroundNativeFixture as fixture} from './helpers/ediel-regulated-supply-ground-native-fixture'
const review=(f:Awaited<ReturnType<typeof fixture>>,artifact:Record<string,unknown>)=>({companyId:f.companyId,actorUserId:f.reviewer,artifactId:String(artifact.artifactId),sourceHash:String(artifact.sourceHash),scopeHash:String(artifact.scopeHash),decision:'approve' as const,reason:'Separate qualified synthetic test original review'})
it('real native HTTP archive/review/ground producer requires actual issuer proof, separate grants and exact immutable current scope',async()=>{
 const f=await fixture(),unsigned=await archiveRegulatedSupplyGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.submission}),beforeSwitch=sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)
 expect((await reviewRegulatedSupplyGround(review(f,unsigned))).status).toBe('held')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.regulated_supply_ground_versions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 const archived=await archiveRegulatedSupplyGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),authorized=await reviewRegulatedSupplyGround(review(f,archived));expect(authorized.status).toBe('authorized')
 expect(sql(`SELECT jsonb_build_object('grounds',(SELECT count(*) FROM gridex_received_sources.regulated_supply_ground_versions WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_regulated_supply.origins WHERE company_id=${literal(f.companyId)}),'current',gridex_regulated_supply.ground_current_v1(${literal(authorized.groundId)},${literal(f.companyId)},${literal(f.pointId)},${literal(f.submission.startAt)}))`)).toEqual({grounds:1,origins:1,current:true})
 expect(Buffer.from((await readRegulatedSupplyGroundBytes({companyId:f.companyId,actorUserId:f.actorUserId,artifactId:String(archived.artifactId)})).bytes)).toEqual(f.bytes)
 expect((await reviewRegulatedSupplyGround(review(f,archived))).groundId).toBe(authorized.groundId)
 await expect(readRegulatedSupplyGroundBytes({companyId:randomUUID(),actorUserId:f.actorUserId,artifactId:String(archived.artifactId)})).rejects.toThrow()
 sql(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${literal(f.reviewer)} AND company_id=${literal(f.companyId)} AND permission_key='ediel.regulated_supply.review';`)
 expect(sql(`SELECT to_jsonb(gridex_regulated_supply.ground_current_v1(${literal(authorized.groundId)},${literal(f.companyId)},${literal(f.pointId)},${literal(f.submission.startAt)}))`)).toBe(false)
 expect(sql(`SELECT to_jsonb(s) FROM public.supplier_switch_requests s WHERE id=${literal(f.switchId)}`)).toEqual(beforeSwitch)
 expect(sql(`SELECT jsonb_build_object('periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'sourceTransitions',(SELECT count(*) FROM gridex_received_sources.supply_source_transitions WHERE company_id=${literal(f.companyId)}))`)).toEqual({periods:0,sourceTransitions:0})
},120000)
it('actual final immutable origin insert failure rolls back separate review and ground atomically',async()=>{
 const f=await fixture(),artifact=await archiveRegulatedSupplyGround({companyId:f.companyId,actorUserId:f.actorUserId,...f.signed()}),constraint=`regulated_origin_rollback_${randomUUID().replaceAll('-','')}`
 const counts=()=>sql(`SELECT jsonb_build_object('reviews',(SELECT count(*) FROM gridex_regulated_supply.reviews WHERE company_id=${literal(f.companyId)}),'grounds',(SELECT count(*) FROM gridex_received_sources.regulated_supply_ground_versions WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_regulated_supply.origins WHERE company_id=${literal(f.companyId)}))`),before=counts()
 sql(`ALTER TABLE gridex_regulated_supply.origins ADD CONSTRAINT ${constraint} CHECK(company_id<>${literal(f.companyId)}::uuid) NOT VALID`)
 try{await expect(reviewRegulatedSupplyGround(review(f,artifact))).rejects.toThrow();expect(counts()).toEqual(before)}finally{sql(`ALTER TABLE gridex_regulated_supply.origins DROP CONSTRAINT ${constraint}`)}
},120000)
it('private original/issuer/ground custody cannot be forged by application roles',()=>{
 for(const role of ['anon','authenticated','service_role'])for(const table of ['artifacts','reviews','origins','issuer_keys','issuer_representations','issuer_revocations'])expect(sql(`SELECT to_jsonb(has_table_privilege(${literal(role)},${literal(`gridex_regulated_supply.${table}`)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`)).toBe(false)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id OR rp.permission_id IS NULL AND p.key=rp.permission_key WHERE p.key='ediel.regulated_supply.review'`)).toBe(0)
})
