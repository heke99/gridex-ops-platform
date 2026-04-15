import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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

  const [customerResponse, suppliersResponse] = await Promise.all([
    supabase
      .from('customers')
      .select('id, customer_type, first_name, last_name, company_name, org_number, personal_number')
      .eq('id', customerId)
      .maybeSingle(),
    supabase
      .from('electricity_suppliers')
      .select('id, name, org_number, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true }),
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

  return NextResponse.json({
    customer: customerResponse.data,
    suppliers: suppliersResponse.data ?? [],
  })
}