import Link from 'next/link'
import type { ReactNode } from 'react'
import { requireAdminPageAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { loadCustomerTenantContext } from '@/lib/tenant/entityGuards'

export const dynamic = 'force-dynamic'

export default async function CustomerWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ id: string }>
}) {
  const { id: customerId } = await params
  const access = await requireAdminPageAccess({ anyOf: ['contracts.write', 'contracts.read', 'customers.read'] })
  const { companyId } = await loadCustomerTenantContext(customerId, access)

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
          </div>
        </div>
      ) : null}
      {children}
    </>
  )
}
