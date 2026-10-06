// masterplan: TEN-09, AT-TEN-09
import {randomUUID} from 'node:crypto'
import {beforeEach,expect,it} from 'vitest'
import {coordinateEdielServicePermission,resolveEdielServicePermissionCommand} from '@/lib/ediel/services/commands'
import {
 nativeEscoLiteral as lit,nativeEscoSql as sql,nativeEscoExternal as external,
 resetNativeEscoFixture,seedNativeEscoFixture,qualifyNativeEscoFixture,
} from './fixtures/ediel-service-evidence-native'

// Real local PostgreSQL/PostgREST and authenticated archived source owners.
// Only external SMTP is substituted. Synthetic issuer/legal fixture inputs
// are not market or legal approval. The pinned SC003/005 file stays untouched.
beforeEach(resetNativeEscoFixture)
type Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>

async function samePermissionMission(f:Fixture):Promise<Fixture>{
 const beneficiary=randomUUID(),key=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(beneficiary)},'Synthetic independent second mission','active')`)
 const fields={...f.fields,beneficiary_company_id:beneficiary,field_sets:['reading_at','quantity','unit']}
 const made=await f.command({action:'create_assignment',commandId:randomUUID(),fields})
 expect(made.status).toBe('held')
 const assignment=String(made.assignmentId),current=()=>sql<ReturnType<Fixture['current']>>(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,'scope',gridex_service_administration.scope_v1(a),'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex')) FROM public.ediel_service_assignments a WHERE company_id=${lit(f.ids.company)} AND id=${lit(assignment)}`)
 return {...f,ids:{...f.ids,beneficiary,key},fields,assignment,current}
}
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
