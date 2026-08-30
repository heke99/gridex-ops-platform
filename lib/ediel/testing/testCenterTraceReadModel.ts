import { getEdielMessageById } from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { stockholmMonthBounds } from '@/lib/time/stockholm'

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function segmentRows(raw: string | null) {
  if (!raw) return []
  return raw
    .split("'")
    .map((segment, index) => ({ index: index + 1, segment: segment.trim() }))
    .filter((row) => row.segment.length > 0)
}

async function maybeSingle(table: string, companyId: string, column: string, value: string) {
  const result = await supabaseService
    .from(table)
    .select('*')
    .eq('company_id', companyId)
    .eq(column, value)
    .maybeSingle()
  if (result.error) throw result.error
  return (result.data as Row | null) ?? null
}

export async function loadTestCenterTrace(input: {
  edielMessageId: string
  billingMonth: string
  billingUnderlayId?: string | null
}) {
  const message = await getEdielMessageById(input.edielMessageId)
  if (!message) throw new Error('Test Center-trace hittade inte Ediel-meddelandet.')
  if (message.environment !== 'test') throw new Error('Test Center-trace får endast läsa environment=test.')

  const companyId = text(message.company_id)
  const customerId = text(message.customer_id)
  const meteringPointId = text(message.metering_point_id)
  if (!companyId || !customerId) throw new Error('Test Center-trace saknar tenant- eller kundbindning.')

  const inboundEmailMessageId = text((message as unknown as Row).inbound_email_message_id)
  let inboundEnvelope: Row | null = null
  if (inboundEmailMessageId) {
    const result = await supabaseService
      .from('inbound_email_messages')
      .select('*')
      .eq('company_id', companyId)
      .eq('id', inboundEmailMessageId)
      .eq('environment', 'test')
      .maybeSingle()
    if (result.error) throw result.error
    inboundEnvelope = (result.data as Row | null) ?? null
  }

  const bounds = stockholmMonthBounds(input.billingMonth)
  let meteringRows: Row[] = []
  if (meteringPointId) {
    const result = await supabaseService
      .from('normalized_metering_values')
      .select('*')
      .eq('company_id', companyId)
      .eq('metering_point_id', meteringPointId)
      .lt('period_start', bounds.end)
      .gt('period_end', bounds.start)
      .order('period_start', { ascending: true })
      .limit(5000)
    if (result.error) throw result.error
    meteringRows = (result.data ?? []) as Row[]
  }

  let underlay: Row | null = null
  if (input.billingUnderlayId) {
    underlay = await maybeSingle('billing_underlays', companyId, 'id', input.billingUnderlayId)
  } else {
    const { year, month } = (() => {
      const [yearText, monthText] = input.billingMonth.split('-')
      return { year: Number(yearText), month: Number(monthText) }
    })()
    const result = await supabaseService
      .from('billing_underlays')
      .select('*')
      .eq('company_id', companyId)
      .eq('customer_id', customerId)
      .eq('underlay_year', year)
      .eq('underlay_month', month)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (result.error) throw result.error
    underlay = (result.data as Row | null) ?? null
  }

  let invoiceItem: Row | null = null
  let invoiceDraft: Row | null = null
  let pricingRun: Row | null = null
  let pricingLines: Row[] = []
  let priceSnapshot: Row | null = null

  const underlayId = text(underlay?.id)
  if (underlayId) {
    const itemResult = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('company_id', companyId)
      .eq('billing_underlay_id', underlayId)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (itemResult.error) throw itemResult.error
    invoiceItem = (itemResult.data as Row | null) ?? null
  }

  const invoiceItemId = text(invoiceItem?.id)
  if (invoiceItemId) {
    invoiceDraft = await maybeSingle('customer_invoices', companyId, 'invoice_export_item_id', invoiceItemId)
  }

  const pricingRunId = text(invoiceItem?.pricing_run_id)
  if (pricingRunId) {
    const [runResult, linesResult] = await Promise.all([
      supabaseService.from('pricing_runs').select('*').eq('company_id', companyId).eq('id', pricingRunId).maybeSingle(),
      supabaseService.from('pricing_preview_lines').select('*').eq('company_id', companyId).eq('pricing_run_id', pricingRunId).order('sort_order', { ascending: true }),
    ])
    if (runResult.error) throw runResult.error
    if (linesResult.error) throw linesResult.error
    pricingRun = (runResult.data as Row | null) ?? null
    pricingLines = (linesResult.data ?? []) as Row[]
  }

  const snapshotId = text(underlay?.contract_price_snapshot_id) ?? text(underlay?.pricing_snapshot_id)
  if (snapshotId) priceSnapshot = await maybeSingle('contract_price_snapshots', companyId, 'id', snapshotId)

  const rawEdifact = text(inboundEnvelope?.raw_edifact_payload)
  const parsedPayload = objectValue((message as unknown as Row).parsed_payload)
  const validationReport = objectValue((message as unknown as Row).validation_report)

  return {
    companyId,
    customerId,
    edielMessageId: message.id,
    billingMonth: input.billingMonth,
    source: {
      inboundEmailMessageId,
      filename: text(objectValue(inboundEnvelope?.match_payload).filename),
      sha256: text(objectValue(inboundEnvelope?.match_payload).sha256),
      rawEdifact,
      segments: segmentRows(rawEdifact),
    },
    canonical: {
      messageFamily: message.message_family,
      messageCode: message.message_code,
      messageVersion: message.message_version,
      applicationReference: message.application_reference,
      senderEdielId: message.sender_ediel_id,
      receiverEdielId: message.receiver_ediel_id,
      parsedPayload,
      validationReport,
    },
    metering: {
      meteringPointId,
      rows: meteringRows,
    },
    billing: { underlay },
    pricing: { run: pricingRun, snapshot: priceSnapshot, lines: pricingLines },
    invoice: { exportItem: invoiceItem, draft: invoiceDraft },
  }
}
