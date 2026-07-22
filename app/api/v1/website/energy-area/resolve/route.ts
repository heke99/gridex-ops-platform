import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import { logIntegrationApiRequest, requireIntegrationApiAccess } from '@/lib/integrations/apiAuth'
import { loadExternalTenantContext } from '@/lib/integrations/tenantContext'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_energy_area.resolve'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId } }, { status: auth.status })
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      return customerPortalJson(
        { error: { code: parsed.code, message: 'Ogiltig eller för stor JSON-payload.', request_id: requestId } },
        { status: parsed.code === 'payload_too_large' ? 413 : 400 },
      )
    }
    const body = (parsed.body ?? {}) as Record<string, unknown>
    const postalCode = optionalText(body.postal_code)
    const gridAreaCode = optionalText(body.grid_area_code)
    const street = optionalText(body.street)
    const city = optionalText(body.city)
    if (!postalCode && !gridAreaCode && !(street && city)) {
      return customerPortalJson(
        {
          error: {
            code: 'energy_area_input_invalid',
            message: 'Skicka grid_area_code, postal_code eller full adress med street och city.',
            request_id: requestId,
          },
        },
        { status: 400 },
      )
    }

    const [resolution, tenant] = await Promise.all([
      resolveEnergyContext({
        companyId: auth.client.company_id,
        street,
        streetNumber: optionalText(body.street_number),
        postalCode,
        city,
        country: optionalText(body.country) ?? 'SE',
        gridAreaCode,
        facilityId: optionalText(body.facility_id),
        meteringPointId: optionalText(body.metering_point_id),
        metadata: { source: 'website_energy_area_api', api_client_id: auth.client.id, request_id: requestId },
      }),
      loadExternalTenantContext(auth.client),
    ])

    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: 200,
      startedAt,
      metadata: {
        request_id: requestId,
        resolution_status: resolution.resolutionStatus,
        price_area: resolution.priceArea,
        grid_area_code: resolution.gridAreaCode,
      },
    })

    return customerPortalJson(
      {
        data: {
          grid_area_code: resolution.gridAreaCode,
          grid_area_name: resolution.gridAreaName,
          grid_owner_name: resolution.gridOwnerName,
          price_area: resolution.priceArea,
          resolution_status: resolution.resolutionStatus,
          confidence: resolution.confidence,
          source_chain: resolution.sourceChain,
          automation_allowed: resolution.automationAllowed,
          next_required_action: resolution.nextRequiredAction,
          warnings: resolution.warnings,
          diagnostics: resolution.diagnostics ?? null,
        },
        meta: { tenant_reference: tenant.tenant_reference, api_version: 'v1', channel: 'website' },
        request_id: requestId,
      },
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('[website-energy-area-resolve] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'energy_area_resolution_unavailable' })
    return customerPortalJson(
      { error: { code: 'energy_area_resolution_unavailable', message: 'Elområdesresolutionen kunde inte genomföras.', request_id: requestId } },
      { status: 500 },
    )
  }
}
