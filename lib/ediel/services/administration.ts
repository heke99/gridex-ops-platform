import {z} from 'zod'
import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from './authorization'
import {coordinateEdielServicePermission} from './commands'
import {prepareAndQueueServicePermissionZ13,prepareAndQueueServicePermissionZ18} from '@/lib/ediel/flows/prodatServicePermission'
import {EDIEL_SERVICE_PURPOSE_MAX_LENGTH} from './limits'
const uuid=z.string().uuid(),version=z.number().int().positive().safe(),date=z.string().datetime({offset:true})
const calendarDate=z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value=>{const day=new Date(value+'T00:00:00Z');return Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===value})
const texts=z.array(z.string().trim().min(1).max(100)).nonempty().max(4096).refine(v=>new Set(v).size===v.length,'Duplicerade scopevärden.')
const period={data_start:date,data_end:date.nullable(),valid_from:date,valid_to:date.nullable()}
const assignment=z.object({beneficiary_company_id:uuid,provider_actor_id:uuid,actor_profile_id:uuid,customer_id:uuid,dso_actor_id:uuid,environment:z.enum(['test','production']),mode:z.enum(['V','VH']),purpose:z.string().trim().min(1).max(EDIEL_SERVICE_PURPOSE_MAX_LENGTH),object_ids:texts,product_ids:texts,field_sets:texts,...period}).strict()
const evidence=z.object({kind:z.enum(['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles','transport_mandate']),source_reference:z.string().trim().min(1).max(2000),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),source_version:z.string().trim().min(1).max(200),valid_from:date,valid_to:date.nullable(),transport_relation_id:uuid.nullable().optional(),transport_actor_id:uuid.nullable().optional(),permission_network_contract_start:calendarDate.nullable().optional(),permission_network_contract_end:calendarDate.nullable().optional(),permission_agreement_reference:z.string().trim().min(1).max(35).nullable().optional(),permission_requested_method:z.string().trim().min(1).max(12).nullable().optional(),permission_purpose_code:z.enum(['B71','B72','B73','B74','B75','B76']).nullable().optional(),permission_reporting_frequency:z.string().trim().min(1).max(35).nullable().optional(),permission_request_grid_area:z.string().trim().min(1).max(35).nullable().optional(),permission_reporting_term_kind:z.enum(['bounded','indefinite']).nullable().optional(),permission_customer_classification:z.enum(['private','nonprivate']).nullable().optional(),permission_termination_reason:z.enum(['B77','B78','B79','B80','E37']).nullable().optional(),permission_termination_at:date.nullable().optional()}).strict()
const grant=z.object({permission_link_id:uuid,object_ids:texts,product_ids:texts,fields:z.array(z.enum(['reading_at','quantity','unit','quality','qualifier','registration_date','resolution','product_id'])).nonempty().max(8),...period}).strict()
const owned={commandId:uuid,assignmentId:uuid,expectedVersion:version}
const lifecycle={assignmentId:uuid,expectedVersion:version}
export const edielServiceCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create_assignment'),commandId:uuid,fields:assignment}).strict(),
 z.object({action:z.literal('stage_evidence'),...owned,fields:evidence}).strict(),
 z.object({action:z.literal('create_grant'),...owned,fields:grant}).strict(),
 z.object({action:z.literal('approve_assignment'),...owned}).strict(),
 z.object({action:z.literal('publish_grant'),...owned,grantId:uuid,expectedGrantVersion:version}).strict(),
 z.object({action:z.literal('revoke_grant'),...owned,grantId:uuid,expectedGrantVersion:version}).strict(),
 z.object({action:z.literal('request_access'),...lifecycle,permissionId:uuid.optional(),preferredRouteId:uuid.nullable().optional()}).strict(),
 z.object({action:z.literal('end_assignment'),...lifecycle}).strict(),
 z.object({action:z.literal('terminate_permission'),...lifecycle,permissionId:uuid,preferredRouteId:uuid.nullable().optional()}).strict(),
])
export type EdielServiceAdministrationCommand=z.infer<typeof edielServiceCommandSchema>
/** Session derives provider and actor; body never chooses either authority. */
export async function executeEdielServiceAdministration(input:{companyId:string;actorUserId:string;command:unknown}):Promise<unknown>{
 const command=edielServiceCommandSchema.parse(input.command)
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'metering.write'})
 if(command.action==='request_access')return prepareAndQueueServicePermissionZ13({...command,providerCompanyId:input.companyId,actorUserId:input.actorUserId})
 if(command.action==='terminate_permission')return prepareAndQueueServicePermissionZ18({...command,providerCompanyId:input.companyId,actorUserId:input.actorUserId})
 if(command.action==='end_assignment')return coordinateEdielServicePermission({...command,providerCompanyId:input.companyId,actorUserId:input.actorUserId,command:'end_assignment'})
 const {data,error}=await supabaseService.rpc('ediel_service_administration_command_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_input:command})
 if(error)throw error
 if(!data||typeof data.status!=='string')throw new Error('ediel_service_administration_result_invalid')
 return data
}

export async function readEdielServiceAdministration(input:{companyId:string;actorUserId:string;assignmentId?:string|null}):Promise<Record<string,unknown>>{
 const assignmentId=input.assignmentId==null?null:uuid.parse(input.assignmentId)
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'metering.read'})
 const {data,error}=await supabaseService.rpc('ediel_service_administration_read_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_assignment_id:assignmentId})
 if(error)throw error
 if(!data||data.companyId!==input.companyId||!Array.isArray(data.assignments)||data.marketActivationGranted!==false)throw new Error('ediel_service_administration_result_invalid')
 return data
}
