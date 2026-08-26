import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { storeInboundEmail } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import { supabaseService } from '@/lib/supabase/service'

const BATCH = 'live-e66-multitenant-20260826'
const ACTOR_USER_ID = process.env.GRIDEX_E2E_ACTOR_USER_ID ?? ''
const SHARED_TEST_MAILBOX_ID = 'd05b61bf-1aa4-4ef6-9a86-d38ae5c415f8'

const TENANT_A = {
  companyId: '1858cc1f-0aac-4289-a2eb-6ec87bc9ddff',
  name: 'Test bolag',
  receiverEdielId: '99101',
  externalMeteringPointId: '735999999999999991',
  meteringPointUuid: 'f7de1417-e030-4c62-869e-0bff87243423',
}

const TENANT_B = {
  companyId: 'aa121d1e-990b-40ed-8399-4442539fec62',
  name: 'Nibela AB',
  receiverEdielId: '99102',
  externalMeteringPointId: '735999999999999992',
  meteringPointUuid: 'fc306471-c5d8-4694-a009-35170f8ae65a',
}

function buildE66(params: {
  tag: string
  receiverEdielId: string
  meteringPointId: string
  quantityPerInterval?: number
}) {
  const quantity = params.quantityPerInterval ?? 0.25
  const transaction = [
    `IDE+24+TX-${params.tag}`,
    `LOC+172+${params.meteringPointId}`,
    'LOC+239+GRIDEXTEST',
    'DTM+324:202608010000202608020000:719',
    'DTM+354:15:806',
    'DTM+597:202608020100:203',
    'MEA+AAZ++KWH',
    ...Array.from({ length: 96 }, () => `QTY+136:${quantity.toFixed(3)}`),
  ]

  const messageBody = [
    `UNH+MSG-${params.tag}+UTILTS:D:02B:UN:E5SE5A`,
    `BGM+E66+E66-${params.tag}+9+AB`,
    'DTM+137:202608261500:203',
    'NAD+MS+GRIDOWNER',
    `NAD+MR+${params.receiverEdielId}`,
    ...transaction,
  ]
  const untCount = messageBody.length + 1

  return [
    "UNA:+.? '",
    `UNB+UNOC:3+GRIDOWNER:14+${params.receiverEdielId}:14+260826:1500+UNB-${params.tag}++23-DDQ-E66-T++1`,
    ...messageBody,
    `UNT+${untCount}+MSG-${params.tag}`,
    `UNZ+1+UNB-${params.tag}`,
  ].map((segment) => segment.endsWith("'") ? segment : `${segment}'`).join('')
}

async function ensureActorSetting(tenant: typeof TENANT_A) {
  const { error: deleteError } = await supabaseService
    .from('ediel_actor_settings')
    .delete()
    .eq('company_id', tenant.companyId)
    .eq('environment', 'test')
    .eq('actor_ediel_id', tenant.receiverEdielId)
    .contains('metadata', { test_batch: BATCH })
  if (deleteError) throw deleteError

  const { error } = await supabaseService.from('ediel_actor_settings').insert({
    company_id: tenant.companyId,
    actor_name: `${tenant.name} live E66 test`,
    actor_ediel_id: tenant.receiverEdielId,
    ediel_id: tenant.receiverEdielId,
    actor_role: 'supplier',
    role: 'supplier',
    environment: 'test',
    is_active: true,
    default_application_reference: '23-DDQ-E66-T',
    application_reference: '23-DDQ-E66-T',
    subaddress_required: false,
    metadata: { test_batch: BATCH, purpose: 'live raw EDIFACT E66 tenant routing probe' },
  })
  if (error) throw error
}

async function ingestRawE66(params: {
  tenant: typeof TENANT_A
  meteringPointId: string
  tag: string
}) {
  const rawPayload = buildE66({
    tag: params.tag,
    receiverEdielId: params.tenant.receiverEdielId,
    meteringPointId: params.meteringPointId,
  })

  const stored = await storeInboundEmail({
    mailboxId: SHARED_TEST_MAILBOX_ID,
    companyId: null,
    environment: 'test',
    internetMessageId: `<${BATCH}-${params.tag}-${Date.now()}@gridex.test>`,
    fromAddress: 'gridowner@example.invalid',
    toAddress: 'ediel@gridex.se',
    subject: `${BATCH} ${params.tag}`,
    receivedAt: new Date().toISOString(),
    rawEdifactPayload: rawPayload,
    bodyText: rawPayload,
    rawEmail: `From: gridowner@example.invalid\r\nTo: ediel@gridex.se\r\nSubject: ${BATCH} ${params.tag}\r\n\r\n${rawPayload}`,
    hasAttachments: false,
  })

  expect(stored.deduped).toBe(false)

  const mailOutcome = await processInboundEmailMessage({
    inboundEmailMessageId: stored.id,
    actorUserId: ACTOR_USER_ID,
  })

  const messageQuery = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('inbound_email_message_id', stored.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (messageQuery.error) throw messageQuery.error
  if (!messageQuery.data) throw new Error(`No ediel_messages row created for ${params.tag}`)

  const edielMessageId = String(messageQuery.data.id)
  await processInboundEdielMessage({
    actorUserId: ACTOR_USER_ID,
    edielMessageId,
  })

  const finalMessageQuery = await supabaseService
    .from('ediel_messages')
    .select('*')
    .eq('id', edielMessageId)
    .single()
  if (finalMessageQuery.error) throw finalMessageQuery.error

  const valuesQuery = await supabaseService
    .from('metering_values')
    .select('id,company_id,customer_id,metering_point_id,value_kwh,quantity_kwh,period_start,period_end,source_message_id,source_ediel_message_id,utilts_message_id,measurement_resolution,resolution,source_transaction_reference')
    .or(`source_message_id.eq.${edielMessageId},source_ediel_message_id.eq.${edielMessageId},utilts_message_id.eq.${edielMessageId}`)
    .order('period_start', { ascending: true })
  if (valuesQuery.error) throw valuesQuery.error

  return {
    inboundEmailId: stored.id,
    edielMessageId,
    mailOutcome,
    message: finalMessageQuery.data as Record<string, any>,
    values: (valuesQuery.data ?? []) as Array<Record<string, any>>,
    rawPayload,
  }
}

beforeAll(async () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Live E66 probe requires Supabase runtime credentials')
  }
  if (!ACTOR_USER_ID) throw new Error('GRIDEX_E2E_ACTOR_USER_ID is required')

  await ensureActorSetting(TENANT_A)
  await ensureActorSetting(TENANT_B)
})

afterAll(async () => {
  await supabaseService
    .from('ediel_actor_settings')
    .delete()
    .contains('metadata', { test_batch: BATCH })
})

describe('live raw EDIFACT E66 multi-tenant runtime', () => {
  it('classifies and routes tenant A, then stores all 96 quarter-hour values only under tenant A', async () => {
    const result = await ingestRawE66({ tenant: TENANT_A, meteringPointId: TENANT_A.externalMeteringPointId, tag: `A-${Date.now()}` })

    expect(result.mailOutcome.companyId).toBe(TENANT_A.companyId)
    expect(result.message.message_standard).toBe('edifact')
    expect(result.message.message_family).toBe('UTILTS')
    expect(result.message.message_code).toBe('E66')
    expect(result.message.company_id).toBe(TENANT_A.companyId)
    expect(result.message.tenant_resolution_status).toBe('tenant_resolved')
    expect(result.message.utilts_subtype).toBe('E66-KVART')
    expect(String(result.message.measurement_resolution ?? '')).toMatch(/15|PT15M/i)
    expect(result.message.metering_point_id).toBe(TENANT_A.meteringPointUuid)

    expect(result.values).toHaveLength(96)
    expect(new Set(result.values.map((row) => row.company_id))).toEqual(new Set([TENANT_A.companyId]))
    expect(new Set(result.values.map((row) => row.metering_point_id))).toEqual(new Set([TENANT_A.meteringPointUuid]))
    const total = result.values.reduce((sum, row) => sum + Number(row.value_kwh ?? row.quantity_kwh ?? 0), 0)
    expect(total).toBeCloseTo(24, 6)
  }, 60_000)

  it('classifies and routes tenant B, then stores all 96 quarter-hour values only under tenant B', async () => {
    const result = await ingestRawE66({ tenant: TENANT_B, meteringPointId: TENANT_B.externalMeteringPointId, tag: `B-${Date.now()}` })

    expect(result.mailOutcome.companyId).toBe(TENANT_B.companyId)
    expect(result.message.message_standard).toBe('edifact')
    expect(result.message.message_family).toBe('UTILTS')
    expect(result.message.message_code).toBe('E66')
    expect(result.message.company_id).toBe(TENANT_B.companyId)
    expect(result.message.tenant_resolution_status).toBe('tenant_resolved')
    expect(result.message.utilts_subtype).toBe('E66-KVART')
    expect(String(result.message.measurement_resolution ?? '')).toMatch(/15|PT15M/i)
    expect(result.message.metering_point_id).toBe(TENANT_B.meteringPointUuid)

    expect(result.values).toHaveLength(96)
    expect(new Set(result.values.map((row) => row.company_id))).toEqual(new Set([TENANT_B.companyId]))
    expect(new Set(result.values.map((row) => row.metering_point_id))).toEqual(new Set([TENANT_B.meteringPointUuid]))
    const total = result.values.reduce((sum, row) => sum + Number(row.value_kwh ?? row.quantity_kwh ?? 0), 0)
    expect(total).toBeCloseTo(24, 6)
  }, 60_000)

  it('does not cross tenant boundaries when tenant A receives an E66 containing tenant B metering point', async () => {
    const result = await ingestRawE66({ tenant: TENANT_A, meteringPointId: TENANT_B.externalMeteringPointId, tag: `X-${Date.now()}` })

    expect(result.mailOutcome.companyId).toBe(TENANT_A.companyId)
    expect(result.message.message_family).toBe('UTILTS')
    expect(result.message.message_code).toBe('E66')
    expect(result.message.company_id).toBe(TENANT_A.companyId)
    expect(result.message.metering_point_id).not.toBe(TENANT_B.meteringPointUuid)
    expect(result.values).toHaveLength(0)

    const report = JSON.stringify(result.message.validation_report ?? {})
    const parsed = JSON.stringify(result.message.parsed_payload ?? {})
    expect(`${report}\n${parsed}`).toMatch(/UNKNOWN_METERING_POINT|Okänd anläggning|metering_point_not_matched_within_tenant/i)
  }, 60_000)
})
