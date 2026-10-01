import {randomUUID}from'node:crypto'
import {z}from'zod'
import {supabaseService}from'@/lib/supabase/service'
const uuid=z.string().uuid()
const phaseSchema=z.enum(['validated','draft'])
const intentSchema=z.object({id:uuid,company_id:uuid,validation_status:z.string(),render_status:z.string(),outbox_status:z.string(),
 direction:z.string(),ediel_message_id:uuid.nullable(),updated_at:z.string()}).passthrough()
const claimSchema=z.object({intent:intentSchema,phase:phaseSchema,claimToken:uuid,expiresAt:z.string()}).strict()
export type EdielResumeClaim=z.infer<typeof claimSchema>
const unavailable=()=>new Error('ediel_resume_claim_unavailable')
export async function claimEdielResumeIntents(input:{phase:'validated'|'draft';companyId?:string|null;limit:number}){
 const company=input.companyId?.trim().toLowerCase()??null
 if(company!==null&&!uuid.safeParse(company).success)throw unavailable()
 const limit=Math.min(Math.max(Math.floor(Number.isFinite(input.limit)?input.limit:10),1),100),token=randomUUID()
 const response=await supabaseService.rpc('gridex_claim_ediel_resume_intents_fair_v1',{
  p_phase:input.phase,p_company_id:company,p_limit:limit,p_claim_token:token,
 })
 const parsed=z.array(claimSchema).max(limit).safeParse(response.data)
 if(response.error||!parsed.success||new Set(parsed.data.map(c=>c.intent.id)).size!==parsed.data.length
  ||parsed.data.some(c=>c.phase!==input.phase||c.claimToken!==token||(company&&c.intent.company_id!==company)
   ||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.now()
   ||!Number.isFinite(Date.parse(c.intent.updated_at))
   ||c.intent.outbox_status!=='not_queued'||(input.phase==='validated'
    ?c.intent.validation_status!=='validated'||!['not_rendered','failed'].includes(c.intent.render_status)
    :c.intent.validation_status!=='draft'||c.intent.direction!=='outbound'||c.intent.ediel_message_id!==null)))throw unavailable()
 return parsed.data
}
export async function checkEdielResumeClaim(claim:EdielResumeClaim){
 const checked=await supabaseService.rpc('gridex_check_ediel_resume_claim_v1',{
  p_company_id:claim.intent.company_id,p_intent_id:claim.intent.id,p_phase:claim.phase,p_claim_token:claim.claimToken,
 })
 if(checked.error||typeof checked.data!=='boolean')throw unavailable()
 return checked.data
}
export async function finishEdielResumeClaim(claim:EdielResumeClaim,outcome:'processed'|'failed'|'skipped'){
 const response=await supabaseService.rpc('gridex_finish_ediel_resume_claim_v1',{
  p_company_id:claim.intent.company_id,p_intent_id:claim.intent.id,p_phase:claim.phase,p_claim_token:claim.claimToken,
  p_outcome:outcome,p_reason:outcome==='failed'?'ediel_resume_dispatch_failed':null,
 })
 if(response.error||response.data!==true)throw new Error('ediel_resume_completion_unavailable')
}
