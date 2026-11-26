import 'server-only'

import { supabaseService } from '@/lib/supabase/service'
import { buildAdminDataChain, buildPortalCustomerStatus, type PortalCustomerStatus } from './status'

type Scope = { companyId: string | null; customerIds: readonly string[] }
type StatusInput = Parameters<typeof buildPortalCustomerStatus>[0]
type FullmaktState = 'effective' | 'signed_unverified' | 'unverified'
type Basis = { ready: boolean; fullmakt: FullmaktState }

const unverified: Basis = { ready: false, fullmakt: 'unverified' }

function parseBasis(data: unknown): Basis | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const { ready, fullmakt } = data as Partial<Basis>
  if (typeof ready !== 'boolean' ||
      (fullmakt !== 'effective' && fullmakt !== 'signed_unverified' && fullmakt !== 'unverified') ||
      (ready && fullmakt !== 'effective')) return null
  return { ready, fullmakt }
}

async function observeBasis({ companyId, customerIds }: Scope): Promise<Basis> {
  if (!companyId || customerIds.length === 0) return unverified
  // The service-only RPC authenticates the evidence. Callers supply the already
  // authorised portal account/tenant or the staff card's verified customer.
  const rpc = supabaseService.rpc.bind(supabaseService) as unknown as (
    name: 'gridex_read_supplier_switch_status_basis_v1',
    args: { p_company_id: string; p_customer_ids: readonly string[] }
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  try {
    const { data, error } = await rpc('gridex_read_supplier_switch_status_basis_v1', {
      p_company_id: companyId,
      p_customer_ids: customerIds,
    })
    if (!error) {
      const basis = parseBasis(data)
      if (basis) return basis
    }
    if (error?.message !== 'portal_customer_retention_access_revoked' &&
        error?.message !== 'customer_record_customer_scope_required') {
      console.warn('[supplier-switch-status] readiness read unavailable', {
        reason: error?.code === 'PGRST202' ? 'schema_unavailable' : 'read_unavailable',
      })
    }
  } catch {
    console.warn('[supplier-switch-status] readiness read unavailable', { reason: 'transport_failure' })
  }
  return unverified
}

function applyBasis(status: PortalCustomerStatus, basis: Basis): PortalCustomerStatus {
  if (basis.ready) {
    return {
      ...status,
      message: 'Underlaget för leverantörsbytet är verifierat för avtalet.',
      issues: [],
      supplier_switch: { can_create_request: true, can_dispatch: true, blockers: [], next_action: 'dispatch_request' },
      can_start_switch: true,
    }
  }
  return {
    ...status,
    code: 'needs_review',
    label: 'Behöver granskas',
    severity: 'warning',
    message: 'Underlaget för leverantörsbytet behöver kontrolleras för rätt avtal och anläggning.',
    supplier_switch: {
      ...status.supplier_switch,
      can_create_request: false,
      can_dispatch: false,
      next_action: 'complete_application',
    },
    can_start_switch: false,
  }
}

export async function readPortalCustomerStatus(scope: Scope, input: StatusInput): Promise<PortalCustomerStatus> {
  const status = buildPortalCustomerStatus(input)
  return status.code === 'pending_supplier_switch' ? applyBasis(status, await observeBasis(scope)) : status
}

export async function readAdminCustomerDataChain(scope: Scope, input: StatusInput) {
  const chain = buildAdminDataChain(input)
  const pending = chain.status.code === 'pending_supplier_switch'
  const basis = pending ? await observeBasis(scope) : unverified
  const detail = basis.fullmakt === 'effective' ? 'Giltig för leverantörsbyte'
    : basis.fullmakt === 'signed_unverified' ? 'Signerad. Giltigheten för leverantörsbyte behöver kontrolleras.'
    : 'Fullmaktens giltighet för leverantörsbyte behöver kontrolleras.'
  return {
    status: pending ? applyBasis(chain.status, basis) : chain.status,
    rows: chain.rows.map(row => row.label === 'Fullmakt'
      ? { ...row, ok: basis.fullmakt === 'effective', detail } : row),
  }
}
