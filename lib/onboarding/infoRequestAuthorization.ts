import {supabaseService} from '@/lib/supabase/service'
import {powerOfAttorneyCoverageFromScopes} from '@/lib/operations/powerOfAttorneyWorkflow'
import type {AuthorizationScopeRow, CustomerInfoRequestRow} from './infoRequests'

type Row = Record<string, unknown>
type ScopeRequest = Pick<CustomerInfoRequestRow, 'company_id' | 'customer_id' | 'site_id' | 'metering_point_id'>
type Request = Pick<CustomerInfoRequestRow, 'id' | 'company_id' | 'customer_id' | 'site_id' | 'metering_point_id'
  | 'authorization_document_id' | 'grid_owner_data_request_id' | 'outbound_request_id' | 'ediel_message_id'>
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

function currentDateBounds(row: Row, today: string): boolean {
  for (const key of ['valid_from', 'valid_to', 'valid_until']) {
    const value = row[key]
    if (value === null || value === undefined) continue
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const time = Date.parse(`${value}T00:00:00Z`)
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return false
    if (key === 'valid_from' ? value > today : value < today) return false
  }
  return true
}

function own(row: Row, request: ScopeRequest): boolean {
  return row.company_id === request.company_id && row.customer_id === request.customer_id
}

function matchesPoint(row: Row, request: ScopeRequest): boolean {
  return row.metering_point_id == null || row.metering_point_id === request.metering_point_id
}

function matchesOptionalSite(row: Row, request: ScopeRequest): boolean {
  return ['site_id', 'customer_site_id'].every(key => row[key] == null || row[key] === request.site_id)
}

function matchesContractReferences(references: unknown[], contracts: Row[], request: ScopeRequest): boolean {
  const populated = references.filter(value => value != null)
  if (populated.some(value => typeof value !== 'string') || new Set(populated).size > 1) return false
  return populated.every(id => contracts.some(row => row.id === id && own(row, request)
    && matchesOptionalSite(row, request) && matchesPoint(row, request)))
}

/** Read current public authority without healing a chain or deriving permission
 * from customer identity, contract supply dates, an invoice or caller metadata. */
async function currentInfoRequestScopes(request: ScopeRequest) {
  const today = new Date().toISOString().slice(0, 10)
  let documentQuery = supabaseService.from('customer_authorization_documents')
    .select('id,company_id,customer_id,site_id,metering_point_id,power_of_attorney_id,customer_contract_id,document_type,status')
    .eq('company_id', request.company_id).eq('customer_id', request.customer_id).in('status', ['active', 'signed'])
  documentQuery = request.site_id ? documentQuery.eq('site_id', request.site_id) : documentQuery.is('site_id', null)
  const [scopeResult, documentResult] = await Promise.all([
    supabaseService.from('authorization_scopes').select('*')
      .eq('company_id', request.company_id).eq('customer_id', request.customer_id)
      .eq('status', 'active').is('revoked_at', null).order('created_at', {ascending: false}),
    documentQuery,
  ])
  if (scopeResult.error) throw scopeResult.error
  if (documentResult.error) throw documentResult.error
  const documents = (documentResult.data ?? []).map(value => object(value))
    .filter(row => own(row, request) && row.site_id === request.site_id && matchesPoint(row, request)
      && ['active', 'signed'].includes(String(row.status)) && ['power_of_attorney', 'complete_agreement'].includes(String(row.document_type)))
  const poaIds = [...new Set(documents.map(row => row.power_of_attorney_id).filter((id): id is string => typeof id === 'string'))]
  const poaResult = poaIds.length ? await supabaseService.from('powers_of_attorney')
    .select('id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status,revoked_at,valid_from,valid_to,valid_until,document_id,signed_scope_snapshot,scope_summary,contract_id,customer_contract_id')
    .eq('company_id', request.company_id).eq('customer_id', request.customer_id).in('id', poaIds) : {data: [], error: null}
  if (poaResult.error) throw poaResult.error
  const poas = (poaResult.data ?? []).map(value => object(value))
  const contractIds = [...new Set([...documents.map(row => row.customer_contract_id),
    ...poas.flatMap(row => [row.contract_id, row.customer_contract_id])].filter((id): id is string => typeof id === 'string'))]
  const contractResult = contractIds.length ? await supabaseService.from('customer_contracts')
    .select('id,company_id,customer_id,site_id,customer_site_id,metering_point_id')
    .eq('company_id', request.company_id).eq('customer_id', request.customer_id).in('id', contractIds) : {data: [], error: null}
  if (contractResult.error) throw contractResult.error
  const contracts = (contractResult.data ?? []).map(value => object(value))
  const eligible = new Map<string, ReturnType<typeof powerOfAttorneyCoverageFromScopes> | null>()
  for (const document of documents) {
    if (typeof document.id !== 'string') continue
    const poa = poas.find(row => row.id === document.power_of_attorney_id)
    if (!matchesContractReferences([document.customer_contract_id, poa?.contract_id, poa?.customer_contract_id], contracts, request)) continue
    if (document.power_of_attorney_id == null) {
      if (document.document_type === 'complete_agreement') eligible.set(document.id, null)
      continue
    }
    if (!poa || !own(poa, request) || !['signed', 'accepted', 'active'].includes(String(poa.status).toLowerCase())
      || poa.revoked_at != null || (poa.customer_site_id ?? poa.site_id) !== request.site_id
      || !matchesOptionalSite(poa, request) || !matchesPoint(poa, request)
      || poa.document_id !== document.id || !currentDateBounds(poa, today)) continue
    const hasImmutable = Array.isArray(poa.signed_scope_snapshot) && poa.signed_scope_snapshot.length > 0
    const signedScopes = hasImmutable ? strings(poa.signed_scope_snapshot) : strings(object(poa.scope_summary).scopes)
    if (!signedScopes.length) continue
    eligible.set(document.id, powerOfAttorneyCoverageFromScopes(signedScopes))
  }
  const scopes: AuthorizationScopeRow[] = []
  for (const value of scopeResult.data ?? []) {
    const row = object(value), id = row.authorization_document_id
    if (!own(row, request) || row.status !== 'active' || row.revoked_at != null
      || !currentDateBounds(row, today) || typeof id !== 'string' || !eligible.has(id)) continue
    const coverage = eligible.get(id)
    scopes.push({...value, covers_grid_owner_data: row.covers_grid_owner_data === true && (!coverage || coverage.coversGridOwnerData),
      covers_current_supplier_contract: row.covers_current_supplier_contract === true && (!coverage || coverage.coversCurrentSupplierContract),
      covers_metering_data: row.covers_metering_data === true && (!coverage || coverage.coversMeteringData)} as AuthorizationScopeRow)
  }
  return scopes
}

/** Read current site authority before mutable facility resolution. This unbound
 * check never looks up or manufactures a CIR, GODR or original identity. */
export async function resolveCurrentInfoRequestScopeAuthorization(request: ScopeRequest) {
  const scopes = await currentInfoRequestScopes(request)
  const ordered = [...scopes].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  return {scopes, gridOwnerDocumentId: ordered.find(row => row.covers_grid_owner_data)?.authorization_document_id ?? null,
    supplierDocumentId: scopes.find(row => row.covers_current_supplier_contract)?.authorization_document_id ?? null}
}

/** Bound dispatch also checks the retained original's authority identity. */
export async function resolveCurrentInfoRequestAuthorization(request: Request, options: {gridOwnerRequired: boolean}) {
  const scopes = await currentInfoRequestScopes(request)
  const supplierDocumentId = scopes.find(row => row.covers_current_supplier_contract)?.authorization_document_id ?? null
  // Supplier-only requests use the existing manual branch, without a GODR.
  if (!options.gridOwnerRequired) return {scopes, gridOwnerDocumentId: null, supplierDocumentId}
  // Existing originals retain their own authority identity. A new live grant
  // cannot retroactively relabel an already bound GODR, outbound or original.
  let boundDocumentId = request.authorization_document_id
  let boundQuery = supabaseService.from('grid_owner_data_requests')
      .select('id,company_id,customer_id,site_id,authorization_document_id')
      .eq('company_id', request.company_id).eq('customer_id', request.customer_id)
  boundQuery = request.grid_owner_data_request_id ? boundQuery.eq('id', request.grid_owner_data_request_id)
    : boundQuery.eq('automation_key', `customer-info-request:${request.id}:z01`).in('status', ['pending', 'sent'])
  const existing = await boundQuery.maybeSingle()
  if (existing.error) throw existing.error
  if (request.grid_owner_data_request_id || existing.data) {
    if (!existing.data || !own(object(existing.data), request) || existing.data.site_id !== request.site_id || !existing.data.authorization_document_id
      || (boundDocumentId && boundDocumentId !== existing.data.authorization_document_id)) {
      return {scopes: [], gridOwnerDocumentId: null, supplierDocumentId: null}
    }
    boundDocumentId = existing.data.authorization_document_id
  }
  if ((request.outbound_request_id || request.ediel_message_id) && !existing.data) {
    return {scopes: [], gridOwnerDocumentId: null, supplierDocumentId: null}
  }
  const bound = Boolean(existing.data || request.grid_owner_data_request_id || request.outbound_request_id || request.ediel_message_id)
  const ordered = [...scopes].sort((a, b) => Number(b.authorization_document_id === boundDocumentId)
    - Number(a.authorization_document_id === boundDocumentId) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  const gridOwnerDocumentId = ordered.find(row => row.covers_grid_owner_data && (!bound || row.authorization_document_id === boundDocumentId))?.authorization_document_id ?? null
  return {scopes: bound && !gridOwnerDocumentId ? [] : scopes, gridOwnerDocumentId, supplierDocumentId}
}

/** A public producer may return a prior row through deduplication. Its actual
 * authority and anchors must match before linking or preparing that row. */
export function gridOwnerRequestMatchesAuthorization(row: Row, request: Request, documentId: string | null): boolean {
  return Boolean(documentId) && own(row, request) && row.site_id === request.site_id
    && row.metering_point_id === request.metering_point_id && row.authorization_document_id === documentId
    && object(row.request_payload).authorization_document_id === documentId
}
