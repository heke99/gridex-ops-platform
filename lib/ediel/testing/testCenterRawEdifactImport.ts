import { createHash, randomUUID } from 'node:crypto'
import { parseInboundEmailContent, type ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { resolveTenantForInboundEdiel } from '@/lib/inbound-mail/inboundTenantResolver'
import { supabaseService } from '@/lib/supabase/service'
import { runTestCenterMeteringToInvoiceChain } from '@/lib/ediel/testing/testCenterRuntimeChain'
import { materializeInvoiceTestEdifactMasterdata } from '@/lib/ediel/testing/invoiceTestEdifactMaterialization'

const MAX_TEST_EDIFACT_BYTES = 2 * 1024 * 1024

type Row = Record<string, unknown>

export type TestCenterRawImportInput = {
  actorUserId: string
  companyId: string
  customerId: string
  billingMonth: string
  rawEdifact: string
  filename?: string | null
}

export type TestCenterRawImportResult = {
  inboundEmailMessageId: string
  edielMessageId: string
  parseResultId: string | null
  parsed: ParsedEdifactEnvelope
  runtime: Awaited<ReturnType<typeof runTestCenterMeteringToInvoiceChain>>
  sourceSha256: string
  reusedInboundEnvelope: boolean
  materializedMeteringPointId: string
}

function required(value: string, label: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Test Center saknar ${label}.`)
  return normalized
}

function canonicalMeteringCandidates(parsed: ParsedEdifactEnvelope): string[] {
  return Array.from(new Set([
    parsed.locations['172']?.[0] ?? null,
    parsed.references.Z07?.[0] ?? null,
    parsed.references.MG?.[0] ?? null,
    parsed.references.TN?.[0] ?? null,
    parsed.references.LI?.[0] ?? null,
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim())))
}

export function assertRawTestEdifactPreflight(raw: string): ParsedEdifactEnvelope {
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes === 0) throw new Error('EDIFACT-innehåll saknas.')
  if (bytes > MAX_TEST_EDIFACT_BYTES) throw new Error('Test Center accepterar högst 2 MB EDIFACT per körning.')

  const parsed = parseInboundEmailContent({ attachmentText: raw })
  if (!parsed) throw new Error('Innehållet innehåller ingen canonical EDIFACT-payload.')
  if (parsed.messageFamily !== 'UTILTS') {
    throw new Error(`Mätvärde→faktura-testet accepterar endast UTILTS, inte ${parsed.messageFamily}.`)
  }
  if (!parsed.senderEdielId || !parsed.receiverEdielId) {
    throw new Error('UTILTS saknar entydig UNB-avsändare eller mottagare.')
  }
  if (canonicalMeteringCandidates(parsed).length === 0) {
    throw new Error('UTILTS saknar canonical LOC+172/Z07/MG/TN/LI-referens för mätpunktsmatchning.')
  }
  return parsed
}

async function assertSelectedCustomerMeteringPoint(input: {
  companyId: string
  customerId: string
  parsed: ParsedEdifactEnvelope
}) {
  const candidates = canonicalMeteringCandidates(input.parsed)
  const ors = candidates.flatMap((candidate) => [
    `meter_point_id.eq.${candidate}`,
    `metering_point_id.eq.${candidate}`,
    `site_facility_id.eq.${candidate}`,
    `ediel_reference.eq.${candidate}`,
  ])

  const result = await supabaseService
    .from('metering_points')
    .select('id,company_id,customer_id,meter_point_id,metering_point_id,site_facility_id,ediel_reference,is_test_data,archived_at')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('is_test_data', true)
    .is('archived_at', null)
    .or(ors.join(','))
    .limit(2)

  if (result.error) throw result.error
  const rows = (result.data ?? []) as Row[]
  if (rows.length !== 1) {
    throw new Error(rows.length === 0
      ? 'EDIFACT-identiteten kunde inte verifieras mot vald testkund efter materialisering.'
      : 'EDIFACT-identiteten matchar flera mätpunkter för vald testkund; import stoppad fail-closed.')
  }
}

async function assertNoConflictingInboundTenant(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
}) {
  const resolution = await resolveTenantForInboundEdiel({
    mailboxCompanyId: input.companyId,
    environment: 'test',
    parsed: input.parsed,
  })

  if (resolution.status === 'resolved' && resolution.companyId && resolution.companyId !== input.companyId) {
    throw new Error('Canonical inbound-routing matchade en annan tenant än vald Test Center-tenant; import stoppad fail-closed.')
  }
  if (resolution.status === 'ambiguous' && resolution.candidates.some((candidate) => candidate !== input.companyId)) {
    throw new Error('Canonical inbound-routing har konflikt mellan vald Test Center-tenant och annan tenant; import stoppad fail-closed.')
  }
}

async function findExistingTestInboundEnvelope(input: {
  companyId: string
  customerId: string
  rawEdifact: string
}): Promise<string | null> {
  const result = await supabaseService
    .from('inbound_email_messages')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('environment', 'test')
    .eq('raw_edifact_payload', input.rawEdifact)
    .eq('match_status', 'test_center_raw_import')
    .contains('match_payload', { test_center_customer_id: input.customerId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data?.id ? String(result.data.id) : null
}

async function getOrCreateTestInboundEnvelope(input: {
  companyId: string
  customerId: string
  actorUserId: string
  rawEdifact: string
  filename: string | null
  sourceSha256: string
}): Promise<{ id: string; reused: boolean }> {
  const existing = await findExistingTestInboundEnvelope({
    companyId: input.companyId,
    customerId: input.customerId,
    rawEdifact: input.rawEdifact,
  })
  if (existing) return { id: existing, reused: true }

  const id = randomUUID()
  const now = new Date().toISOString()
  const result = await supabaseService.from('inbound_email_messages').insert({
    id,
    company_id: input.companyId,
    environment: 'test',
    raw_edifact_payload: input.rawEdifact,
    body_text: null,
    processing_status: 'received',
    match_status: 'test_center_raw_import',
    match_payload: {
      source: 'test_center_raw_edifact_import_v1',
      test_center_customer_id: input.customerId,
      filename: input.filename,
      sha256: input.sourceSha256,
      actor_user_id: input.actorUserId,
      external_side_effects_allowed: false,
    },
    created_at: now,
    updated_at: now,
  }).select('id').single()

  if (result.error) throw result.error
  return { id: String(result.data.id), reused: false }
}

async function resolveCreatedInboundEdielMessage(input: {
  companyId: string
  customerId: string
  inboundEmailMessageId: string
}) {
  const result = await supabaseService
    .from('ediel_messages')
    .select('id,company_id,customer_id,message_family,direction,environment')
    .eq('company_id', input.companyId)
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(2)

  if (result.error) throw result.error
  const rows = (result.data ?? []) as Row[]
  if (rows.length !== 1) throw new Error('Test Center kunde inte entydigt hitta skapad inbound Ediel-post.')
  const row = rows[0]
  if (row.environment !== 'test' || row.message_family !== 'UTILTS' || row.customer_id !== input.customerId) {
    throw new Error('Skapad inbound Ediel-post saknar korrekt test-/UTILTS-/kundbindning; runtime stoppad.')
  }
  return String(row.id)
}

export async function importRawEdifactAndRunTestCenterChain(
  input: TestCenterRawImportInput,
): Promise<TestCenterRawImportResult> {
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const companyId = required(input.companyId, 'companyId')
  const customerId = required(input.customerId, 'customerId')
  const rawEdifact = required(input.rawEdifact, 'EDIFACT-payload')
  const parsed = assertRawTestEdifactPreflight(rawEdifact)
  const sourceSha256 = createHash('sha256').update(rawEdifact).digest('hex')

  // Fakturatest masterdata is deliberately derived from the same canonical parser
  // result that is about to enter the normal inbound chain. No facility/metering
  // identifiers are supplied by the test-customer form or invented by the harness.
  const materialized = await materializeInvoiceTestEdifactMasterdata({
    companyId,
    customerId,
    actorUserId,
    parsed,
    sourceSha256,
  })
  await assertSelectedCustomerMeteringPoint({ companyId, customerId, parsed })
  await assertNoConflictingInboundTenant({ companyId, parsed })

  const envelope = await getOrCreateTestInboundEnvelope({
    companyId,
    customerId,
    actorUserId,
    rawEdifact,
    filename: input.filename?.trim() || null,
    sourceSha256,
  })

  const inbound = await processInboundEmailMessage({
    inboundEmailMessageId: envelope.id,
    actorUserId,
    testCenterTenantBinding: { companyId, customerId },
  })
  if (!inbound.companyId) {
    throw new Error(`Canonical inbound-resolvern kunde inte behålla vald Test Center-tenant (${inbound.status}).`)
  }
  if (inbound.companyId !== companyId) {
    throw new Error('Canonical inbound-resolvern gav annan tenant än vald Test Center-tenant.')
  }

  const edielMessageId = await resolveCreatedInboundEdielMessage({
    companyId,
    customerId,
    inboundEmailMessageId: envelope.id,
  })

  const runtime = await runTestCenterMeteringToInvoiceChain({
    actorUserId,
    companyId,
    customerId,
    edielMessageId,
    billingMonth: input.billingMonth,
  })

  return {
    inboundEmailMessageId: envelope.id,
    edielMessageId,
    parseResultId: inbound.parseResultId,
    parsed,
    runtime,
    sourceSha256,
    reusedInboundEnvelope: envelope.reused,
    materializedMeteringPointId: materialized.meteringPointId,
  }
}