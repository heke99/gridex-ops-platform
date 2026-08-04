import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { customerPortalJson } from '@/lib/customer-portal/externalApi'
import { deriveEnergyResolutionReadiness } from '@/lib/energy/resolutionBinding'
import { resolveEnergyContext } from '@/lib/energy/resolver'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'
import {
  logIntegrationApiRequest,
  requireIntegrationApiAccess,
} from '@/lib/integrations/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function text(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const auth = await requireIntegrationApiAccess(request, ['website_energy_area.resolve'])
  if (!auth.ok) {
    await logIntegrationApiRequest({ client: auth.client ?? null, request, statusCode: auth.status, startedAt, errorCode: auth.errorCode })
    return customerPortalJson({ error: { code: auth.errorCode, message: auth.error, request_id: requestId, correlation_id: requestId, retryable: false }, error_code: auth.errorCode, correlation_id: requestId, retryable: false }, { status: auth.status })
  }

  try {
    const parsed = await readJsonWithLimit(request)
    if (!parsed.ok) {
      const status = parsed.code === 'payload_too_large' ? 413 : 400
      return customerPortalJson({ error: { code: parsed.code, message: status === 413 ? 'Förfrågans innehåll är för stort.' : 'Ogiltig JSON i förfrågan.', request_id: requestId, correlation_id: requestId, retryable: false }, error_code: parsed.code, correlation_id: requestId, retryable: false }, { status })
    }
    const body = (parsed.body ?? {}) as Record<string, unknown>
    const allowedFields = new Set([
      'street',
      'street_number',
      'postal_code',
      'city',
      'country',
      'grid_area_code',
      'facility_id',
      'metering_point_id',
      'requested_start_mode',
      'requested_start_date',
    ])
    const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key))
    if (unknownFields.length > 0) {
      return customerPortalJson({
        error: {
          code: 'unknown_field',
          message: 'Förfrågan innehåller fält som inte ingår i API-kontraktet.',
          field: unknownFields[0],
          request_id: requestId,
          correlation_id: requestId,
          retryable: false,
          details: { unknown_fields: unknownFields },
        },
        request_id: requestId,
        correlation_id: requestId,
      }, { status: 400 })
    }
    const hasLookupInput = Boolean(
      text(body, 'metering_point_id') ||
      text(body, 'facility_id') ||
      text(body, 'grid_area_code') ||
      text(body, 'postal_code') ||
      (text(body, 'street') && text(body, 'city')),
    )
    if (!hasLookupInput) {
      return customerPortalJson({
        error: {
          code: 'invalid_request',
          message: 'Ange mätpunkt, anläggnings-ID, nätområde, fullständig adress eller postnummer.',
          field: null,
          request_id: requestId,
          correlation_id: requestId,
          retryable: false,
        },
        request_id: requestId,
        correlation_id: requestId,
      }, { status: 400 })
    }
    const resolution = await resolveEnergyContext({
      companyId: auth.context.companyId,
      street: text(body, 'street'),
      streetNumber: text(body, 'street_number'),
      postalCode: text(body, 'postal_code'),
      city: text(body, 'city'),
      country: text(body, 'country') ?? 'SE',
      gridAreaCode: text(body, 'grid_area_code'),
      facilityId: text(body, 'facility_id'),
      meteringPointId: text(body, 'metering_point_id'),
      requestedStartMode: text(body, 'requested_start_mode'),
      requestedStartDate: text(body, 'requested_start_date'),
      metadata: { source: 'website_energy_area_api', api_client_id: auth.client.id },
    })
    const readiness = deriveEnergyResolutionReadiness({
      priceArea: resolution.priceArea,
      gridAreaCode: resolution.gridAreaCode,
      gridOwnerId: resolution.gridOwnerId,
      resolutionStatus: resolution.resolutionStatus,
      confidence: resolution.confidence,
      priceAreaAssuranceStatus: resolution.priceAreaAssurance.status,
      priceAreaAssuranceSource: resolution.priceAreaAssurance.source,
      priceAreaAssuranceConfidence: resolution.priceAreaAssurance.confidence,
      priceAreaAssuranceSourceVersion: resolution.priceAreaAssurance.sourceVersion,
      priceAreaCandidateCount: resolution.priceAreaAssurance.candidateCount,
      priceAreaUniqueCount: resolution.priceAreaAssurance.uniquePriceAreaCount,
      priceAreaEvidence: resolution.priceAreaAssurance.evidence,
      conflictCode: resolution.conflictCode,
      expiresAt: resolution.expiresAt,
    })

    const status = resolution.resolutionStatus === 'failed'
      ? 422
      : resolution.resolutionStatus === 'needs_review'
        ? 409
        : 200
    await logIntegrationApiRequest({
      client: auth.client,
      request,
      statusCode: status,
      startedAt,
      errorCode: status === 200 ? null : (resolution.conflictCode ?? (resolution.resolutionStatus === 'needs_review' ? 'energy_area_needs_review' : 'energy_area_resolution_failed')),
      metadata: {
        request_id: requestId,
        resolution_id: resolution.resolutionId ?? null,
        resolution_status: resolution.resolutionStatus,
        price_area: resolution.priceArea,
      },
    })
    return customerPortalJson(
      {
        data: {
          resolution_id: resolution.resolutionId ?? null,
          price_area: resolution.priceArea,
          grid_area_code: resolution.gridAreaCode,
          grid_area_name: resolution.gridAreaName,
          grid_owner_name: resolution.gridOwnerName,
          resolution_status: resolution.resolutionStatus,
          confidence: resolution.confidence,
          price_area_assurance: {
            status: resolution.priceAreaAssurance.status,
            price_area: resolution.priceAreaAssurance.priceArea,
            confidence: resolution.priceAreaAssurance.confidence,
            source: resolution.priceAreaAssurance.source,
            candidate_count: resolution.priceAreaAssurance.candidateCount,
            unique_price_area_count: resolution.priceAreaAssurance.uniquePriceAreaCount,
            source_version: resolution.priceAreaAssurance.sourceVersion,
            evidence: resolution.priceAreaAssurance.evidence,
          },
          next_required_action: resolution.nextRequiredAction,
          resolved_at: resolution.resolvedAt ?? null,
          expires_at: resolution.expiresAt ?? null,
          resolver_version: resolution.resolverVersion ?? null,
          geodata_version: resolution.geodataVersion ?? null,
          source: {
            chain: resolution.sourceChain,
            resolver_version: resolution.resolverVersion ?? null,
            geodata_version: resolution.geodataVersion ?? null,
          },
          capabilities: readiness.capabilities,
          blockers: readiness.blockers,
          conflict_code: resolution.conflictCode ?? null,
          error_code: resolution.conflictCode ?? (resolution.resolutionStatus === 'needs_review' ? 'energy_area_needs_review' : null),
          retryable: false,
          warnings: resolution.warnings,
        },
        request_id: requestId,
        correlation_id: requestId,
        retryable: false,
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[website-energy-area-resolve] failed', { requestId, error })
    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 500, startedAt, errorCode: 'energy_area_resolution_failed', metadata: { request_id: requestId } })
    return customerPortalJson({ error: { code: 'energy_area_resolution_failed', message: 'Elområdet kunde inte lösas just nu.', request_id: requestId, correlation_id: requestId, retryable: true }, error_code: 'energy_area_resolution_failed', correlation_id: requestId, retryable: true }, { status: 500 })
  }
}
