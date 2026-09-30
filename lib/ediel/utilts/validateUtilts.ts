import type { EdielMessageRow } from '@/lib/ediel/types'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { runUtiltsRuntimeForMessage, type UtiltsRuntimeResult } from '@/lib/ediel/utiltsEngine'

export function createUtiltsPreviewMessage(params: {
  rawPayload: string
  id: string
  admissionAt?: string | Date
}): EdielMessageRow {
  const admission = params.admissionAt === undefined ? new Date()
    : params.admissionAt instanceof Date ? params.admissionAt : new Date(params.admissionAt)
  if (Number.isNaN(admission.getTime())) throw new Error('ediel_admission_time_invalid')
  const admissionAt = admission.toISOString()
  let messageCode = ''
  try {
    const wire = tokenizeEdifact(params.rawPayload)
    const bgm = wire.segments.find(segment => segment.tag === 'BGM')
    messageCode = bgm ? segmentComposite(bgm, 1, wire.una)[0]?.trim() ?? '' : ''
  } catch (error) {
    // The runtime owns the typed syntax refusal for an undecodable source.
    if (!(error instanceof Error) || error.message !== 'edifact_dangling_release_character') throw error
  }
  return {
    id: params.id,
    direction: 'inbound',
    message_standard: 'edifact',
    message_family: 'UTILTS',
    message_code: messageCode,
    message_version: null,
    process_type: null,
    environment: 'test',
    test_flag: 1,
    status: 'received',
    transport_type: 'manual_upload',
    mailbox: null,
    mailbox_message_id: null,
    sender_ediel_id: null,
    sender_name: null,
    sender_sub_address: null,
    receiver_ediel_id: null,
    receiver_name: null,
    receiver_sub_address: null,
    sender_email: null,
    receiver_email: null,
    subject: null,
    file_name: null,
    mime_type: null,
    interchange_reference: null,
    external_reference: null,
    correlation_reference: null,
    transaction_reference: null,
    application_reference: null,
    original_message_id: null,
    original_transaction_id: null,
    original_message_code: null,
    related_message_id: null,
    communication_route_id: null,
    outbound_request_id: null,
    switch_request_id: null,
    grid_owner_data_request_id: null,
    partner_export_id: null,
    customer_id: null,
    site_id: null,
    metering_point_id: null,
    grid_owner_id: null,
    raw_payload: params.rawPayload,
    parsed_payload: {},
    validation_report: {},
    requires_contrl: true,
    requires_aperak: true,
    contrl_status: 'pending',
    aperak_status: 'pending',
    utilts_err_status: 'not_required',
    ack_outcome: null,
    syntax_check_status: 'not_checked',
    functional_check_status: 'not_checked',
    failure_reason: null,
    message_created_at: null,
    message_received_at: null,
    message_sent_at: null,
    parsed_at: null,
    validated_at: null,
    acknowledged_at: null,
    failed_at: null,
    ack_due_at: null,
    // This is the preview action's clock; no historical ingress is asserted.
    created_at: admissionAt,
    updated_at: admissionAt,
    created_by: null,
    updated_by: null,
  } satisfies EdielMessageRow
}

export function validateUtilts(
  rawPayload: string,
  options: { admissionAt?: string | Date } = {},
): UtiltsRuntimeResult['validation'] {
  const message = createUtiltsPreviewMessage({ rawPayload, id: 'utilts-validation', admissionAt: options.admissionAt })
  return runUtiltsRuntimeForMessage(message, { referenceDate: message.created_at }).validation
}
