import {z} from 'zod'
import {supabaseService} from '@/lib/supabase/service'
export const freshEdielBusinessIncidentCommand=z.object({commandId:z.string().uuid(),sourceMessageId:z.string().uuid(),ackMessageId:z.string().uuid(),scopeReference:z.string().trim().min(1).max(100),finding:z.object({code:z.literal('late_internal_business_error'),summary:z.string().trim().min(1).max(2000)}).strict()}).strict()
const result=z.object({incidentId:z.string().uuid(),commandId:z.string().uuid(),companyId:z.string().uuid(),environment:z.enum(['test','production']),sourceMessageId:z.string().uuid(),ackMessageId:z.string().uuid(),scope:z.object({scope:z.enum(['message','object','transaction']),reference:z.string(),outcome:z.literal('positive')}).passthrough(),reportedAt:z.string(),finding:z.object({code:z.literal('late_internal_business_error'),summary:z.string()}),status:z.literal('reported'),findingValidated:z.literal(false),ackHistoryChanged:z.literal(false),contactStatus:z.literal('held'),correctionStatus:z.literal('held'),trafficAuthorized:z.literal(false)})
export type FreshEdielBusinessIncident=z.infer<typeof result>
/** A new observed finding is a report. The native owner binds the already
 * accepted positive scope; this report neither changes its outcome nor grants
 * correction/contact authority. ACK replay never invokes this operation. */
export async function reportFreshEdielBusinessIncident(input:{companyId:string;actorUserId:string;command:unknown}):Promise<FreshEdielBusinessIncident>{
 const command=freshEdielBusinessIncidentCommand.parse(input.command)
 const {data,error}=await supabaseService.rpc('ediel_report_fresh_business_incident_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_input:command})
 if(error)throw error
 const receipt=result.parse(data)
 if(receipt.companyId!==input.companyId||receipt.commandId!==command.commandId||receipt.sourceMessageId!==command.sourceMessageId||receipt.ackMessageId!==command.ackMessageId||receipt.scope.reference!==command.scopeReference)throw Error('ediel_business_incident_receipt_scope_mismatch')
 return receipt
}
export async function readFreshEdielBusinessIncident(input:{companyId:string;actorUserId:string;incidentId:string}):Promise<FreshEdielBusinessIncident>{
 const {data,error}=await supabaseService.rpc('ediel_read_fresh_business_incident_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_incident_id:z.string().uuid().parse(input.incidentId)})
 if(error)throw error
 const receipt=result.parse(data);if(receipt.companyId!==input.companyId||receipt.incidentId!==input.incidentId)throw Error('ediel_business_incident_receipt_scope_mismatch');return receipt
}
