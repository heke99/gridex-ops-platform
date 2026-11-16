import { findActiveGridOwnerAccessAgreement, type GridOwnerAccessAgreementRow } from '@/lib/routes/gridOwnerAgreements'
import type { RouteScope } from '@/lib/routes/routeDecisionTypes'

export type AgreementReferenceDecision = {
  status: 'resolved' | 'missing' | 'ambiguous' | 'not_required'
  agreement: GridOwnerAccessAgreementRow | null
  agreementReference: string | null
  applicationReference: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
  preferredRouteId: string | null
  preferredMessageVersion: string | null
  referenceRequirements: Record<string, unknown>
  reasons: string[]
}

export async function resolveGridOwnerAgreementReference(params: {
  companyId?: string | null
  gridOwnerId?: string | null
  routeScope: RouteScope | string
  requireActiveAgreement?: boolean
}): Promise<AgreementReferenceDecision> {
  if (!params.requireActiveAgreement) {
    return {
      status: 'not_required',
      agreement: null,
      agreementReference: null,
      applicationReference: null,
      receiverEdielId: null,
      receiverSubAddress: null,
      preferredRouteId: null,
      preferredMessageVersion: null,
      referenceRequirements: {},
      reasons: ['Aktivt nätägaravtal krävs inte för denna process.'],
    }
  }

  if (!params.companyId || !params.gridOwnerId) {
    return {
      status: 'missing',
      agreement: null,
      agreementReference: null,
      applicationReference: null,
      receiverEdielId: null,
      receiverSubAddress: null,
      preferredRouteId: null,
      preferredMessageVersion: null,
      referenceRequirements: {},
      reasons: ['company_id och grid_owner_id krävs för att hitta aktivt nätägaravtal.'],
    }
  }

  const result = await findActiveGridOwnerAccessAgreement({
    companyId: params.companyId,
    gridOwnerId: params.gridOwnerId,
    agreementScope: params.routeScope,
  })

  if (result.status === 'none') {
    return {
      status: 'missing',
      agreement: null,
      agreementReference: null,
      applicationReference: null,
      receiverEdielId: null,
      receiverSubAddress: null,
      preferredRouteId: null,
      preferredMessageVersion: null,
      referenceRequirements: {},
      reasons: [`Inget aktivt nätägaravtal hittades för ${params.routeScope}.`],
    }
  }

  if (result.status === 'multiple') {
    return {
      status: 'ambiguous',
      agreement: null,
      agreementReference: null,
      applicationReference: null,
      receiverEdielId: null,
      receiverSubAddress: null,
      preferredRouteId: null,
      preferredMessageVersion: null,
      referenceRequirements: {},
      reasons: [`Flera aktiva nätägaravtal matchar ${params.routeScope}. Systemet blockerar hellre än gissar.`],
    }
  }

  const agreement = result.agreement

  return {
    status: 'resolved',
    agreement,
    agreementReference: agreement?.agreement_reference ?? null,
    applicationReference: agreement?.preferred_application_reference ?? null,
    receiverEdielId: agreement?.preferred_receiver_ediel_id ?? null,
    receiverSubAddress: agreement?.preferred_receiver_sub_address ?? null,
    preferredRouteId: agreement?.preferred_route_id ?? null,
    preferredMessageVersion: agreement?.preferred_message_version ?? null,
    referenceRequirements: agreement?.reference_requirements ?? {},
    reasons: agreement ? [`Aktivt nätägaravtal ${agreement.agreement_reference ?? agreement.id} hittades.`] : [],
  }
}
