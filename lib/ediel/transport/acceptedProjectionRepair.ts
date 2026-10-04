import { createHash } from 'node:crypto'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { readAcceptedEdielTransportProjection, repairAcceptedEdielTransportProjection, type AcceptedEdielTransportProjection } from './acceptedProjection'

/** Repair consumes the private journal again under its database lock. The
 * supplied receipt and mutable message row never authorize provider entry. */
export async function repairAcceptedEdielMessageProjection(input: {
  message: EdielMessageRow
  actorUserId: string
  projection: AcceptedEdielTransportProjection
}): Promise<AcceptedEdielTransportProjection> {
  const { message, projection } = input
  if (!message.company_id || message.direction !== 'outbound' || message.company_id !== projection.companyId
    || message.environment !== projection.environment || message.id !== projection.messageId
    || !message.raw_payload || createHash('sha256').update(message.raw_payload,'utf8').digest('hex') !== projection.originalHash) {
    throw new Error('ediel_accepted_projection_original_changed')
  }
  const repaired = await repairAcceptedEdielTransportProjection({ companyId: message.company_id,
    environment: message.environment, actorUserId: input.actorUserId, messageId: message.id })
  if (!repaired || repaired.originalHash !== projection.originalHash || repaired.attemptId !== projection.attemptId
    || Date.parse(repaired.observedAt) !== Date.parse(projection.observedAt)) throw new Error('ediel_accepted_projection_receipt_changed')
  return repaired
}

/** The provider result is only a selector for the private journal. Native
 * repair locks the message and all owned source projections in one transaction. */
export async function repairObservedEdielSmtpProjection(input: {
  message: EdielMessageRow
  actorUserId: string
  observedAt: string
  smtpMessageId: string | null
}): Promise<AcceptedEdielTransportProjection> {
  const { message } = input
  if (!message.company_id || !Number.isFinite(Date.parse(input.observedAt))) throw new Error('ediel_transport_observation_clock_required')
  const projection = await readAcceptedEdielTransportProjection({ companyId: message.company_id,
    environment: message.environment, actorUserId: input.actorUserId, messageId: message.id })
  if (!projection || Date.parse(projection.observedAt) !== Date.parse(input.observedAt)
    || projection.providerReceipt.messageId !== input.smtpMessageId) throw new Error('ediel_accepted_projection_receipt_changed')
  return repairAcceptedEdielMessageProjection({ message, actorUserId: input.actorUserId, projection })
}
