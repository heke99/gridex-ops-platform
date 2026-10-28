import { supabaseService } from '@/lib/supabase/service'

function nowIso(): string {
  return new Date().toISOString()
}

async function openTaskExists(params: {
  companyId: string
  taskType: string
  sourceId: string
}): Promise<boolean> {
  const { count, error } = await supabaseService
    .from('customer_operation_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', params.companyId)
    .eq('task_type', params.taskType)
    .eq('status', 'open')
    .contains('metadata', { sourceId: params.sourceId })

  if (error) {
    console.warn('[inbound-overdue] Kunde inte kontrollera befintlig task', error)
    return false
  }

  return (count ?? 0) > 0
}

async function createOverdueTask(input: {
  companyId: string
  customerId?: string | null
  siteId?: string | null
  meteringPointId?: string | null
  taskType: string
  title: string
  description: string
  sourceId: string
  metadata: Record<string, unknown>
  /** The status the watch read. The flag is written only while the request still has it (F105). */
  expectedStatus?: string | null
  /** The source is not an outbound request (J1-02: a Z04 without an own Z03); no request is flagged. */
  flagOutboundRequest?: boolean
  createdBy?: string
}): Promise<boolean> {
  const exists = await openTaskExists({ companyId: input.companyId, taskType: input.taskType, sourceId: input.sourceId })
  if (exists) return false

  const { error } = await supabaseService.from('customer_operation_tasks').insert({
    company_id: input.companyId,
    customer_id: input.customerId ?? null,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    task_type: input.taskType,
    status: 'open',
    priority: 'high',
    title: input.title,
    description: input.description,
    metadata: { ...input.metadata, sourceId: input.sourceId, createdBy: input.createdBy ?? 'batch_7a_overdue_monitor' },
  })

  if (error) {
    console.warn('[inbound-overdue] Kunde inte skapa overdue task', error)
    return false
  }

  if (input.flagOutboundRequest === false) return true
  // A Z04/ACK received between the watch's read and this write keeps its status; the task already records the alarm.
  const flag = supabaseService
    .from('outbound_requests')
    .update({ status: 'waiting_attention', updated_at: nowIso(), failure_reason: input.title })
    .eq('id', input.sourceId)
    .eq('company_id', input.companyId)
  await (input.expectedStatus ? flag.eq('status', input.expectedStatus) : flag)

  return true
}

const WATCHED_OUTBOUND_COLUMNS = ['id', 'company_id', 'customer_id', 'site_id', 'metering_point_id', 'grid_owner_id', 'request_type', 'message_family', 'message_code', 'sent_at', 'status', 'external_reference'] as const
/**
 * J1-01/J1-02 (owner decisions 35 and 36): the operator case for a Z04 the native owner held with its own reason and
 * that we already answered with a negative APERAK. It is opened at receipt, not after 30 minutes, with the SAME open-task
 * key as the watches below: a date conflict on our sent Z03 uses that Z03's outbound request (task type
 * 'ediel_z04_unconfirmed', so the J1-01 watch never opens a second case for it), a Z04 without any own Z03 uses the
 * received Z04 itself. One open case per source; every row is written to the source's own company.
 */
export async function openHeldZ04ReconciliationTask(input: {
  companyId: string
  kind: 'start_date_conflict' | 'without_own_z03'
  /** The received Z04 (ediel_messages.id) and the case reference (field 226) of the held object. */
  sourceMessageId: string
  lineItemReference: string | null
  heldReason: string
  aperakMessageId: string | null
}): Promise<{ created: boolean; sourceId: string | null }> {
  const now = nowIso()
  if (input.kind === 'without_own_z03') {
    const created = await createOverdueTask({
      companyId: input.companyId,
      taskType: 'ediel_z04_without_own_z03',
      title: 'Z04 utan eget leverantörsbyte',
      description: `Nätägaren har skickat Z04 med ärendereferens ${input.lineItemReference ?? '(saknas)'} som inte hör till något av våra leverantörsbyten (${input.heldReason}). Ingen leveransperiod har skapats och nätägaren har fått en negativ APERAK. Kontrollera med nätägaren.`,
      sourceId: input.sourceMessageId,
      metadata: { monitor: 'z04_held_at_receipt', checkedAt: now, sourceMessageId: input.sourceMessageId, lineItemReference: input.lineItemReference, heldReason: input.heldReason, aperakMessageId: input.aperakMessageId },
      flagOutboundRequest: false,
      createdBy: 'j1_normal_z04_hold',
    })
    return { created, sourceId: input.sourceMessageId }
  }
  if (!input.lineItemReference) return { created: false, sourceId: null }
  const { data: switches, error: switchError } = await supabaseService
    .from('supplier_switch_requests')
    .select('id, status, customer_id, site_id, metering_point_id, requested_start_date')
    .eq('company_id', input.companyId)
    .eq('rff_li_reference', input.lineItemReference)
    .limit(2)
  if (switchError) throw switchError
  const rows = (switches ?? []) as Array<{ id: string; status: string | null; customer_id: string | null; site_id: string | null; metering_point_id: string | null; requested_start_date: string | null }>
  if (rows.length !== 1) return { created: false, sourceId: null }
  const sw = rows[0]
  const { data: requests, error: requestError } = await supabaseService
    .from('outbound_requests')
    .select('id, status')
    .eq('company_id', input.companyId)
    .eq('source_type', 'supplier_switch_request')
    .eq('source_id', sw.id)
    .eq('message_code', 'Z03')
    .order('created_at', { ascending: false })
    .limit(1)
  if (requestError) throw requestError
  const request = (requests ?? [])[0] as { id: string; status: string | null } | undefined
  if (!request) return { created: false, sourceId: null }
  const created = await createOverdueTask({
    companyId: input.companyId,
    customerId: sw.customer_id,
    siteId: sw.site_id,
    meteringPointId: sw.metering_point_id,
    taskType: 'ediel_z04_unconfirmed',
    title: 'Z04 med annat startdatum – avstämning krävs',
    description: `Nätägaren har bekräftat leverantörsbyte ${sw.id} med ett annat startdatum än vår Z03 och kundens avtal (${sw.requested_start_date ?? 'okänt'}). Avtalet är oförändrat, leveransen har inte aktiverats och nätägaren har fått en negativ APERAK (ERC 42, fält 210). Stäm av datumet med nätägaren och kunden; en överenskommen datumändring hanteras i ett separat flöde.`,
    sourceId: request.id,
    metadata: { monitor: 'z04_held_at_receipt', checkedAt: now, outboundRequestId: request.id, supplierSwitchRequestId: sw.id, switchStatus: sw.status, sourceMessageId: input.sourceMessageId, heldReason: input.heldReason, aperakMessageId: input.aperakMessageId },
    expectedStatus: 'confirmed',
    createdBy: 'j1_normal_z04_hold',
  })
  return { created, sourceId: request.id }
}

/** Switch statuses that already carry the grid owner's Z04 answer or end the wait for it. */
const Z04_SETTLED_SWITCH_STATUSES = ['accepted', 'confirmed', 'active', 'completed', 'failed', 'rejected', 'cancelled', 'cancelled_before_start']

export async function createInboundOverdueTasks(input: {
  ackDeadlineMinutes?: number
  z04DeadlineMinutes?: number
  z14DeadlineMinutes?: number
  limit?: number
  /** One tenant only (a tenant-scoped run); omitted = every tenant, as the inbound-mail cron runs it. */
  companyId?: string | null
} = {}): Promise<{ ackOverdue: number; z04Overdue: number; z14Overdue: number }> {
  const ackDeadline = input.ackDeadlineMinutes ?? 30
  const z04Deadline = input.z04DeadlineMinutes ?? 24 * 60
  const z14Deadline = input.z14DeadlineMinutes ?? 24 * 60
  const limit = input.limit ?? 100
  const now = nowIso()
  const ackCutoff = new Date(Date.now() - ackDeadline * 60_000).toISOString()
  const z04Cutoff = new Date(Date.now() - z04Deadline * 60_000).toISOString()
  const z14Cutoff = new Date(Date.now() - z14Deadline * 60_000).toISOString()

  let ackOverdue = 0
  let z04Overdue = 0
  let z14Overdue = 0
  // Tenant-scoped run: every read below is limited to the one company; tasks are always written to the row's own company.
  const scopedOutboundRequests = (columns: string) => {
    const query = supabaseService.from('outbound_requests').select(columns).not('company_id', 'is', null)
    return input.companyId ? query.eq('company_id', input.companyId) : query
  }

  const { data: ackRows, error: ackError } = await scopedOutboundRequests('id, company_id, customer_id, site_id, metering_point_id, grid_owner_id, request_type, message_family, message_code, sent_at, status, external_reference')
    .in('status', ['sent', 'prepared', 'queued'])
    .lt('sent_at', ackCutoff)
    .limit(limit)

  if (!ackError) {
    for (const row of (ackRows ?? []) as unknown as Array<Record<string, unknown>>) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      if (!companyId || !sourceId) continue

      const created = await createOverdueTask({
        companyId,
        customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
        siteId: typeof row.site_id === 'string' ? row.site_id : null,
        meteringPointId: typeof row.metering_point_id === 'string' ? row.metering_point_id : null,
        taskType: 'ediel_ack_overdue',
        title: 'Ediel-kvittens saknas',
        description: `Utskick ${sourceId} har varit skickat längre än ${ackDeadline} minuter utan säker inbound-kvittens.`,
        sourceId,
        metadata: { monitor: 'ack_overdue', checkedAt: now, outboundRequest: row },
        expectedStatus: typeof row.status === 'string' ? row.status : null,
      })
      if (created) ackOverdue += 1
    }
  } else {
    console.warn('[inbound-overdue] Kunde inte läsa outbound ack overdue', ackError)
  }

  // '*' so the switch link (source_type/source_id) is read without naming columns the watch does not filter on.
  const { data: z04Rows, error: z04Error } = await scopedOutboundRequests('*')
    .in('status', ['syntax_accepted', 'application_accepted', 'acknowledged'])
    .eq('message_code', 'Z03')
    .lt('acknowledged_at', z04Cutoff)
    .limit(limit)

  if (!z04Error) {
    for (const fullRow of (z04Rows ?? []) as unknown as Array<Record<string, unknown>>) {
      const row = Object.fromEntries(WATCHED_OUTBOUND_COLUMNS.map((column) => [column, fullRow[column] ?? null]))
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      if (!companyId || !sourceId) continue
      // F105: a Z03 whose switch already has the grid owner's Z04, or was settled otherwise, is not missing a Z04.
      // Requests a late technical ACK moved back to 'acknowledged' before the monotonic rule existed stay silent.
      const switchId = fullRow.source_type === 'supplier_switch_request' && typeof fullRow.source_id === 'string' ? fullRow.source_id : null
      if (switchId) {
        const { data: switchRow, error: switchError } = await supabaseService
          .from('supplier_switch_requests')
          .select('id, status, inbound_z04_message_id')
          .eq('company_id', companyId)
          .eq('id', switchId)
          .maybeSingle()
        if (switchError) {
          console.warn('[inbound-overdue] Kunde inte läsa leverantörsbyte för Z04 overdue', switchError)
          continue
        }
        const sw = switchRow as { status?: string | null; inbound_z04_message_id?: string | null } | null
        if (sw && (sw.inbound_z04_message_id || Z04_SETTLED_SWITCH_STATUSES.includes(String(sw.status)))) continue
      }

      const created = await createOverdueTask({
        companyId,
        customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
        siteId: typeof row.site_id === 'string' ? row.site_id : null,
        meteringPointId: typeof row.metering_point_id === 'string' ? row.metering_point_id : null,
        taskType: 'ediel_z04_overdue',
        title: 'Z04-svar saknas',
        description: `Leverantörsbyte ${sourceId} har kvitterats tekniskt men saknar Z04 efter ${z04Deadline} minuter.`,
        sourceId,
        metadata: { monitor: 'z04_overdue', checkedAt: now, outboundRequest: row },
        expectedStatus: typeof row.status === 'string' ? row.status : null,
      })
      if (created) z04Overdue += 1
    }
  } else {
    console.warn('[inbound-overdue] Kunde inte läsa Z04 overdue', z04Error)
  }

  // J1-01 (reality scenario J1): the mail intake marks the Z03's outbound request 'confirmed' as soon as ANY Z04
  // for it arrives, before the canonical runtime and the native supply owner validate the file. A Z04 the native
  // owner holds (another start date than requested, an unqualified register, ...) links no Z04 to the switch, opens
  // no supply period and gets no APERAK from us, and the request is no longer 'acknowledged', so the watch above
  // never sees it. Once our own APERAK deadline has passed such a request reaches an operator, exactly once.
  try {
    // '*' and only the watch's own filter columns: the switch link (source_type/source_id) is read from the row.
    const { data: heldRows, error: heldError } = await scopedOutboundRequests('*')
      .eq('status', 'confirmed')
      .eq('message_code', 'Z03')
      .lt('acknowledged_at', ackCutoff)
      .limit(limit)
    if (heldError) throw heldError
    for (const row of (heldRows ?? []) as unknown as Array<Record<string, unknown>>) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      const switchId = row.source_type === 'supplier_switch_request' && typeof row.source_id === 'string' ? row.source_id : null
      if (!companyId || !sourceId || !switchId) continue
      const { data: switchRow, error: switchError } = await supabaseService
        .from('supplier_switch_requests')
        .select('id, status, inbound_z04_message_id')
        .eq('company_id', companyId)
        .eq('id', switchId)
        .maybeSingle()
      if (switchError) throw switchError
      const sw = switchRow as { status?: string | null; inbound_z04_message_id?: string | null } | null
      if (!sw || sw.inbound_z04_message_id || ['failed', 'rejected', 'cancelled', 'cancelled_before_start', 'completed'].includes(String(sw.status))) continue

      const created = await createOverdueTask({
        companyId,
        customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
        siteId: typeof row.site_id === 'string' ? row.site_id : null,
        meteringPointId: typeof row.metering_point_id === 'string' ? row.metering_point_id : null,
        taskType: 'ediel_z04_unconfirmed',
        title: 'Z04 mottagen men inte verkställd',
        description: `Nätägaren har skickat Z04 för leverantörsbyte ${switchId}, men bekräftelsen kunde inte verkställas (till exempel ett annat startdatum än det begärda). Ingen leveransperiod finns och nätägaren har inte fått någon APERAK. Granska Z04 i Ediel-inkorgen och kontakta nätägaren.`,
        sourceId,
        metadata: { monitor: 'z04_unconfirmed', checkedAt: now, outboundRequestId: sourceId, supplierSwitchRequestId: switchId, switchStatus: sw.status ?? null },
        expectedStatus: 'confirmed',
      })
      if (created) z04Overdue += 1
    }
  } catch (error) {
    console.warn('[inbound-overdue] Kunde inte läsa ej verkställda Z04', error)
  }

  const { data: z14Rows, error: z14Error } = await scopedOutboundRequests('id, company_id, customer_id, site_id, metering_point_id, grid_owner_id, request_type, message_family, message_code, sent_at, status, external_reference')
    .in('status', ['syntax_accepted', 'application_accepted', 'acknowledged'])
    .eq('message_code', 'Z13')
    .lt('acknowledged_at', z14Cutoff)
    .limit(limit)

  if (!z14Error) {
    for (const row of (z14Rows ?? []) as unknown as Array<Record<string, unknown>>) {
      const companyId = typeof row.company_id === 'string' ? row.company_id : null
      const sourceId = typeof row.id === 'string' ? row.id : null
      if (!companyId || !sourceId) continue

      const created = await createOverdueTask({
        companyId,
        customerId: typeof row.customer_id === 'string' ? row.customer_id : null,
        siteId: typeof row.site_id === 'string' ? row.site_id : null,
        meteringPointId: typeof row.metering_point_id === 'string' ? row.metering_point_id : null,
        taskType: 'ediel_z14_overdue',
        title: 'Z14-svar saknas',
        description: `Mätvärdesåtkomst ${sourceId} har kvitterats tekniskt men saknar Z14 efter ${z14Deadline} minuter.`,
        sourceId,
        metadata: { monitor: 'z14_overdue', checkedAt: now, outboundRequest: row },
        expectedStatus: typeof row.status === 'string' ? row.status : null,
      })
      if (created) z14Overdue += 1
    }
  } else {
    console.warn('[inbound-overdue] Kunde inte läsa Z14 overdue', z14Error)
  }

  return { ackOverdue, z04Overdue, z14Overdue }
}
