// lib/ediel/operations/controlTower.ts

import { supabaseService } from '@/lib/supabase/service'

export type EdielOpsTone = 'success' | 'warning' | 'danger' | 'info'

export type EdielOpsMetric = {
  key: string
  label: string
  value: number | string
  tone: EdielOpsTone
  href?: string
  description?: string
}

export type EdielOpsMonitor = {
  key: string
  title: string
  status: 'healthy' | 'attention' | 'blocked' | 'info'
  value: string
  description: string
  actionHref?: string
  actionLabel?: string
}

export type EdielOpsIncident = {
  id: string
  title: string
  description: string
  tone: EdielOpsTone
  createdAt: string | null
  href?: string
}

export type EdielOpsReadinessCheck = {
  key: string
  label: string
  status: 'ready' | 'warning' | 'blocked' | 'info'
  description: string
}

export type EdielControlTowerOperationsSummary = {
  generatedAt: string
  companyId: string | null
  scope: 'platform' | 'tenant'
  metrics: EdielOpsMetric[]
  monitors: EdielOpsMonitor[]
  readiness: EdielOpsReadinessCheck[]
  incidents: EdielOpsIncident[]
  auditTimeline: EdielOpsIncident[]
  sendLock: {
    status: 'ready' | 'warning' | 'blocked'
    title: string
    description: string
    blockers: EdielOpsReadinessCheck[]
    warnings: EdielOpsReadinessCheck[]
  }
}

type QueryFilter = {
  column: string
  op?: 'eq' | 'neq' | 'in' | 'is' | 'notIs' | 'lte' | 'gte' | 'ilike'
  value: unknown
}

type RawEdielMessage = {
  id?: string | null
  message_family?: string | null
  message_code?: string | null
  direction?: string | null
  status?: string | null
  ack_status?: string | null
  failure_reason?: string | null
  interchange_reference?: string | null
  transaction_reference?: string | null
  created_at?: string | null
}

type RawAuditLog = {
  id?: string | null
  entity_type?: string | null
  action?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

type RawEdielEvent = {
  id?: string | null
  ediel_message_id?: string | null
  event_type?: string | null
  event_status?: string | null
  message?: string | null
  created_at?: string | null
}

function applyCompanyScope(query: any, companyId: string | null) {
  return companyId ? query.eq('company_id', companyId) : query
}

function applyFilters(query: any, filters: QueryFilter[]) {
  let current = query
  for (const filter of filters) {
    if (filter.op === 'in') {
      current = current.in(filter.column, Array.isArray(filter.value) ? filter.value : [])
    } else if (filter.op === 'neq') {
      current = filter.value === null
        ? current.not(filter.column, 'is', null)
        : current.neq(filter.column, filter.value)
    } else if (filter.op === 'is') {
      current = current.is(filter.column, filter.value)
    } else if (filter.op === 'notIs') {
      current = current.not(filter.column, 'is', filter.value)
    } else if (filter.op === 'lte') {
      current = current.lte(filter.column, filter.value)
    } else if (filter.op === 'gte') {
      current = current.gte(filter.column, filter.value)
    } else if (filter.op === 'ilike') {
      current = current.ilike(filter.column, String(filter.value ?? ''))
    } else {
      current = current.eq(filter.column, filter.value)
    }
  }
  return current
}

async function safeCount(
  table: string,
  companyId: string | null,
  filters: QueryFilter[] = []
): Promise<number> {
  try {
    let query: any = supabaseService.from(table).select('*', { count: 'exact', head: true })
    query = applyCompanyScope(query, companyId)
    query = applyFilters(query, filters)
    const { count, error } = await query
    if (error) throw error
    return count ?? 0
  } catch (error) {
    console.warn(`[ediel-ops] Kunde inte räkna ${table}`, error)
    return 0
  }
}

async function safeRows<T>(params: {
  table: string
  companyId?: string | null
  select: string
  filters?: QueryFilter[]
  limit?: number
  orderColumn?: string
  ascending?: boolean
}): Promise<T[]> {
  try {
    let query: any = supabaseService
      .from(params.table)
      .select(params.select)
      .limit(params.limit ?? 10)

    query = applyCompanyScope(query, params.companyId ?? null)
    query = applyFilters(query, params.filters ?? [])
    query = query.order(params.orderColumn ?? 'created_at', { ascending: params.ascending ?? false })

    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as T[]
  } catch (error) {
    console.warn(`[ediel-ops] Kunde inte hämta ${params.table}`, error)
    return []
  }
}

function hasEnv(name: string): boolean {
  return Boolean((process.env[name] ?? '').trim())
}

function toneFromCount(value: number, dangerAt = 1): EdielOpsTone {
  return value >= dangerAt ? 'danger' : 'success'
}

function monitorFromCount(params: {
  key: string
  title: string
  count: number
  healthyText: string
  issueText: string
  issueStatus?: 'attention' | 'blocked'
  actionHref?: string
  actionLabel?: string
}): EdielOpsMonitor {
  return {
    key: params.key,
    title: params.title,
    status: params.count > 0 ? params.issueStatus ?? 'attention' : 'healthy',
    value: String(params.count),
    description: params.count > 0 ? params.issueText : params.healthyText,
    actionHref: params.actionHref,
    actionLabel: params.actionLabel,
  }
}

function readinessCheck(
  key: string,
  label: string,
  ok: boolean,
  okDescription: string,
  failDescription: string,
  severity: 'warning' | 'blocked' = 'blocked'
): EdielOpsReadinessCheck {
  return {
    key,
    label,
    status: ok ? 'ready' : severity,
    description: ok ? okDescription : failDescription,
  }
}

function eventIncident(row: RawEdielEvent): EdielOpsIncident {
  const messageId = row.ediel_message_id ?? null
  return {
    id: row.id ?? `${messageId ?? 'event'}-${row.created_at ?? Math.random()}`,
    title: `${row.event_type ?? 'Ediel-händelse'} · ${row.event_status ?? 'info'}`,
    description: row.message ?? 'Ediel-händelse kräver granskning.',
    tone: row.event_status === 'error' ? 'danger' : row.event_status === 'warning' ? 'warning' : 'info',
    createdAt: row.created_at ?? null,
    href: messageId ? `/admin/ediel/messages/${messageId}` : undefined,
  }
}

function messageIncident(row: RawEdielMessage): EdielOpsIncident {
  const reference = row.transaction_reference ?? row.interchange_reference ?? row.id ?? 'saknar referens'
  return {
    id: row.id ?? reference,
    title: `${row.message_family ?? 'EDIEL'} ${row.message_code ?? ''} · ${row.status ?? 'status saknas'}`,
    description: row.failure_reason ?? `Referens: ${reference}`,
    tone: row.status === 'failed' ? 'danger' : 'warning',
    createdAt: row.created_at ?? null,
    href: row.id ? `/admin/ediel/messages/${row.id}` : undefined,
  }
}

function auditIncident(row: RawAuditLog): EdielOpsIncident {
  const action = row.action ?? 'audit'
  const entity = row.entity_type ?? 'ediel'
  return {
    id: row.id ?? `${entity}-${action}-${row.created_at ?? Math.random()}`,
    title: `${entity} · ${action}`,
    description:
      typeof row.metadata?.message === 'string' ? row.metadata.message : 'Audit-händelse registrerad.',
    tone: 'info',
    createdAt: row.created_at ?? null,
  }
}

export async function buildEdielControlTowerOperationsSummary(params: {
  companyId: string | null
  scope: 'platform' | 'tenant'
}): Promise<EdielControlTowerOperationsSummary> {
  const companyId = params.companyId
  const now = new Date()
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const nowIso = now.toISOString()

  const [
    totalMessages,
    failedMessages,
    inbound24h,
    sent24h,
    queuedOutbound,
    overdueViewCount,
    missingContrl,
    missingAperak,
    duplicateBlocked,
    unresolvedOutbound,
    routeLessOutbound,
    failedPreflight,
    failedEvents,
    activeActorSettings,
    enabledRouteProfiles,
    disabledRouteProfiles,
    activeRules,
    productionQueued,
    recentFailedMessages,
    recentFailedEvents,
    recentAudit,
  ] = await Promise.all([
    safeCount('ediel_messages', companyId),
    safeCount('ediel_messages', companyId, [{ column: 'status', value: 'failed' }]),
    safeCount('ediel_messages', companyId, [
      { column: 'direction', value: 'inbound' },
      { column: 'created_at', op: 'gte', value: last24h },
    ]),
    safeCount('ediel_messages', companyId, [
      { column: 'direction', value: 'outbound' },
      { column: 'message_sent_at', op: 'gte', value: last24h },
    ]),
    safeCount('ediel_messages', companyId, [
      { column: 'direction', value: 'outbound' },
      { column: 'status', op: 'in', value: ['draft', 'prepared', 'queued'] },
    ]),
    safeCount('ediel_overdue_message_acks_v', companyId),
    safeCount('ediel_messages', companyId, [
      { column: 'requires_contrl', value: true },
      { column: 'message_family', op: 'neq', value: 'CONTRL' },
      { column: 'contrl_status', op: 'in', value: ['pending', 'failed'] },
    ]),
    safeCount('ediel_messages', companyId, [
      { column: 'requires_aperak', value: true },
      { column: 'message_family', op: 'in', value: ['PRODAT', 'UTILTS', 'UTILTS_ERR'] },
      { column: 'aperak_status', op: 'in', value: ['pending', 'failed'] },
    ]),
    safeCount('ediel_messages', companyId, [{ column: 'dedupe_status', op: 'in', value: ['duplicate', 'blocked'] }]),
    safeCount('outbound_requests', companyId, [{ column: 'channel_type', value: 'unresolved' }]),
    safeCount('ediel_messages', companyId, [
      { column: 'direction', value: 'outbound' },
      { column: 'communication_route_id', op: 'is', value: null },
      { column: 'status', op: 'in', value: ['draft', 'prepared', 'queued', 'failed'] },
    ]),
    safeCount('ediel_messages', companyId, [
      { column: 'status', value: 'failed' },
      { column: 'failure_reason', op: 'ilike', value: '%preflight%' },
    ]),
    safeCount('ediel_message_events', null, [
      { column: 'event_type', value: 'failed' },
      { column: 'created_at', op: 'gte', value: last24h },
    ]),
    safeCount('ediel_actor_settings', companyId, [{ column: 'is_active', value: true }]),
    safeCount('ediel_route_profiles', companyId, [{ column: 'is_enabled', value: true }]),
    safeCount('ediel_route_profiles', companyId, [{ column: 'is_enabled', value: false }]),
    safeCount('ediel_message_rules', companyId, [{ column: 'is_active', value: true }]),
    safeCount('ediel_messages', companyId, [
      { column: 'environment', value: 'production' },
      { column: 'direction', value: 'outbound' },
      { column: 'status', op: 'in', value: ['prepared', 'queued'] },
    ]),
    safeRows<RawEdielMessage>({
      table: 'ediel_messages',
      companyId,
      select: 'id, message_family, message_code, direction, status, failure_reason, interchange_reference, transaction_reference, created_at',
      filters: [{ column: 'status', value: 'failed' }],
      limit: 8,
    }),
    safeRows<RawEdielEvent>({
      table: 'ediel_message_events',
      select: 'id, ediel_message_id, event_type, event_status, message, created_at',
      filters: [{ column: 'event_status', op: 'in', value: ['warning', 'error'] }],
      limit: 8,
    }),
    safeRows<RawAuditLog>({
      table: 'audit_logs',
      companyId,
      select: 'id, entity_type, action, metadata, created_at',
      filters: [{ column: 'entity_type', op: 'ilike', value: '%ediel%' }],
      limit: 8,
    }),
  ])

  const ackOverdue = overdueViewCount
  const routeFailures = unresolvedOutbound + routeLessOutbound
  const transportFailures = failedEvents + failedMessages
  const smtpConfigured = hasEnv('EDIEL_SMTP_HOST') && hasEnv('EDIEL_SMTP_USER') && hasEnv('EDIEL_SMTP_PASS')
  const imapConfigured = hasEnv('EDIEL_IMAP_HOST') && hasEnv('EDIEL_IMAP_USER') && hasEnv('EDIEL_IMAP_PASS')

  const metrics: EdielOpsMetric[] = [
    { key: 'messages', label: 'Ediel-meddelanden', value: totalMessages, tone: 'info', href: '/admin/ediel/messages' },
    { key: 'failed', label: 'Misslyckade', value: failedMessages, tone: toneFromCount(failedMessages), href: '/admin/ediel/messages?status=failed' },
    { key: 'inbound24h', label: 'Inbound 24h', value: inbound24h, tone: inbound24h > 0 ? 'success' : 'warning', href: '/admin/ediel/messages?direction=inbound' },
    { key: 'sent24h', label: 'Skickade 24h', value: sent24h, tone: sent24h > 0 ? 'success' : 'info', href: '/admin/ediel/messages?direction=outbound' },
    { key: 'overdue', label: 'ACK overdue', value: ackOverdue, tone: toneFromCount(ackOverdue), href: '/admin/ediel/messages' },
    { key: 'missingContrl', label: 'Saknar CONTRL', value: missingContrl, tone: toneFromCount(missingContrl), href: '/admin/ediel/messages' },
    { key: 'missingAperak', label: 'Saknar APERAK', value: missingAperak, tone: toneFromCount(missingAperak), href: '/admin/ediel/messages' },
    { key: 'sendLock', label: 'Live-kö', value: productionQueued, tone: productionQueued > 0 ? 'warning' : 'success', href: '/admin/ediel/messages?direction=outbound' },
  ]

  const monitors: EdielOpsMonitor[] = [
    {
      key: 'imap_health',
      title: 'Inbound mailbox health',
      status: imapConfigured ? (inbound24h > 0 ? 'healthy' : 'attention') : 'blocked',
      value: imapConfigured ? `${inbound24h} inbound senaste 24h` : 'IMAP saknar env-konfiguration',
      description: imapConfigured
        ? inbound24h > 0
          ? 'Mailboxen tar emot trafik och importflödet har färska inbound-meddelanden.'
          : 'IMAP är konfigurerat men inga inbound-meddelanden har registrerats senaste 24 timmarna. Kontrollera om det är förväntat.'
        : 'EDIEL_IMAP_HOST, EDIEL_IMAP_USER och EDIEL_IMAP_PASS behöver vara satta eller route-profiler behöver ha fungerande mailboxuppgifter.',
      actionHref: '/admin/ediel/system-tests',
      actionLabel: 'Polla/synka',
    },
    {
      key: 'smtp_health',
      title: 'Outbound SMTP health',
      status: smtpConfigured ? (failedMessages > 0 ? 'attention' : 'healthy') : 'blocked',
      value: smtpConfigured ? `${sent24h} skickade senaste 24h` : 'SMTP saknar env-konfiguration',
      description: smtpConfigured
        ? 'SMTP-konfiguration finns. Misslyckade meddelanden visas som separata incidenter.'
        : 'EDIEL_SMTP_HOST, EDIEL_SMTP_USER och EDIEL_SMTP_PASS behöver vara satta innan liveutskick kan tillåtas.',
      actionHref: '/admin/ediel/routes',
      actionLabel: 'Kontrollera routes',
    },
    monitorFromCount({
      key: 'failed_transport',
      title: 'Failed IMAP/SMTP events',
      count: transportFailures,
      healthyText: 'Inga misslyckade transporthändelser hittades i aktuell scope.',
      issueText: 'Det finns misslyckade transport- eller Ediel-händelser som bör följas upp.',
      issueStatus: 'blocked',
      actionHref: '/admin/ediel/messages?status=failed',
      actionLabel: 'Visa fel',
    }),
    monitorFromCount({
      key: 'ack_overdue',
      title: 'ACK overdue monitor',
      count: ackOverdue,
      healthyText: 'Inga försenade kvittenser hittades.',
      issueText: 'Meddelanden har passerat ack_due_at utan förväntad kvittens.',
      issueStatus: 'blocked',
      actionHref: '/admin/ediel/messages',
      actionLabel: 'Visa ACK-kedjor',
    }),
    monitorFromCount({
      key: 'missing_contrl',
      title: 'Missing CONTRL monitor',
      count: missingContrl,
      healthyText: 'Inga meddelanden väntar på CONTRL i aktuell scope.',
      issueText: 'Det finns meddelanden som fortfarande väntar på CONTRL eller där CONTRL misslyckats.',
      issueStatus: 'blocked',
      actionHref: '/admin/ediel/messages',
      actionLabel: 'Visa meddelanden',
    }),
    monitorFromCount({
      key: 'missing_aperak',
      title: 'Missing APERAK monitor',
      count: missingAperak,
      healthyText: 'Inga meddelanden väntar på APERAK i aktuell scope.',
      issueText: 'Det finns meddelanden som väntar på APERAK eller där APERAK misslyckats.',
      issueStatus: 'blocked',
      actionHref: '/admin/ediel/messages',
      actionLabel: 'Visa meddelanden',
    }),
    monitorFromCount({
      key: 'duplicate',
      title: 'Duplicate inbound/outbound monitor',
      count: duplicateBlocked,
      healthyText: 'Inga blockerade dubbletter hittades.',
      issueText: 'Dubblettskyddet har blockerat eller markerat Ediel-meddelanden.',
      actionHref: '/admin/ediel/messages',
      actionLabel: 'Visa dubbletter',
    }),
    monitorFromCount({
      key: 'route_resolution',
      title: 'Failed route resolution',
      count: routeFailures,
      healthyText: 'Inga kända route-resolution-problem i aktuell scope.',
      issueText: 'Outbound eller meddelanden saknar tydlig route/kommunikationsprofil.',
      issueStatus: 'blocked',
      actionHref: '/admin/ediel/routes',
      actionLabel: 'Öppna routes',
    }),
    monitorFromCount({
      key: 'payload_preflight',
      title: 'Failed payload preflight',
      count: failedPreflight,
      healthyText: 'Inga blockerade payload-preflight-fel hittades.',
      issueText: 'Meddelanden har stoppats av payload preflight innan skick.',
      issueStatus: 'blocked',
      actionHref: '/admin/ediel/messages?status=failed',
      actionLabel: 'Visa preflight-fel',
    }),
  ]

  const readiness: EdielOpsReadinessCheck[] = [
    readinessCheck(
      'actor_settings',
      'Aktörsprofil finns',
      activeActorSettings > 0,
      `${activeActorSettings} aktiva Ediel-aktörsprofiler hittades.`,
      'Ingen aktiv Ediel-aktörsprofil hittades. Liveflöden ska blockeras tills tenant/aktör är komplett.'
    ),
    readinessCheck(
      'route_profiles',
      'Route-profiler aktiva',
      enabledRouteProfiles > 0,
      `${enabledRouteProfiles} aktiva route-profiler hittades.`,
      'Ingen aktiv route-profil hittades. Systemet kan inte säkert välja mottagare/transport.'
    ),
    readinessCheck(
      'message_rules',
      'Runtime-regler aktiva',
      activeRules > 0,
      `${activeRules} aktiva Ediel message rules hittades.`,
      'Inga aktiva Ediel message rules hittades. Version/ACK-policy kan inte styras säkert.'
    ),
    readinessCheck(
      'smtp_env',
      'SMTP-konfiguration',
      smtpConfigured,
      'SMTP env-konfiguration finns.',
      'SMTP env-konfiguration saknas eller är ofullständig.',
      'warning'
    ),
    readinessCheck(
      'imap_env',
      'IMAP-konfiguration',
      imapConfigured,
      'IMAP env-konfiguration finns.',
      'IMAP env-konfiguration saknas eller är ofullständig.',
      'warning'
    ),
    {
      key: 'regression_gate_pending',
      label: 'Regelaktivering låst tills 2.5C',
      status: 'info',
      description:
        '2.5D-1 bygger drift och skydd. Nya tekniska regler ska inte aktiveras som live-regler innan 2.5C regression/golden suite är byggd och grön.',
    },
  ]

  const blockers = readiness.filter((check) => check.status === 'blocked')
  const warnings = readiness.filter((check) => check.status === 'warning')
  if (failedPreflight > 0) {
    blockers.push({
      key: 'payload_preflight_failures',
      label: 'Payload preflight-fel finns',
      status: 'blocked',
      description: `${failedPreflight} meddelanden har blockerats av payload preflight. Lös dessa innan live-send tillåts.`,
    })
  }
  if (routeFailures > 0) {
    blockers.push({
      key: 'route_failures',
      label: 'Route-resolution-fel finns',
      status: 'blocked',
      description: `${routeFailures} route-/outboundproblem hittades. Live-send ska blockeras tills de är lösta.`,
    })
  }
  if (ackOverdue > 0) {
    warnings.push({
      key: 'ack_overdue_warning',
      label: 'Försenade kvittenser finns',
      status: 'warning',
      description: `${ackOverdue} kvittenser är försenade. Detta är driftvarning även om nytt skick fortfarande kan vara tillåtet.`,
    })
  }

  const sendLockStatus = blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready'

  return {
    generatedAt: nowIso,
    companyId,
    scope: params.scope,
    metrics,
    monitors,
    readiness,
    incidents: [
      ...recentFailedMessages.map(messageIncident),
      ...recentFailedEvents.map(eventIncident),
    ].slice(0, 12),
    auditTimeline: recentAudit.map(auditIncident),
    sendLock: {
      status: sendLockStatus,
      title:
        sendLockStatus === 'ready'
          ? 'Live-send foundation är grön'
          : sendLockStatus === 'warning'
            ? 'Live-send foundation har varningar'
            : 'Live-send ska blockeras vid osäkerhet',
      description:
        sendLockStatus === 'ready'
          ? 'Aktör, route och regelgrund finns. Full regelaktivering kräver fortfarande 2.5C regression.'
          : sendLockStatus === 'warning'
            ? 'Systemet kan köras i test/driftläge men bör inte gå live utan att varningarna är hanterade.'
            : 'Minst en blockerare finns. Systemet ska inte tillåta osäker live-sändning innan blockerare är lösta.',
      blockers,
      warnings,
    },
  }
}
