import { supabaseService } from '@/lib/supabase/service'
import type { PowerOfAttorneyRow } from '@/lib/operations/types'

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist|could not find/i.test(maybe.message ?? ''))
  )
}

export type PowerOfAttorneyCoverage = {
  coversGridOwnerData: boolean
  coversCurrentSupplierContract: boolean
  coversMeteringData: boolean
}

export function powerOfAttorneyCoverageFromScopes(scopes: readonly string[]): PowerOfAttorneyCoverage {
  const normalized = new Set(scopes.map((scope) => scope.trim().toLowerCase()).filter(Boolean))
  const supplierSwitch = normalized.has('supplier_switch')
  const facilityLookup = normalized.has('facility_information_lookup')
  return {
    coversGridOwnerData:
      normalized.has('grid_owner_data') || facilityLookup || supplierSwitch,
    coversCurrentSupplierContract:
      normalized.has('current_supplier_contract') || supplierSwitch,
    coversMeteringData:
      normalized.has('metering_data') || facilityLookup,
  }
}

export async function getSignedPowerOfAttorneyCoverage(params: {
  companyId: string
  customerId: string
  powerOfAttorneyId: string
}): Promise<{ coverage: PowerOfAttorneyCoverage; signedScopes: string[] } | null> {
  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .select('id,status,scope_summary,signed_scope_snapshot')
    .eq('company_id', params.companyId)
    .eq('customer_id', params.customerId)
    .eq('id', params.powerOfAttorneyId)
    .maybeSingle()
  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }
  if (!data || !['signed', 'accepted', 'active'].includes(String(data.status ?? '').toLowerCase())) return null

  const immutable = Array.isArray(data.signed_scope_snapshot)
    ? data.signed_scope_snapshot.map(String).filter(Boolean)
    : []
  const summary = data.scope_summary as { scopes?: unknown } | null
  const legacy = Array.isArray(summary?.scopes) ? summary.scopes.map(String).filter(Boolean) : []
  const signedScopes = immutable.length > 0 ? immutable : legacy
  if (signedScopes.length === 0) return null
  return { coverage: powerOfAttorneyCoverageFromScopes(signedScopes), signedScopes }
}

export async function getLatestSignedPowerOfAttorneyForCustomer(params: {
  companyId: string
  customerId: string
  siteId?: string | null
}): Promise<PowerOfAttorneyRow | null> {
  const query = supabaseService
    .from('powers_of_attorney')
    .select('*')
    .eq('company_id', params.companyId)
    .eq('customer_id', params.customerId)
    .eq('status', 'signed')
    .order('signed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(25)

  const { data, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  const rows = (data ?? []) as PowerOfAttorneyRow[]
  if (!params.siteId) return rows[0] ?? null

  return rows.find((row) => row.site_id === params.siteId) ?? rows.find((row) => !row.site_id) ?? rows[0] ?? null
}

export async function ensureAuthorizationScopeFromPowerOfAttorney(params: {
  companyId: string
  actorUserId?: string | null
  customerId: string
  powerOfAttorneyId?: string | null
  authorizationDocumentId?: string | null
  coverage: PowerOfAttorneyCoverage
  signedScopes?: string[]
  validFrom?: string | null
  validTo?: string | null
  evidenceNote?: string | null
}): Promise<string | null> {
  try {
    let existingQuery = supabaseService
      .from('authorization_scopes')
      .select('*')
      .eq('company_id', params.companyId)
      .eq('customer_id', params.customerId)
      .eq('status', 'active')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (params.authorizationDocumentId) {
      existingQuery = existingQuery.eq('authorization_document_id', params.authorizationDocumentId)
    } else {
      existingQuery = existingQuery.eq('scope_type', 'supplier_switch_data')
    }

    const { data: existingRows, error: existingError } = await existingQuery
    if (existingError) {
      if (isMissingRelationError(existingError)) return null
      throw existingError
    }

    const existing = (existingRows ?? [])[0] as {
      id: string
      covers_grid_owner_data?: boolean
      covers_current_supplier_contract?: boolean
      covers_metering_data?: boolean
      signed_scope_snapshot?: unknown
      metadata?: Record<string, unknown> | null
    } | undefined
    const requestedSignedScopes = Array.from(
      new Set(
        (params.signedScopes ?? [])
          .map((scope) => scope.trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort()
    const existingSignedScopes = Array.isArray(existing?.signed_scope_snapshot)
      ? Array.from(
          new Set(
            existing.signed_scope_snapshot
              .map(String)
              .map((scope) => scope.trim().toLowerCase())
              .filter(Boolean),
          ),
        ).sort()
      : []
    if (existingSignedScopes.length === 0 && requestedSignedScopes.length === 0) {
      throw new Error('Signerad fullmakt saknar oföränderligt scope-snapshot. Behörighet kan inte skapas eller breddas automatiskt.')
    }
    if (
      existingSignedScopes.length > 0 &&
      requestedSignedScopes.length > 0 &&
      (existingSignedScopes.length !== requestedSignedScopes.length ||
        existingSignedScopes.some(
          (scope, index) => scope !== requestedSignedScopes[index],
        ))
    ) {
      throw new Error('Begärda scopes matchar inte den redan skapade behörighetens signerade scope-snapshot.')
    }
    const immutableScopes = existingSignedScopes.length > 0 ? existingSignedScopes : requestedSignedScopes
    const immutableCoverage = powerOfAttorneyCoverageFromScopes(immutableScopes)
    const requestedCoverage = powerOfAttorneyCoverageFromScopes(requestedSignedScopes)
    if (requestedSignedScopes.length > 0 && (
      requestedCoverage.coversGridOwnerData !== params.coverage.coversGridOwnerData ||
      requestedCoverage.coversCurrentSupplierContract !== params.coverage.coversCurrentSupplierContract ||
      requestedCoverage.coversMeteringData !== params.coverage.coversMeteringData
    )) {
      throw new Error('Begärd fullmaktscoverage matchar inte signerade scopes.')
    }
    const metadata = {
      ...(existing?.metadata ?? {}),
      powerOfAttorneyId: params.powerOfAttorneyId ?? (existing?.metadata?.powerOfAttorneyId as string | undefined) ?? null,
      authorizationDocumentId: params.authorizationDocumentId ?? null,
      updatedFrom: 'power_of_attorney_workflow',
      updatedAt: new Date().toISOString(),
    }

    if (existing?.id) {
      const { error: updateError } = await supabaseService
        .from('authorization_scopes')
        .update({
          covers_grid_owner_data: immutableCoverage.coversGridOwnerData,
          covers_current_supplier_contract: immutableCoverage.coversCurrentSupplierContract,
          covers_metering_data: immutableCoverage.coversMeteringData,
          signed_scope_snapshot: immutableScopes,
          valid_from: params.validFrom ?? null,
          valid_to: params.validTo ?? null,
          evidence_note: params.evidenceNote ?? 'Signerad fullmakt verifierad i kundkortet.',
          metadata,
          updated_by: params.actorUserId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (updateError) throw updateError
      return existing.id
    }

    const { data, error } = await supabaseService
      .from('authorization_scopes')
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        authorization_document_id: params.authorizationDocumentId ?? null,
        scope_type: 'supplier_switch_data',
        status: 'active',
        covers_grid_owner_data: immutableCoverage.coversGridOwnerData,
        covers_current_supplier_contract: immutableCoverage.coversCurrentSupplierContract,
        covers_metering_data: immutableCoverage.coversMeteringData,
        signed_scope_snapshot: immutableScopes,
        valid_from: params.validFrom ?? null,
        valid_to: params.validTo ?? null,
        evidence_note: params.evidenceNote ?? 'Signerad fullmakt verifierad i kundkortet.',
        metadata,
        created_by: params.actorUserId ?? null,
        updated_by: params.actorUserId ?? null,
      })
      .select('id')
      .single()

    if (error) throw error
    return String(data.id)
  } catch (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }
}

export async function resolveCustomerBlockersAfterSignedPowerOfAttorney(params: {
  companyId: string
  actorUserId: string
  customerId: string
  siteId?: string | null
  powerOfAttorneyId?: string | null
  authorizationDocumentId?: string | null
}): Promise<{ resolved: number }> {
  try {
    let query = supabaseService
      .from('customer_blockers')
      .update({
        status: 'resolved',
        resolved_by: params.actorUserId,
        resolved_at: new Date().toISOString(),
        metadata: {
          resolvedBySignedPowerOfAttorney: true,
          powerOfAttorneyId: params.powerOfAttorneyId ?? null,
          authorizationDocumentId: params.authorizationDocumentId ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', params.companyId)
      .eq('customer_id', params.customerId)
      .in('status', ['open', 'pending_review'])
      .in('blocker_type', ['missing_power_of_attorney', 'pending_power_of_attorney', 'missing_authorization'])

    if (params.siteId) {
      query = query.or(`customer_site_id.eq.${params.siteId},customer_site_id.is.null`)
    }

    const { data, error } = await query.select('id')
    if (error) {
      if (isMissingRelationError(error)) return { resolved: 0 }
      throw error
    }

    return { resolved: (data ?? []).length }
  } catch (error) {
    if (isMissingRelationError(error)) return { resolved: 0 }
    throw error
  }
}

export async function createMissingPowerOfAttorneyBlocker(params: {
  companyId: string
  actorUserId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  title?: string
  description?: string
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  try {
    let existingQuery = supabaseService
      .from('customer_blockers')
      .select('id')
      .eq('company_id', params.companyId)
      .eq('customer_id', params.customerId)
      .eq('blocker_type', 'missing_power_of_attorney')
      .in('status', ['open', 'pending_review'])
      .limit(1)

    if (params.siteId) {
      existingQuery = existingQuery.or(`customer_site_id.eq.${params.siteId},customer_site_id.is.null`)
    }

    const { data: existing, error: existingError } = await existingQuery
    if (existingError) {
      if (isMissingRelationError(existingError)) return null
      throw existingError
    }

    const existingId = (existing ?? [])[0]?.id
    if (existingId) return String(existingId)

    const { data, error } = await supabaseService
      .from('customer_blockers')
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        customer_site_id: params.siteId ?? null,
        metering_point_id: params.meteringPointId ?? null,
        blocker_type: 'missing_power_of_attorney',
        severity: 'blocking',
        status: 'open',
        title: params.title ?? 'Saknar signerad fullmakt',
        description:
          params.description ??
          'Kunden är sparad, men uppgiftsbegäran och leverantörsbyte får inte skickas innan signerad fullmakt finns.',
        metadata: params.metadata ?? {},
        created_by: params.actorUserId,
      })
      .select('id')
      .single()

    if (error) throw error
    return String(data.id)
  } catch (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }
}
