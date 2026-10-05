import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { internalApiError } from '@/lib/http/apiError'
import {
  apiErrorResponse,
  requireAdminApiAccess,
} from '@/lib/admin/apiGuards'
import {
  resolveOwnElectricitySupplier,
  type OwnElectricitySupplierResolution,
} from '@/lib/masterdata/selfSupplier'
import { loadCustomerTenantContext } from '@/lib/tenant/entityGuards'

export const dynamic = 'force-dynamic'

type SupplierOption = {
  id: string
  name: string
  org_number: string | null
  is_active: boolean
  is_own_supplier: boolean
}

type OwnSupplierOption = SupplierOption | null

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId')

  if (!customerId) {
    return NextResponse.json(
      { error: 'customerId saknas' },
      { status: 400 }
    )
  }

  const access = await requireAdminApiAccess(['customers.read', 'switching.read'])
  if (access.response) return access.response

  let companyId: string
  try {
    const tenant = await loadCustomerTenantContext(customerId, access.guard)
    companyId = tenant.companyId
  } catch (error) {
    return apiErrorResponse(error, 403)
  }

  const supabase = await createSupabaseServerClient()

  const [customerResponse, suppliersResponse, ownSupplierLookup] = await Promise.all([
    supabase
      .from('customers')
      .select(
        'id, customer_type, first_name, last_name, company_name, org_number, personal_number'
      )
      .eq('id', customerId)
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase
      .from('electricity_suppliers')
      .select('id, name, org_number, is_active, is_own_supplier')
      .eq('is_active', true)
      // shared counterparty registry plus this tenant's own records; never another
      // tenant's supplier rows
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .order('is_own_supplier', { ascending: false })
      .order('name', { ascending: true })
      .limit(250),
    resolveOwnElectricitySupplier(supabase, companyId),
  ])

  if (customerResponse.error) {
    return internalApiError({ context: 'customer-switch-form-options-customer', error: customerResponse.error, code: 'customer_switch_form_options_failed', message: 'Kunduppgifter kunde inte hämtas.' })
  }

  if (suppliersResponse.error) {
    return internalApiError({ context: 'customer-switch-form-options-suppliers', error: suppliersResponse.error, code: 'customer_switch_form_options_failed', message: 'Leverantörsalternativ kunde inte hämtas.' })
  }

  const ownSupplier: OwnSupplierOption = ownSupplierLookup.supplier
    ? {
        id: ownSupplierLookup.supplier.id,
        name: ownSupplierLookup.supplier.name,
        org_number: ownSupplierLookup.supplier.org_number,
        is_active: ownSupplierLookup.supplier.is_active,
        is_own_supplier: ownSupplierLookup.supplier.is_own_supplier,
      }
    : null

  return NextResponse.json({
    customer: customerResponse.data,
    suppliers: (suppliersResponse.data ?? []) as SupplierOption[],
    ownSupplier,
    ownSupplierResolution:
      ownSupplierLookup.resolution as OwnElectricitySupplierResolution,
  })
}