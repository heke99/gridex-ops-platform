// This helper belongs only to the isolated hosted acceptance invocation.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nativeSql as sql, literal } from './ediel-normal-switch-native-fixture'
import { authenticateCurrentPhaseActor, readActualMarketClocks } from './ediel-prospective-market-clock-native'
import { planCompletedReadingPhase, readCompletedReadingRegistration, verifyCompletedReadingPhase } from './ediel-completed-reading-clock'

type Suite = 'fg' | 'z10m'
type Source = { companyId: string; switchId: string; period: string; source: string }
type Actor = { id: string; email: string }
type Application = {
  supply: Source
  structuralSourceId: string
  structureEffectiveAt: string
  actor: Actor
  wires: readonly string[]
}
type PersistedReading = { id: string; outcome: 'persisted' | 'structural_err' }
const digest = (wire: string) => createHash('sha256').update(wire, 'utf8').digest('hex')

export function completedReadingHostedSuite(suite: Suite): boolean {
  const configured = process.env.GRIDEX_COMPLETED_READING_SUITE
  if (!configured) return false
  assert.equal(configured, suite)
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted')
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321')
  return true
}

export async function enterCompletedReadingHostedPhase(suite: Suite, input: Application) {
  assert(completedReadingHostedSuite(suite))
  const { GRIDEX_READING_CLOCK_CONTROL: control, GRIDEX_READING_CLOCK_CONTROLLER: controller,
    GRIDEX_READING_CLOCK_EVIDENCE: evidence, GRIDEX_EDIEL_CASE_TEST_PASSWORD: password } = process.env
  assert(control && controller && evidence && password, 'completed_reading_owned_epoch_required')
  const admission = JSON.parse(readFileSync(control, 'utf8'))
  const { supply, structuralSourceId, structureEffectiveAt, actor, wires } = input
  const chronology = sql<{ ledgerOpenedAt: string; switchCreatedAt: string; marketStartAt: string; structureAdmittedAt: string }>(`
    SELECT jsonb_build_object('ledgerOpenedAt', epoch.opened_at, 'switchCreatedAt', sw.created_at,
      'marketStartAt', sp.market_start_at, 'structureAdmittedAt', change.message_received_at)
    FROM gridex_received_sources.epoch epoch
    JOIN public.supplier_switch_requests sw ON sw.id=${literal(supply.switchId)} AND sw.company_id=${literal(supply.companyId)}
    JOIN public.customer_supply_periods sp ON sp.id=${literal(supply.period)} AND sp.company_id=sw.company_id
      AND sp.metering_point_id=sw.metering_point_id AND sp.source_message_id=sw.inbound_z04_message_id
      AND sp.source_message_id=${literal(supply.source)}
    JOIN public.ediel_messages change ON change.id=${literal(structuralSourceId)} AND change.company_id=sw.company_id
      AND change.environment='test' AND change.direction='inbound'
      AND change.message_code=${literal(suite === 'fg' ? 'Z06' : 'Z10')}
      AND (
        (change.message_code='Z06' AND change.metering_point_id=sp.metering_point_id)
        OR (change.message_code='Z10' AND (change.metering_point_id IS NULL OR change.metering_point_id=sp.metering_point_id)
          -- The ordinary multi-register mailbox intake may have no top-level point.
          -- Its immutable structural object receipt is the applied point authority.
          AND EXISTS (
            SELECT 1 FROM gridex_received_sources.structural_object_apply_receipts receipt
            JOIN gridex_received_sources.sources original ON original.source_message_id=receipt.source_message_id
              AND original.company_id=receipt.company_id AND original.environment=receipt.environment
              AND original.payload_hash=receipt.payload_hash AND original.source_received_at=receipt.source_received_at
            WHERE receipt.source_message_id=change.id AND receipt.company_id=change.company_id AND receipt.environment=change.environment
              AND receipt.actor_user_id=${literal(actor.id)} AND original.origin='database_insert' AND original.message_code='Z10'
              AND original.raw_payload=change.raw_payload AND original.source_received_at=change.message_received_at
              AND receipt.effect->>'meteringPointId'=sp.metering_point_id::text AND receipt.effect->>'siteId'=sw.site_id::text
              AND receipt.effect#>>'{wire,messageCode}'='Z10' AND receipt.effect#>>'{wire,businessCase}'='meter_exchange'
              AND (receipt.effect->>'effectiveAt')::timestamptz=${literal(structureEffectiveAt)}::timestamptz
          ))
      )
    WHERE epoch.singleton;`)
  assert(chronology, 'completed_reading_native_supply_required')
  const registrationInstants = wires.map(readCompletedReadingRegistration)
  const wireHashes = wires.map(digest)
  const phase = planCompletedReadingPhase({ ...chronology, structureEffectiveAt, registrationInstants }, admission, readActualMarketClocks())
  const controllerReceipt = JSON.parse(execFileSync('python3', [controller, '--advance', String(phase.targetRealtimeMs / 1000)], {
    encoding: 'utf8', timeout: 20_000,
  }))
  const after = readActualMarketClocks()
  const auth = await fetch('http://127.0.0.1:54321/auth/v1/health', {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, redirect: 'error', signal: AbortSignal.timeout(5_000),
  })
  assert.equal(auth.ok, true)
  verifyCompletedReadingPhase(phase, controllerReceipt, after, auth.headers.get('date') ?? '')
  const authority = await authenticateCurrentPhaseActor({ userId: actor.id, email: actor.email, companyId: supply.companyId,
    password, permissionKeys: ['communication.read', 'metering.read'] })

  return (readings: readonly PersistedReading[]) => {
    assert.deepEqual(readings.map(reading => reading.outcome), suite === 'fg' ? ['persisted'] : ['persisted', 'persisted', 'structural_err'])
    assert.equal(readings.length, wireHashes.length)
    const sources = readings.map((reading, index) => {
      const source = sql<{ id: string; receivedAt: string; payloadHash: string }>(`
        SELECT jsonb_build_object('id',m.id,'receivedAt',m.message_received_at,'payloadHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))
        FROM public.ediel_messages m WHERE m.id=${literal(reading.id)} AND m.company_id=${literal(supply.companyId)}
          AND m.environment='test' AND m.direction='inbound' AND m.message_code='E66';`)
      assert(source && source.payloadHash === wireHashes[index], 'completed_reading_original_bytes_required')
      assert(Date.parse(source.receivedAt) >= phase.targetRealtimeMs && Date.parse(source.receivedAt) >= Date.parse(registrationInstants[index]))
      return { ...source, registrationAt: registrationInstants[index], outcome: reading.outcome }
    })
    writeFileSync(resolve(evidence, 'product-boundary-receipt.json'), JSON.stringify({ schema: 'completed_reading_native_v1',
      suite, companyId: supply.companyId, switchId: supply.switchId, baselineSourceId: supply.source, structuralSourceId,
      chronology: { ...chronology, structureEffectiveAt }, after, phase, controllerReceipt, authority, sources }, null, 2), { flag: 'wx' })
  }
}
