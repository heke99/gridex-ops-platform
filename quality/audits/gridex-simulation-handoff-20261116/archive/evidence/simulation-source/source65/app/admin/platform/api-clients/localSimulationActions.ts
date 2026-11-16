'use server'

import {createHash, randomBytes} from 'node:crypto'
import {requirePlatformAdminActionAccess} from '@/lib/admin/guards'
import {normalizeIntegrationApiScopes} from '@/lib/integrations/apiClientSecrets'
import {createSupabaseServerClient} from '@/lib/supabase/server'

type Receipt = {version:1;purpose:'LOCAL_SIMULATION_ONLY';admissionId:string;companyId:string;manifestSha256:string;visibleDocumentText:string;documentSha256:string;expiresAt:string;replayed:boolean}
export type LocalPartnerState = {ok:boolean;message:string;receipt?:Receipt;token?:string;credentialId?:string}
type Name = 'gridex_prepare_local_simulation_partner_v1'|'gridex_issue_local_simulation_partner_credential_v1'|'gridex_revoke_local_simulation_partner_v1'
type Command = Record<string,unknown>
const text=(f:FormData,k:string)=>String(f.get(k)??'').trim()
async function client() {
  await requirePlatformAdminActionAccess()
  const c=await createSupabaseServerClient()
  const {data,error}=await c.auth.getUser()
  if(error||!data.user)throw new Error('authenticated_operator_required')
  // New functions are validated at runtime pending sole-producer type generation.
  return c as unknown as {rpc(name:Name,args:{p_command:Command}):PromiseLike<{data:unknown;error:{message?:string}|null}>}
}
function record(v:unknown):Record<string,unknown>{return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}}
function message(error:unknown) {return error instanceof Error&&/^gridex_local_[a-z0-9_]+$/.test(error.message)?error.message:'Åtgärden kunde inte bekräftas. Ingen nyckel visas; kontrollera kvittot innan ett nytt försök.'}
export async function prepareLocalSimulationPartnerAction(_state:LocalPartnerState,f:FormData):Promise<LocalPartnerState> {
  try {
    const c=await client()
    const {data,error}=await c.rpc('gridex_prepare_local_simulation_partner_v1',{p_command:{version:1,companyId:text(f,'companyId'),sourceOfferId:text(f,'sourceOfferId'),pricePlanVersionId:text(f,'pricePlanVersionId'),expectedPvContentSha256:text(f,'expectedPvContentSha256'),expiresAt:text(f,'expiresAt'),idempotencyKey:text(f,'idempotencyKey')}})
    if(error)throw new Error(error.message)
    const r=record(data)
    if(r.version!==1||r.purpose!=='LOCAL_SIMULATION_ONLY'||['admissionId','companyId','manifestSha256','visibleDocumentText','documentSha256','expiresAt'].some(k=>typeof r[k]!=='string')||typeof r.replayed!=='boolean')throw new Error('invalid_receipt')
    return {ok:true,message:'Läs testdeklarationen före attest och nyckelutfärdande.',receipt:r as Receipt}
  }catch(error){return {ok:false,message:message(error)}}
}
export async function issueLocalSimulationPartnerAction(_state:LocalPartnerState,f:FormData):Promise<LocalPartnerState> {
  try {
    if(text(f,'confirmed')!=='yes')return {ok:false,message:'Bekräfta den synliga lokala testdeklarationen.'}
    const c=await client()
    const prefix=`gdxl_${randomBytes(4).toString('hex').slice(0,7)}`
    const token=`${prefix}.${randomBytes(32).toString('base64url')}`
    const list=(key:string)=>text(f,key).split(/[\n,]+/).map(s=>s.trim()).filter(Boolean)
    const requestedScopes=f.getAll('scopes').map(String)
    const scopes=normalizeIntegrationApiScopes(requestedScopes)
    if(scopes.length!==requestedScopes.length)throw new Error('gridex_local_partner_scope_not_allowed')
    const {data,error}=await c.rpc('gridex_issue_local_simulation_partner_credential_v1',{p_command:{version:1,admissionId:text(f,'admissionId'),visibleDocumentText:String(f.get('visibleDocumentText')??''),documentSha256:text(f,'documentSha256'),keyPrefix:prefix,secretHash:createHash('sha256').update(token,'utf8').digest('hex'),scopes,allowedIps:list('allowedIps'),allowedOrigins:list('allowedOrigins'),expiresAt:text(f,'expiresAt'),idempotencyKey:text(f,'idempotencyKey')}})
    if(error)throw new Error(error.message)
    const r=record(data)
    if(r.version!==1||r.purpose!=='LOCAL_SIMULATION_ONLY'||r.admissionId!==text(f,'admissionId')||r.keyPrefix!==prefix||r.replayed!==false||typeof r.credentialId!=='string'||typeof r.expiresAt!=='string')throw new Error('unconfirmed_key')
    return {ok:true,message:'Nyckeln visas en gång. Den gäller bara denna lokala testmodell och ger ingen produktions- eller leveransrätt.',token,credentialId:r.credentialId}
  }catch(error){return {ok:false,message:message(error)}}
}
export async function revokeLocalSimulationPartnerAction(_state:LocalPartnerState,f:FormData):Promise<LocalPartnerState> {
  try {
    const c=await client()
    const {data,error}=await c.rpc('gridex_revoke_local_simulation_partner_v1',{p_command:{version:1,admissionId:text(f,'admissionId'),targetKind:text(f,'targetKind'),targetId:text(f,'targetId')||null,reason:text(f,'reason')}})
    if(error)throw new Error(error.message)
    const r=record(data)
    if(r.version!==1||r.purpose!=='LOCAL_SIMULATION_ONLY'||r.admissionId!==text(f,'admissionId')||r.revoked!==true)throw new Error('unconfirmed_revoke')
    return {ok:true,message:'Återkallelsen är registrerad. Testobjektens produktionsspärr består.'}
  }catch(error){return {ok:false,message:message(error)}}
}
