import { generateKeyPairSync, sign, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/tenantQuery', () => ({ tenantSelect: vi.fn(), tenantInsert: vi.fn() }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: vi.fn() }))
vi.mock('@/lib/integrations/apiAuth', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), requireIntegrationApiAccess: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ SUPABASE_SERVICE_URL: 'https://piidsfebjqjmnepdpnas.supabase.co', supabaseService: {} }))
import { createStaffApiContextResolver, type StaffContextDependencies } from '@/lib/staff-api/context'
import { ApiInputError } from '@/lib/api/strictRequest'
const company='11111111-1111-4111-8111-111111111111', actor='22222222-2222-4222-8222-222222222222'
const local='33333333-3333-4333-8333-333333333333', binding='44444444-4444-4444-8444-444444444444'
const rsa=generateKeyPairSync('rsa',{modulusLength:2048})
const provider={id:randomUUID(),company_id:company,kind:'tenant_key' as const,display_name:'Synthetic',issuer:'https://support.example.com',audience:'staff-audience',jwks_uri:null,public_jwk:rsa.publicKey.export({format:'jwk'}),subject_claim:'sub',enforcement:'enforce' as const}
function proof() {
 const now=Math.floor(Date.now()/1000)
 const header=Buffer.from(JSON.stringify({alg:'RS256'})).toString('base64url')
 const payload=Buffer.from(JSON.stringify({iss:provider.issuer,aud:provider.audience,sub:actor,iat:now,exp:now+300,jti:randomUUID(),token_use:'staff_access',company_id:company,staff_binding_id:binding,staff_binding_version:1,local_auth_subject:local,local_auth_issuer:'https://ayiuxjlfazkjmmtlvhsl.supabase.co/auth/v1'})).toString('base64url')
 return `${header}.${payload}.${sign('sha256',Buffer.from(`${header}.${payload}`),rsa.privateKey).toString('base64url')}`
}
it('registered revoked binding denies, removed metadata bypasses binding validation with identical actor/client/provider authority',async()=>{
 const client={id:randomUUID(),company_id:company,name:'Synthetic',key_prefix:'synthetic',secret_hash:'',scopes:['staff_customers.read'],rate_limit_per_minute:60,allowed_ips:[],status:'active',expires_at:null,allowed_origins:['https://support123.gridex.se'],metadata:{staff_onboarding_origin:'https://support123.gridex.se',staff_tenant_auth:{url:'https://ayiuxjlfazkjmmtlvhsl.supabase.co',public_key:'sb_publishable_synthetic_public_key_1234567890'}}}
 const ports: StaffContextDependencies={apiAccess:vi.fn(async()=>({ok:true,client,context:{},rateLimit:{}})) as unknown as StaffContextDependencies['apiAccess'],loadProvider:vi.fn(async()=>provider),loadMembership:vi.fn(async()=>({user_id:actor,role_key:'customer_service_agent',membership_role:'support',status:'active',is_active:true})),loadOverrides:vi.fn(async()=>[]),consumeJti:vi.fn(async()=>true),validateBinding:vi.fn(async()=>{throw new ApiInputError('Revoked synthetic binding','staff_identity_binding_invalid',403)})}
 const resolve=createStaffApiContextResolver(ports)
 const request=()=>new NextRequest('https://app.gridex.se/api/v1/staff/customers',{headers:{authorization:'Bearer synthetic-api-key','x-gridex-staff-assertion':proof()}})
 await expect(resolve(request(),{scopes:['staff_customers.read'],permission:'customers.read'})).rejects.toMatchObject({status:403,code:'staff_identity_binding_invalid'})
 expect(ports.validateBinding).toHaveBeenCalledOnce()
 expect(ports.loadMembership).not.toHaveBeenCalled()
 vi.mocked(ports.validateBinding).mockClear()
 vi.mocked(ports.apiAccess).mockResolvedValue({ok:true,client:{...client,metadata:{}},context:{},rateLimit:{}} as never)
 await expect(resolve(request(),{scopes:['staff_customers.read'],permission:'customers.read'})).resolves.toMatchObject({companyId:company,actorUserId:actor})
 expect(ports.validateBinding).not.toHaveBeenCalled()
 expect(ports.loadMembership).toHaveBeenCalledWith(company,actor)
})
