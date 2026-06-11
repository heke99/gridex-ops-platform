import { NextResponse } from 'next/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { resolveEnergyContext } from '@/lib/energy/resolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    await requirePlatformAdminActionAccess()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const result = await resolveEnergyContext({
      companyId: typeof body.company_id === 'string' ? body.company_id : typeof body.companyId === 'string' ? body.companyId : null,
      customerId: typeof body.customer_id === 'string' ? body.customer_id : typeof body.customerId === 'string' ? body.customerId : null,
      customerSiteId: typeof body.customer_site_id === 'string' ? body.customer_site_id : typeof body.customerSiteId === 'string' ? body.customerSiteId : null,
      customerApplicationId: typeof body.customer_application_id === 'string' ? body.customer_application_id : typeof body.customerApplicationId === 'string' ? body.customerApplicationId : null,
      street: typeof body.street === 'string' ? body.street : typeof body.address === 'string' ? body.address : null,
      streetNumber: typeof body.street_number === 'string' ? body.street_number : typeof body.streetNumber === 'string' ? body.streetNumber : null,
      postalCode: typeof body.postal_code === 'string' ? body.postal_code : typeof body.postalCode === 'string' ? body.postalCode : null,
      city: typeof body.city === 'string' ? body.city : null,
      country: typeof body.country === 'string' ? body.country : 'SE',
      gridAreaCode: typeof body.grid_area_code === 'string' ? body.grid_area_code : typeof body.gridAreaCode === 'string' ? body.gridAreaCode : null,
      facilityId: typeof body.facility_id === 'string' ? body.facility_id : typeof body.facilityId === 'string' ? body.facilityId : null,
      meteringPointId: typeof body.metering_point_id === 'string' ? body.metering_point_id : typeof body.meteringPointId === 'string' ? body.meteringPointId : null,
      requestedStartMode: typeof body.requested_start_mode === 'string' ? body.requested_start_mode : typeof body.requestedStartMode === 'string' ? body.requestedStartMode : null,
      requestedStartDate: typeof body.requested_start_date === 'string' ? body.requested_start_date : typeof body.requestedStartDate === 'string' ? body.requestedStartDate : null,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : {},
    })
    return NextResponse.json({ ok: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Energy Resolver misslyckades.'
    return NextResponse.json({ ok: false, error: message }, { status: /admin|forbidden|unauthorized/i.test(message) ? 403 : 500 })
  }
}
