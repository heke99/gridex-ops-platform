'use server'

import { revalidatePath } from 'next/cache'
import { requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { logAdminActionAndUsage } from '@/lib/audit/actionLogger'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { tenantInsert, tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { resetCustomerIdentityProviderCache } from '@/lib/customer-portal/customerAssertion'
import {
  IdentityProviderSetupError,
  TENANT_KEY_AUDIENCE,
  discoverOidcProvider,
  parsePublicJwk,
  tenantKeyIssuer,
} from '@/lib/customer-portal/identityProviderSetup'

export type CustomerLoginActionState = { ok: boolean; message: string }

const PERMISSIONS = { anyOf: ['users.write', 'tenants.invite'] }

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

/** Every write is bound to the tenant the form was rendered for (tenant switched in another tab = refused). */
async function authorize(formData: FormData) {
  const expected = text(formData, 'expected_company_id')
  const access = await requireCompanyScopedActionAccess(expected, PERMISSIONS)
  const scope = await getOperationalCompanyScope(access.userId)
  if (!scope.companyId || scope.companyId !== expected) {
    throw new IdentityProviderSetupError('Du har bytt bolag i en annan flik. Ladda om sidan och försök igen.')
  }
  return { companyId: expected, userId: access.userId }
}

async function replaceActiveProvider(companyId: string, userId: string, row: Record<string, unknown>, label: string) {
  const deactivate = await tenantUpdate(companyId, 'tenant_customer_identity_providers', { is_active: false, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('is_active', true)
  if (deactivate.error) throw deactivate.error
  const insert = await tenantInsert(companyId, 'tenant_customer_identity_providers', { ...row, enforcement: 'report', is_active: true, created_by: userId, updated_by: userId })
  if (insert.error) throw insert.error
  await logAdminActionAndUsage({
    companyId, actorUserId: userId, entityType: 'tenant_customer_identity_provider', entityId: companyId,
    action: 'customer_login_configured', label, newValues: { kind: row.kind, issuer: row.issuer, audience: row.audience },
  })
  resetCustomerIdentityProviderCache(companyId)
  revalidatePath('/admin/customer-login')
}

async function run(fn: () => Promise<string>): Promise<CustomerLoginActionState> {
  try {
    return { ok: true, message: await fn() }
  } catch (error) {
    if (error instanceof IdentityProviderSetupError) return { ok: false, message: error.message }
    console.error('[customer-login] action failed', error)
    return { ok: false, message: 'Det gick inte att spara just nu. Försök igen.' }
  }
}

/** Alternative 1: BankID/Freja broker or any OIDC provider. Only its public address and client id. */
export async function saveOidcProviderAction(_prev: CustomerLoginActionState, formData: FormData) {
  return run(async () => {
    const { companyId, userId } = await authorize(formData)
    const clientId = text(formData, 'client_id')
    if (!clientId || clientId.length > 200) throw new IdentityProviderSetupError('Ange Client-ID från er inloggningsleverantör.')
    const discovery = await discoverOidcProvider(text(formData, 'issuer'))
    await replaceActiveProvider(companyId, userId, {
      kind: 'oidc', display_name: text(formData, 'display_name') || 'Inloggningsleverantör',
      issuer: discovery.issuer, audience: clientId, jwks_uri: discovery.jwksUri, public_jwk: null,
      last_tested_at: new Date().toISOString(), last_test_result: { ok: true, key_count: discovery.keyCount },
    }, 'Kundinloggning via leverantör sparad')
    return `Klart. Vi hittade ${discovery.keyCount} publik${discovery.keyCount === 1 ? '' : 'a'} nyckel${discovery.keyCount === 1 ? '' : 'ar'} hos leverantören.`
  })
}

/** Alternative 2: the tenant's own password/OTP login. The key pair is generated in the browser; only the public half arrives here. */
export async function saveTenantKeyProviderAction(_prev: CustomerLoginActionState, formData: FormData) {
  return run(async () => {
    const { companyId, userId } = await authorize(formData)
    const jwk = parsePublicJwk(text(formData, 'public_jwk'))
    await replaceActiveProvider(companyId, userId, {
      kind: 'tenant_key', display_name: 'Egen inloggning',
      issuer: tenantKeyIssuer(companyId), audience: TENANT_KEY_AUDIENCE, jwks_uri: null, public_jwk: jwk,
      last_tested_at: new Date().toISOString(), last_test_result: { ok: true },
    }, 'Kundinloggning med egen nyckel sparad')
    return 'Klart. Den publika nyckeln är sparad. Den privata nyckeln finns bara hos er.'
  })
}

/** Re-checks the active configuration without changing it. */
export async function testProviderAction(_prev: CustomerLoginActionState, formData: FormData) {
  return run(async () => {
    const { companyId } = await authorize(formData)
    const { data, error } = await tenantSelect(companyId, 'tenant_customer_identity_providers', 'id,kind,issuer,public_jwk')
      .eq('is_active', true).maybeSingle()
    if (error) throw error
    const provider = data as { id: string; kind: string; issuer: string; public_jwk: unknown } | null
    if (!provider) throw new IdentityProviderSetupError('Ingen kundinloggning är inställd än.')
    let message = 'Nyckeln är giltig.'
    let result: Record<string, unknown> = { ok: true }
    if (provider.kind === 'oidc') {
      const discovery = await discoverOidcProvider(provider.issuer)
      message = `Leverantören svarar och publicerar ${discovery.keyCount} nyckel${discovery.keyCount === 1 ? '' : 'ar'}.`
      result = { ok: true, key_count: discovery.keyCount }
    } else {
      parsePublicJwk(JSON.stringify(provider.public_jwk))
    }
    const update = await tenantUpdate(companyId, 'tenant_customer_identity_providers', { last_tested_at: new Date().toISOString(), last_test_result: result })
      .eq('id', provider.id)
    if (update.error) throw update.error
    revalidatePath('/admin/customer-login')
    return message
  })
}

/** "Logga bara" ↔ "Kräv verifierad kund". */
export async function setEnforcementAction(_prev: CustomerLoginActionState, formData: FormData) {
  return run(async () => {
    const { companyId, userId } = await authorize(formData)
    const enforcement = text(formData, 'enforcement') === 'enforce' ? 'enforce' : 'report'
    const { data, error } = await tenantUpdate(companyId, 'tenant_customer_identity_providers', { enforcement, updated_by: userId, updated_at: new Date().toISOString() })
      .eq('is_active', true).select('id').maybeSingle()
    if (error) throw error
    if (!data) throw new IdentityProviderSetupError('Ställ in kundinloggning först.')
    await logAdminActionAndUsage({
      companyId, actorUserId: userId, entityType: 'tenant_customer_identity_provider', entityId: companyId,
      action: 'customer_login_enforcement_changed', label: 'Krav på verifierad kund ändrat', newValues: { enforcement },
    })
    resetCustomerIdentityProviderCache(companyId)
    revalidatePath('/admin/customer-login')
    return enforcement === 'enforce'
      ? 'Nu krävs verifierad kund. Anrop utan giltigt kundintyg nekas.'
      : 'Nu loggas bara anrop utan giltigt kundintyg. Inget nekas.'
  })
}

export async function removeProviderAction(_prev: CustomerLoginActionState, formData: FormData) {
  return run(async () => {
    const { companyId, userId } = await authorize(formData)
    const { error } = await tenantUpdate(companyId, 'tenant_customer_identity_providers', { is_active: false, updated_by: userId, updated_at: new Date().toISOString() })
      .eq('is_active', true)
    if (error) throw error
    await logAdminActionAndUsage({
      companyId, actorUserId: userId, entityType: 'tenant_customer_identity_provider', entityId: companyId,
      action: 'customer_login_removed', label: 'Kundinloggning borttagen',
    })
    resetCustomerIdentityProviderCache(companyId)
    revalidatePath('/admin/customer-login')
    return 'Kundinloggningen är borttagen. API:t fungerar som tidigare.'
  })
}
