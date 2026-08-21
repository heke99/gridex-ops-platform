import { supabaseService } from '@/lib/supabase/service'
import {
  ensureAuthorizationScopeFromPowerOfAttorney,
  getSignedPowerOfAttorneyCoverage,
  type PowerOfAttorneyCoverage,
} from '@/lib/operations/powerOfAttorneyWorkflow'

// Shared idempotent authorization chain helpers.
//
// The canonical legal/authorization chain is:
//   powers_of_attorney.document_id
//     = customer_authorization_documents.id
//     = authorization_scopes.authorization_document_id
//     = customer_info_requests / grid_owner_data_requests /
//       outbound_requests.authorization_document_id
//     = ediel_message_intents.payload.authorization_document_id
//
// Site-scoped operations must additionally prove that the authorization
// document belongs to the exact customer_site_id. A customer-wide scope row is
// never enough evidence for another site.

function missingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist|column .* does not exist/i.test(message)
}

export type EnsureCustomerAuthorizationDocumentInput = {
  companyId: string
  customerId: string
  powerOfAttorneyId: string
  siteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  reference?: string | null
  title?: string | null
  source?: string | null
  metadata?: Record<string, unknown>
}

export async function ensureCustomerAuthorizationDocument(
  input: EnsureCustomerAuthorizationDocumentInput,
): Promise<string | null> {
  let existingQuery = supabaseService
    .from('customer_authorization_documents')
    .select('id,site_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('power_of_attorney_id', input.powerOfAttorneyId)
  if (input.siteId) existingQuery = existingQuery.eq('site_id', input.siteId)
  const existing = await existingQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing.error) {
    if (missingSchema(existing.error)) return null
    throw existing.error
  }
  if (existing.data?.id) return String(existing.data.id)

  const now = new Date().toISOString()
  const reference = input.reference ?? `POA-${input.powerOfAttorneyId.slice(0, 8)}`
  const baseRow: Record<string, unknown> = {
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    customer_contract_id: input.contractId ?? null,
    power_of_attorney_id: input.powerOfAttorneyId,
    document_type: 'power_of_attorney',
    status: 'active',
    title: input.title ?? `Signerad fullmakt ${reference}`,
    reference,
    notes: 'Authorization document ensured from power of attorney (shared chain helper).',
    uploaded_at: now,
    metadata: {
      source: input.source ?? 'authorization_chain_helper',
      power_of_attorney_id: input.powerOfAttorneyId,
      customer_site_id: input.siteId ?? null,
      ...(input.metadata ?? {}),
    },
  }

  let inserted = await supabaseService
    .from('customer_authorization_documents')
    .insert(baseRow)
    .select('id')
    .maybeSingle()

  if (inserted.error && missingSchema(inserted.error)) {
    const fallbackRow = { ...baseRow }
    delete fallbackRow.customer_contract_id
    inserted = await supabaseService
      .from('customer_authorization_documents')
      .insert(fallbackRow)
      .select('id')
      .maybeSingle()
  }

  if (inserted.error) {
    if (missingSchema(inserted.error)) return null
    throw inserted.error
  }
  return inserted.data?.id ? String(inserted.data.id) : null
}

export type EnsureAuthorizationScopesInput = {
  companyId: string
  customerId: string
  authorizationDocumentId: string
  actorUserId?: string | null
  powerOfAttorneyId?: string | null
  coverage?: PowerOfAttorneyCoverage
  signedScopes?: string[]
  validFrom?: string | null
  validTo?: string | null
  evidenceNote?: string | null
}

export async function ensureAuthorizationScopes(
  input: EnsureAuthorizationScopesInput,
): Promise<string | null> {
  if (!input.coverage) {
    throw new Error('Signerad fullmaktsscope saknas och får inte antas.')
  }

  return ensureAuthorizationScopeFromPowerOfAttorney({
    companyId: input.companyId,
    actorUserId: input.actorUserId ?? null,
    customerId: input.customerId,
    powerOfAttorneyId: input.powerOfAttorneyId ?? null,
    authorizationDocumentId: input.authorizationDocumentId,
    coverage: input.coverage,
    signedScopes: input.signedScopes,
    validFrom: input.validFrom ?? null,
    validTo: input.validTo ?? null,
    evidenceNote: input.evidenceNote ?? null,
  })
}

export type EnsureAuthorizationChainInput = {
  companyId: string
  customerId: string
  powerOfAttorneyId: string
  actorUserId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  contractId?: string | null
  reference?: string | null
  source?: string | null
  validFrom?: string | null
  validTo?: string | null
  coverage?: PowerOfAttorneyCoverage
  signedScopes?: string[]
  metadata?: Record<string, unknown>
}

export type AuthorizationChainResult = {
  authorizationDocumentId: string | null
  authorizationScopeId: string | null
}

export async function ensureAuthorizationDocumentFromPowerOfAttorney(
  input: EnsureAuthorizationChainInput,
): Promise<AuthorizationChainResult> {
  const authorizationDocumentId = await ensureCustomerAuthorizationDocument({
    companyId: input.companyId,
    customerId: input.customerId,
    powerOfAttorneyId: input.powerOfAttorneyId,
    siteId: input.siteId ?? null,
    meteringPointId: input.meteringPointId ?? null,
    contractId: input.contractId ?? null,
    reference: input.reference ?? null,
    source: input.source ?? null,
    metadata: input.metadata,
  })

  let authorizationScopeId: string | null = null
  if (authorizationDocumentId) {
    authorizationScopeId = await ensureAuthorizationScopes({
      companyId: input.companyId,
      customerId: input.customerId,
      authorizationDocumentId,
      actorUserId: input.actorUserId ?? null,
      powerOfAttorneyId: input.powerOfAttorneyId,
      coverage: input.coverage,
      signedScopes: input.signedScopes,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
    })

    const poa = await supabaseService
      .from('powers_of_attorney')
      .select('id,document_id,site_id,customer_site_id')
      .eq('company_id', input.companyId)
      .eq('id', input.powerOfAttorneyId)
      .maybeSingle()
    const poaSite = poa.data?.customer_site_id ?? poa.data?.site_id ?? null
    const exactSite = !input.siteId || poaSite === input.siteId
    if (!poa.error && poa.data && exactSite && !poa.data.document_id) {
      await supabaseService
        .from('powers_of_attorney')
        .update({ document_id: authorizationDocumentId, updated_at: new Date().toISOString() })
        .eq('company_id', input.companyId)
        .eq('id', input.powerOfAttorneyId)
        .then(() => undefined, () => undefined)
    }
  }

  return { authorizationDocumentId, authorizationScopeId }
}

export async function resolveAuthorizationDocumentIdForPowerOfAttorney(input: {
  companyId: string
  powerOfAttorneyId: string
  siteId?: string | null
}): Promise<string | null> {
  const poa = await supabaseService
    .from('powers_of_attorney')
    .select('id,document_id,site_id,customer_site_id')
    .eq('company_id', input.companyId)
    .eq('id', input.powerOfAttorneyId)
    .maybeSingle()
  if (poa.error) {
    if (missingSchema(poa.error)) return null
    throw poa.error
  }
  const poaSite = poa.data?.customer_site_id ?? poa.data?.site_id ?? null
  if (input.siteId && poaSite !== input.siteId) return null

  const documentId = poa.data?.document_id ? String(poa.data.document_id) : null
  if (documentId) {
    let docQuery = supabaseService
      .from('customer_authorization_documents')
      .select('id')
      .eq('company_id', input.companyId)
      .eq('id', documentId)
    if (input.siteId) docQuery = docQuery.eq('site_id', input.siteId)
    const doc = await docQuery.maybeSingle()
    if (!doc.error && doc.data?.id) return String(doc.data.id)
  }

  let latestQuery = supabaseService
    .from('customer_authorization_documents')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('power_of_attorney_id', input.powerOfAttorneyId)
  if (input.siteId) latestQuery = latestQuery.eq('site_id', input.siteId)
  const latest = await latestQuery
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) {
    if (missingSchema(latest.error)) return null
    throw latest.error
  }
  return latest.data?.id ? String(latest.data.id) : null
}

export type AuthorizationCoverageRequirement =
  | 'grid_owner_data'
  | 'current_supplier_contract'
  | 'metering_data'

const COVERAGE_COLUMN: Record<AuthorizationCoverageRequirement, string> = {
  grid_owner_data: 'covers_grid_owner_data',
  current_supplier_contract: 'covers_current_supplier_contract',
  metering_data: 'covers_metering_data',
}

function isDateBeforeToday(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  const today = new Date().toISOString().slice(0, 10)
  return value.slice(0, 10) < today
}

export type AuthorizationScopeCoverageResult = {
  covered: boolean
  missing: AuthorizationCoverageRequirement[]
  healed: boolean
  schemaAvailable: boolean
}

async function exactSiteAuthorizationDocumentIds(input: {
  companyId: string
  customerId: string
  siteId: string
  powerOfAttorneyId?: string | null
}): Promise<{ ids: string[]; schemaAvailable: boolean }> {
  let query = supabaseService
    .from('customer_authorization_documents')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('site_id', input.siteId)
    .in('status', ['active', 'signed'])
  if (input.powerOfAttorneyId) query = query.eq('power_of_attorney_id', input.powerOfAttorneyId)
  const result = await query
  if (result.error) {
    if (missingSchema(result.error)) return { ids: [], schemaAvailable: false }
    throw result.error
  }
  return {
    ids: (result.data ?? []).map((row) => String(row.id)).filter(Boolean),
    schemaAvailable: true,
  }
}

async function powerOfAttorneyMatchesSite(input: {
  companyId: string
  customerId: string
  powerOfAttorneyId: string
  siteId: string
}): Promise<boolean> {
  const result = await supabaseService
    .from('powers_of_attorney')
    .select('id,site_id,customer_site_id,status,revoked_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('id', input.powerOfAttorneyId)
    .eq('status', 'signed')
    .is('revoked_at', null)
    .maybeSingle()
  if (result.error) {
    if (missingSchema(result.error)) return false
    throw result.error
  }
  const rowSite = result.data?.customer_site_id ?? result.data?.site_id ?? null
  return Boolean(result.data && rowSite === input.siteId)
}

/**
 * Verify active authorization scope coverage. When siteId is supplied, only
 * authorization documents explicitly bound to that exact site are eligible.
 * There is deliberately no fallback to another site or to a site-less legacy
 * document. A true multi-site mandate must be represented explicitly in the
 * future schema rather than inferred from null.
 */
export async function verifyAuthorizationScopeCoverage(input: {
  companyId: string
  customerId: string
  required: AuthorizationCoverageRequirement[]
  powerOfAttorneyId?: string | null
  healFromPowerOfAttorney?: boolean
  actorUserId?: string | null
  siteId?: string | null
}): Promise<AuthorizationScopeCoverageResult> {
  async function loadMissing(): Promise<{
    missing: AuthorizationCoverageRequirement[]
    schemaAvailable: boolean
  }> {
    let authorizedDocumentIds: string[] | null = null
    if (input.siteId) {
      const exact = await exactSiteAuthorizationDocumentIds({
        companyId: input.companyId,
        customerId: input.customerId,
        siteId: input.siteId,
        powerOfAttorneyId: input.powerOfAttorneyId ?? null,
      })
      if (!exact.schemaAvailable) return { missing: [...input.required], schemaAvailable: false }
      authorizedDocumentIds = exact.ids
      if (authorizedDocumentIds.length === 0) {
        return { missing: [...input.required], schemaAvailable: true }
      }
    }

    let query = supabaseService
      .from('authorization_scopes')
      .select('id,status,revoked_at,valid_to,covers_grid_owner_data,covers_current_supplier_contract,covers_metering_data,authorization_document_id')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('status', 'active')
      .is('revoked_at', null)
    if (authorizedDocumentIds) query = query.in('authorization_document_id', authorizedDocumentIds)
    const { data, error } = await query
    if (error) {
      if (missingSchema(error)) return { missing: [...input.required], schemaAvailable: false }
      throw error
    }
    const activeScopes = ((data ?? []) as Record<string, unknown>[]).filter(
      (row) => !isDateBeforeToday(row.valid_to),
    )
    const missing = input.required.filter(
      (requirement) => !activeScopes.some((row) => row[COVERAGE_COLUMN[requirement]] === true),
    )
    return { missing, schemaAvailable: true }
  }

  const first = await loadMissing()
  if (first.missing.length === 0) {
    return { covered: true, missing: [], healed: false, schemaAvailable: first.schemaAvailable }
  }

  if (input.healFromPowerOfAttorney && input.powerOfAttorneyId && first.schemaAvailable) {
    if (input.siteId) {
      const exactPoa = await powerOfAttorneyMatchesSite({
        companyId: input.companyId,
        customerId: input.customerId,
        powerOfAttorneyId: input.powerOfAttorneyId,
        siteId: input.siteId,
      })
      if (!exactPoa) {
        return {
          covered: false,
          missing: first.missing,
          healed: false,
          schemaAvailable: true,
        }
      }
    }

    const signed = await getSignedPowerOfAttorneyCoverage({
      companyId: input.companyId,
      customerId: input.customerId,
      powerOfAttorneyId: input.powerOfAttorneyId,
    })
    if (!signed) {
      return {
        covered: false,
        missing: first.missing,
        healed: false,
        schemaAvailable: first.schemaAvailable,
      }
    }
    await ensureAuthorizationDocumentFromPowerOfAttorney({
      companyId: input.companyId,
      customerId: input.customerId,
      powerOfAttorneyId: input.powerOfAttorneyId,
      actorUserId: input.actorUserId ?? null,
      siteId: input.siteId ?? null,
      source: 'authorization_scope_coverage_heal',
      coverage: signed.coverage,
      signedScopes: signed.signedScopes,
      metadata: { signedScopes: signed.signedScopes, customer_site_id: input.siteId ?? null },
    })
    const second = await loadMissing()
    return {
      covered: second.missing.length === 0,
      missing: second.missing,
      healed: second.missing.length < first.missing.length,
      schemaAvailable: second.schemaAvailable,
    }
  }

  return {
    covered: false,
    missing: first.missing,
    healed: false,
    schemaAvailable: first.schemaAvailable,
  }
}