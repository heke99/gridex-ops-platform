import { inspectMimeStructure, mimeFields } from './mimeStructure'

type TypedAddress = { type: string; address: string }
type DsnAction = 'failed' | 'delayed' | 'delivered' | 'relayed' | 'expanded'
export type DeliveryStatusReport = {
  version: 1
  transportCorrelation: 'unverified'
  reportingMta: TypedAddress | null
  originalEnvelopeId: string | null
  originalMessageIds: string[]
  recipients: Array<{
    finalRecipient: TypedAddress | null
    originalRecipient: TypedAddress | null
    action: DsnAction | null
    status: string | null
    diagnosticCode: { type: string; text: string } | null
    remoteMta: TypedAddress | null
    lastAttemptDate: string | null
    willRetryUntil: string | null
  }>
  issues: string[]
}

/** RFC3464/6533 fields are observations. Neither MIME syntax nor a returned
 * original authorizes a tenant, a provider identity or a delivery transition. */
export function parseDeliveryStatusReport(raw: string | null | undefined): DeliveryStatusReport | null {
  if (!raw) return null
  const inspected = inspectMimeStructure(raw)
  if (!inspected.deliveryStatus && !inspected.exceededLimits) return null
  const issues = new Set(inspected.issues)
  const report: DeliveryStatusReport = { version: 1, transportCorrelation: 'unverified', reportingMta: null,
    originalEnvelopeId: null, originalMessageIds: [], recipients: [], issues: [] }
  const statuses = inspected.entities.filter(e => ['message/delivery-status', 'message/global-delivery-status'].includes(e.mediaType))
  if (statuses.length !== 1) issues.add('delivery_status_part_ambiguous_or_missing')
  if (statuses.length === 1) {
    const statusEntity = statuses[0]
    const blockText = statusEntity.body.replace(/\r\n/g, '\n').trim().split(/\n[ \t]*\n/)
    if (blockText.length > 257 || blockText.some(block => block.length > 65536)) issues.add('delivery_status_field_limit')
    const blocks = blockText.slice(0, 257).map(block => mimeFields(block.slice(0, 65536)))
    const field = (fields: Map<string, string[]>, name: string): string | null => {
      const values = fields.get(name) ?? []
      if (values.length > 1) { issues.add(`duplicate_${name.replaceAll('-', '_')}`); return null }
      return values[0] || null
    }
    const typed = (value: string | null, name: string): TypedAddress | null => {
      if (!value) return null
      const match = /^([A-Za-z0-9-]+);[ \t]*(.+)$/.exec(value)
      if (!match) { issues.add(`invalid_${name}`); return null }
      return { type: match[1].toLowerCase(), address: match[2] }
    }
    const message = blocks.shift() ?? new Map<string, string[]>()
    report.reportingMta = typed(field(message, 'reporting-mta'), 'reporting_mta')
    report.originalEnvelopeId = field(message, 'original-envelope-id')
    if (!report.reportingMta) issues.add('reporting_mta_required')
    for (const block of blocks) {
      const finalRecipient = typed(field(block, 'final-recipient'), 'final_recipient')
      const actionValue = field(block, 'action')
      const action = ['failed','delayed','delivered','relayed','expanded'].includes(actionValue ?? '') ? actionValue as DsnAction : null
      const statusValue = field(block, 'status')
      const status = /^[245]\.\d{1,3}\.\d{1,3}$/.test(statusValue ?? '') ? statusValue : null
      if (!finalRecipient || !action || !status) issues.add('recipient_required_field_invalid')
      if (status && action && status[0] !== (action === 'failed' ? '5' : action === 'delayed' ? '4' : '2')) issues.add('recipient_action_status_mismatch')
      const diagnostic = typed(field(block, 'diagnostic-code'), 'diagnostic_code')
      report.recipients.push({ finalRecipient, originalRecipient: typed(field(block, 'original-recipient'), 'original_recipient'), action, status,
        diagnosticCode: diagnostic ? { type: diagnostic.type, text: diagnostic.address } : null,
        remoteMta: typed(field(block, 'remote-mta'), 'remote_mta'), lastAttemptDate: field(block, 'last-attempt-date'), willRetryUntil: field(block, 'will-retry-until') })
    }
    if (!report.recipients.length) issues.add('recipient_block_required')
    // Only a sibling returned-header/message part supplies the original RFC ID.
    // UNB/BGM in its body, the report's own ID and forwarded wrapper IDs do not.
    for (const returned of inspected.entities.filter(e => e.parent === statusEntity.parent &&
      ['message/rfc822', 'message/global', 'text/rfc822-headers', 'message/global-headers'].includes(e.mediaType))) {
      const headers = mimeFields(returned.body.split(/\r?\n\r?\n/, 1)[0])
      const ids = headers.get('message-id') ?? []
      if (ids.length !== 1 || !/^<[^<>\s]+@[^<>\s]+>$/.test(ids[0])) { issues.add('original_message_id_ambiguous'); continue }
      report.originalMessageIds.push(ids[0])
    }
    if (new Set(report.originalMessageIds).size !== report.originalMessageIds.length || report.originalMessageIds.length > 1) {
      issues.add('original_message_id_ambiguous'); report.originalMessageIds = []
    }
  }
  report.issues = [...issues]
  return report
}
