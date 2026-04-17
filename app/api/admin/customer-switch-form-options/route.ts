import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  resolveOwnElectricitySupplier,
  type OwnElectricitySupplierResolution,
} from '@/lib/masterdata/selfSupplier'

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

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
  }

  const [customerResponse, suppliersResponse, ownSupplierLookup] = await Promise.all([
    supabase
      .from('customers')
      .select(
        'id, customer_type, first_name, last_name, company_name, org_number, personal_number'
      )
      .eq('id', customerId)
      .maybeSingle(),
    supabase
      .from('electricity_suppliers')
      .select('id, name, org_number, is_active, is_own_supplier')
      .eq('is_active', true)
      .order('is_own_supplier', { ascending: false })
      .order('name', { ascending: true }),
    resolveOwnElectricitySupplier(supabase),
  ])

  if (customerResponse.error) {
    return NextResponse.json(
      { error: customerResponse.error.message },
      { status: 500 }
    )
  }

  if (suppliersResponse.error) {
    return NextResponse.json(
      { error: suppliersResponse.error.message },
      { status: 500 }
    )
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