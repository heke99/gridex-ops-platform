/**
 * When was the switch's PRODAT Z03 sent to the grid owner? The switch row's own timestamps are not reliable: after the
 * Z03 is sent the switch stays 'prepared' and submitted_at is never written (FINDINGS H-14, GOR-06). The outbound Z03
 * message bound to the switch is the evidence: it counts once it has actually left (sent, acknowledged or delivered).
 */
const SENT_MESSAGE_STATUSES = new Set(['sent', 'acknowledged', 'delivered'])

export function switchProdatSentAt(
  switchRow: Record<string, unknown> | null,
  z03Message: { id?: unknown; status?: unknown; message_sent_at?: unknown } | null,
): string | null {
  for (const key of ['submitted_at', 'sent_at', 'dispatched_at']) {
    const value = switchRow?.[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  const boundId = switchRow?.outbound_z03_message_id
  if (!z03Message || typeof boundId !== 'string' || z03Message.id !== boundId) return null
  if (!SENT_MESSAGE_STATUSES.has(String(z03Message.status ?? ''))) return null
  return typeof z03Message.message_sent_at === 'string' && z03Message.message_sent_at.trim() ? z03Message.message_sent_at : null
}
