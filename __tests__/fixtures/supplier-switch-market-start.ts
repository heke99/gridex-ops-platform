/** A synthetic period tied to one confirmed inbound Z04 and one switch.
 * These fields are the independent read-side evidence used by the ready queue. */
export function confirmedSwitchMarketStart(
  request: { id: string; company_id: unknown; inbound_z04_message_id: string },
  marketStart = '2026-10-01T00:00:00Z',
) {
  return {
    id: request.id,
    company_id: request.company_id,
    source_switch_request_id: request.id,
    source_message_id: request.inbound_z04_message_id,
    source: 'ediel_qualified_source',
    source_process: 'supplier_switch_confirmation',
    status: 'confirmed_by_grid_owner',
    market_start_at: marketStart,
  }
}
