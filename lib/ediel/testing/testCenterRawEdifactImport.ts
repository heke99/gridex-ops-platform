import { createHash, randomUUID } from 'node:crypto'
import { parseInboundEmailContent, type ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { resolveTenantForInboundEdiel } from '@/lib/inbound-mail/inboundTenantResolver'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
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

function billingMonthBounds(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim())
  if (!match) throw new Error('Fakturamånad måste anges som YYYY-MM.')
  const year = Number(match[1])
  const month = Number(match[2])
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    value: value.trim(),
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDateExclusive: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

export function assertRawTestEdifactPreflight(raw: string, billingMonth?: string): ParsedEdifactEnvelope {
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes === 0) throw new Error('EDIFACT-innehåll saknas.')
  if (bytes > MAX_TEST_EDIFACT_BYTES) throw new Error('Test Center accepterar högst 2 MB EDIFACT per körning.')

  const parsed = parseInboundEmailContent({ attachmentText: raw })
  if (!parsed) throw new Error('Innehållet innehåller ingen canonical EDIFACT-payload.')
  if (parsed.messageFamily !== 'UTILTS' || String(parsed.messageCode ?? '').toUpperCase() !== 'E66') {
    throw new Error(`Mätvärde→faktura-testet accepterar endast UTILTS E66, inte ${parsed.messageFamily} ${parsed.messageCode ?? ''}.`.trim())
  }
  if (!parsed.senderEdielId || !parsed.receiverEdielId) {
    throw new Error('UTILTS E66 saknar entydig UNB-avsändare eller mottagare.')
  }
  if (canonicalMeteringCandidates(parsed).length === 0) {
    throw new Error('UTILTS E66 saknar canonical LOC+172/Z07/MG/TN/LI-referens för mätpunktsmatchning.')
  }

  // Run the same canonical runtime before any customer/site/contract write. The
  // synthetic row is parse/validation-only; no persistence or acknowledgement is
  // performed here. This prevents a malformed E66 from binding and signing the
  // Fakturatest contract before the normal inbound chain gets a chance to reject it.
  const validationMessage = {
    id: 'invoice-test-preflight',
    message_family: 'UTILTS',
    message_code: 'E66',
    direction: 'inbound',
    environment: 'test',
    raw_payload: raw,
    validation_report: null,
    syntax_check_status: 'not_checked',
    functional_check_status: 'not_checked',
    message_received_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  } as unknown as EdielMessageRow
  const preflightRuntime = runUtiltsRuntimeForMessage(validationMessage)
  const blockingIssues = preflightRuntime.validation.issues.filter((issue) => issue.severity === 'error')
  if (blockingIssues.length > 0 || preflightRuntime.validation.classification !== 'accepted') {
    const summary = blockingIssues.slice(0, 5).map((issue) => `${issue.code}: ${issue.description}`).join(' · ')
    throw new Error(`UTILTS E66 stoppades i canonical preflight före masterdataändring: ${summary || preflightRuntime.validation.classification}`)
  }

  const transactions = preflightRuntime.facts.transactions
  if (transactions.length !== 1) {
    throw new Error(`Fakturatest kräver exakt en E66-transaktion för vald testkund; filen innehåller ${transactions.length}.`)
  }
  const transaction = transactions[0]
  const energyValues = transaction.quantities
    .filter((quantity) => String(quantity.qualifier ?? '').trim() === '136')
    .map((quantity) => quantity.value)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const totalEnergy = energyValues.reduce((sum, value) => sum + value, 0)
  if (energyValues.length === 0 || totalEnergy <= 0) {
    throw new Error('Fakturatest kräver positiv fakturerbar periodenergi i QTY+136. Mätarställning QTY+220 räknas inte som förbruknings-kWh.')
  }

  if (billingMonth) {
    const bounds = billingMonthBounds(billingMonth)
    const periodStart = String(transaction.deliveryPeriodStart ?? '').slice(0, 10)
    const periodEnd = String(transaction.deliveryPeriodEnd ?? '').slice(0, 10)
    if (periodStart !== bounds.startDate || periodEnd !== bounds.endDateExclusive) {
      throw new Error(`E66-perioden ${periodStart || 'saknas'}–${periodEnd || 'saknas'} matchar inte vald fakturamånad ${bounds.value} (${bounds.startDate}–${bounds.endDateExclusive}).`)
    }
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

async function assertInboundTenantMatchesSelection(input: {
  companyId: string
  parsed: ParsedEdifactEnvelope
}) {
  const resolution = await resolveTenantForInboundEdiel({
    mailboxCompanyId: input.companyId,
    environment: 'test',
    parsed: input.parsed,
  })

  if (resolution.status !== 'resolved' || !resolution.companyId) {
    throw new Error(`Canonical inbound-routing kunde inte entydigt verifiera vald Test Center-tenant före masterdataändring: ${resolution.reasons.join(' ') || resolution.status}.`)
  }
  if (resolution.companyId !== input.companyId) {
    throw new Error('Canonical inbound-routing matchade en annan tenant än vald Test Center-tenant; import stoppad fail-closed.')
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
    .select('id,company_id,customer_id,message_family,message_code,direction,environment')
    .eq('company_id', input.companyId)
    .eq('inbound_email_message_id', input.inboundEmailMessageId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(2)

  if (result.error) throw result.error
  const rows = (result.data ?? []) as Row[]
  if (rows.length !== 1) throw new Error('Test Center kunde inte entydigt hitta skapad inbound Ediel-post.')
  const row = rows[0]
  if (row.environment !== 'test' || row.message_family !== 'UTILTS' || row.message_code !== 'E66' || row.customer_id !== input.customerId) {
    throw new Error('Skapad inbound Ediel-post saknar korrekt test-/UTILTS E66-/kundbindning; runtime stoppad.')
  }
  return String(row.id)
}

export async function importRawEdifactAndRunTestCenterChain(
  input: TestCenterRawImportInput,
): Promise<TestCenterRawImportResult> {
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const companyId = required(input.companyId, 'companyId')
  const customerId = required(input.customerId, 'customerId')
  const billingMonth = required(input.billingMonth, 'billingMonth')
  const rawEdifact = required(input.rawEdifact, 'EDIFACT-payload')
  const parsed = assertRawTestEdifactPreflight(rawEdifact, billingMonth)
  const sourceSha256 = createHash('sha256').update(rawEdifact).digest('hex')

  // Routing is verified before the first customer/site/contract write. The later
  // testCenterTenantBinding may preserve an already verified tenant, but it must
  // never be the mechanism that turns an otherwise unresolved receiver into a
  // successful Fakturatest tenant match.
  await assertInboundTenantMatchesSelection({ companyId, parsed })

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
    billingMonth,
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
