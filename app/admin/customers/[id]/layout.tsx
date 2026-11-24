import Link from 'next/link'
import CustomerActionsMenu from '@/components/admin/customers/CustomerActionsMenu'
import type { ReactNode } from 'react'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { CUSTOMER_DETAIL_LAYOUT_READ } from '@/lib/admin/accessModel'
import { canPresentAdminAction, canPresentAdminLink } from '@/lib/admin/actionPresentation'
import { supabaseService } from '@/lib/supabase/service'
import { notFound } from 'next/navigation'
import { guardIsPlatformAdmin, loadCustomerTenantContext } from '@/lib/tenant/entityGuards'
import { resolveCustomerCardLookup } from './customer-lookup-outcome'
import { isUuid } from '@/lib/validation/uuid'
import { canSendSignatureForCompany } from '@/lib/tenant/governance'
import { SEND_CONTRACT_SIGNATURE_REQUIREMENT } from './contracts/[contractId]/signature/policy'

export const dynamic = 'force-dynamic'

export default async function CustomerWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: customerId } = await params
  const access = await requireAdminPageAccess(CUSTOMER_DETAIL_LAYOUT_READ)
  // A missing id, a customer without company link and another tenant's customer all end
  // in the same 404 before the tenant guard, whose error texts differ (finding 003).
  // A malformed id would fail in Postgres (22P02) instead of answering like a missing id.
  if (!isUuid(customerId)) notFound()
  const { data: lookupRow, error: lookupError } = await supabaseService
    .from('customers')
    .select('company_id, source')
    .eq('id', customerId)
    .maybeSingle()
  if (lookupError) throw lookupError
  const lookup = resolveCustomerCardLookup(
    { isPlatformAdmin: guardIsPlatformAdmin(access), companyId: access.companyId ?? null },
    lookupRow as { company_id: string | null; source: string | null } | null,
  )
  if (lookup.kind === 'not_found') notFound()
  // The page handles accounts without a company and Ediel control customers.
  if (lookup.kind !== 'ok') return <>{children}</>
  const { companyId } = await loadCustomerTenantContext(customerId, access)
  if (
    !canPresentAdminLink(access, SEND_CONTRACT_SIGNATURE_REQUIREMENT)
    || !await canPresentAdminAction(SEND_CONTRACT_SIGNATURE_REQUIREMENT)
    || !await canSendSignatureForCompany(companyId)
  ) return <>{children}</>

  const { data: signableContracts, error } = await supabaseService
    .from('customer_contracts')
    .select('id,contract_name,contract_number,status,signed_at')
    .eq('company_id', companyId)
    .eq('customer_id', customerId)
    .in('status', ['draft', 'pending_signature', 'signature_failed'])
    .is('signed_at', null)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error

  return (
    <>
      {(signableContracts ?? []).length > 0 ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-3">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-emerald-950">Online-signering:</span>
            <CustomerActionsMenu label={`Signera avtal (${signableContracts!.length})`}>
            {signableContracts!.map((contract) => (
              <Link
                key={contract.id}
                href={`/admin/customers/${customerId}/contracts/${contract.id}/signature`}
                className="rounded-full border border-emerald-300 bg-white px-3 py-1.5 font-medium text-emerald-900 hover:bg-emerald-100"
              >
                {contract.status === 'pending_signature' ? 'Skicka ny länk' : 'Skicka länk'} · {contract.contract_name}
                {contract.contract_number ? ` (${contract.contract_number})` : ''}
              </Link>
            ))}
            </CustomerActionsMenu>
          </div>
        </div>
      ) : null}
      {children}
    </>
  )
}
