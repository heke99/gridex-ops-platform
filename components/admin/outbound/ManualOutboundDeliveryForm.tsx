import type { OutboundRequestRow } from '@/lib/cis/types'

const MANUAL_REQUEST_TYPES = new Set<OutboundRequestRow['request_type']>([
  'supplier_switch', 'meter_values', 'customer_masterdata', 'metering_access',
  'grid_owner_metering_access_agreement', 'switch_information_request',
  'current_supplier_contract_information_request', 'customer_masterdata_request',
  'supplier_switch_cancellation', 'metering_access_request', 'metering_access_termination', 'meter_values_request',
])

export function manualOutboundDeliveryTarget(request: OutboundRequestRow, linkedOriginal = false) {
  if (!request.company_id || !request.customer_id || linkedOriginal || request.ediel_route_profile_id || request.response_payload?.edielMessageId
    || !MANUAL_REQUEST_TYPES.has(request.request_type)
    || !['email_manual', 'file_export'].includes(request.channel_type)) return null
  if (['queued', 'prepared', 'failed'].includes(request.status)) return 'sent'
  return request.status === 'sent' && request.sent_at ? 'acknowledged' : null
}

export function ManualOutboundDeliveryForm({
  request, action, linkedOriginal,
}: {
  request: OutboundRequestRow
  action: (formData: FormData) => Promise<void>
  linkedOriginal?: boolean
}) {
  const status = manualOutboundDeliveryTarget(request, linkedOriginal)
  if (!status) return null

  return (
    <form action={action} className="grid gap-2 rounded-xl border border-slate-200 p-3">
      <input type="hidden" name="outbound_request_id" value={request.id} />
      <input type="hidden" name="customer_id" value={request.customer_id} />
      <input type="hidden" name="original_status" value={request.status} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="dispatch_step" value={status === 'sent' ? 'send' : 'ack'} />
      <label className="grid gap-1 text-sm font-semibold">
        Referens till manuellt kvitto
        <input name="manual_delivery_reference" required maxLength={240}
          className="min-h-10 rounded-xl border border-slate-300 px-3 font-normal" />
      </label>
      <button className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm font-semibold">
        {status === 'sent' ? 'Registrera manuell sändning' : 'Registrera manuell kvittens'}
      </button>
    </form>
  )
}
