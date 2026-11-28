import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { localEdifactDateTimeToUtc } from '@/lib/ediel/utilts/timezone'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { retainDeclaredUtiltsReceipt } from '@/__tests__/helpers/utiltsCanonicalOwnerIo'
import { z06fNativeReadingWire } from '@/scripts/helpers/ediel-z06f-reading-followup-native-wire'
import type { EdielMessageRow } from '@/lib/ediel/types'
import {
  planCompletedReadingPhase,
  readCompletedReadingRegistration,
  verifyCompletedReadingPhase,
  type ReadingClockSnapshot,
} from '../scripts/helpers/ediel-completed-reading-clock'

const companyId = '89000000-0000-4000-8000-000000000001'
const sourceId = '89000000-0000-4000-8000-000000000002'
const initial = '2026-11-24T08:00:00.000Z'
const ordinary = '2026-11-24T08:00:30.000Z'
const physicalEnd = '2026-12-20T23:00:00.000Z'
const scope = {
  external: '735999260731000007', sender: '21660', receiver: '91100',
  gridAreaCode: 'TES', requestedStartDate: '2026-12-08',
  brpEdielId: '99876', caseReference: 'SYNTHETIC',
}

const chronology = {
  ledgerOpenedAt: '2026-11-24T08:00:02.000Z',
  switchCreatedAt: '2026-11-24T08:00:04.000Z',
  structureAdmittedAt: '2026-11-24T08:00:20.000Z',
  marketStartAt: '2026-12-07T23:00:00.000Z',
  structureEffectiveAt: '2026-12-19T23:00:00.000Z',
  registrationInstants: [physicalEnd],
}
const admission = {
  admitted: true, mode: 'native', original_realtime_ms: Date.parse(initial),
  deadline_monotonic_ms: 60_000,
}

function clock(realtime: string | number, monotonic: number): ReadingClockSnapshot {
  const time = typeof realtime === 'string' ? Date.parse(realtime) : realtime
  return {
    os: { realtime_ms: time, monotonic_ms: monotonic },
    node: { realtime_ms: time, monotonic_ms: monotonic },
    postgres_new_transaction: {
      now_ms: time, statement_ms: time, clock_ms: time, system_identifier: '712345678900001',
      postmaster_started_at: '2026-11-24T08:00:01.000Z',
    },
  }
}

function observedAt(wire: string, instant: string) {
  // This is a model of an insert receipt for the same raw bytes, not a native
  // receipt. The production parser and current 25-A-5 policy run unmodified.
  return retainDeclaredUtiltsReceipt({
    id: sourceId, company_id: companyId, environment: 'test', direction: 'inbound',
    message_code: 'E66', message_family: 'UTILTS', message_standard: 'edifact',
    message_version: 'E5SE5A', application_reference: '23-DDQ-E66-T', raw_payload: wire,
    parsed_payload: {}, business_match_status: 'matched', created_at: instant, message_received_at: instant,
  } as unknown as EdielMessageRow)
}

function validateAt(wire: string, instant: string) {
  const source = observedAt(wire, instant)
  const policy = resolveCanonicalMessagePolicy(source)!
  expect(policy.guide.guideRevision).toBe('25-A-5')
  return runUtiltsRuntimeForMessage(source, { canonicalPolicy: policy })
}

type ReadingWire = (scope: object, changeMinute: string, side: 'old' | 'new', meter: string, registers: readonly string[]) => { wire: string }

function actualZ10Wire(): ReadingWire {
  // Execute only the exact pure wire producer. Importing its native test file
  // would run the test suite's external fixture setup.
  const file = resolve(process.env.GRIDEX_READING_PHASE_REPO ?? process.cwd(), 'scripts/ediel-at-z10m-supplier-acceptance-native.test.ts')
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readingWire')
  if (!declaration) throw Error('z10m_physical_wire_source_missing')
  const { outputText, diagnostics } = ts.transpileModule(declaration.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true })
  expect(diagnostics).toEqual([])
  return new Function('randomUUID', outputText + '\nreturn readingWire')(randomUUID) as ReadingWire
}

const before = clock(ordinary, 30_000)
const plan = (registrations = chronology.registrationInstants) =>
  planCompletedReadingPhase({ ...chronology, registrationInstants: registrations }, admission, before)
const controllerReceipt = (target: number) => ({ target_realtime_ms: target, actual_realtime_ms: target, shared_restore_lock: true })

describe('authenticated GitHub clock reference', () => {
  it('seals the credential away from children and keeps exact-origin, finite, fail-closed sampling', () => {
    const root = resolve(process.env.GRIDEX_READING_PHASE_REPO ?? process.cwd())
    const folder = mkdtempSync(resolve(tmpdir(), 'gridex-clock-reference-'))
    const token = 'synthetic.token-for-controller'
    try {
      const template = resolve(root, '.github/workflows/ediel-z03c-supplier-boundary-native.yml')
      const control = resolve(folder, 'control.py')
      execFileSync('python3', [resolve(root, 'scripts/helpers/compose-ediel-completed-reading-clock.py'),
        '--template', template, '--suite', 'fg', '--output', control])
      execFileSync('python3', ['-c', String.raw`
import ast, email.utils, io, os, re, subprocess, sys, urllib.error, urllib.request
from types import SimpleNamespace
from unittest.mock import patch

source = ast.parse(open(sys.argv[1]).read())
required = {'read_reference_token', 'trusted_reference', 'TrustedReferenceNoRedirect'}
instructions = [node for node in source.body if getattr(node, 'name', None) in required]
assert len(instructions) == len(required)
exec(compile(ast.Module(body=instructions, type_ignores=[]), sys.argv[1], 'exec'))
reference_token = read_reference_token()
assert reference_token == 'synthetic.token-for-controller'
assert subprocess.check_output([sys.executable, '-c',
    "import os, sys; assert 'GRIDEX_CLOCK_REFERENCE_TOKEN' not in os.environ; assert not sys.stdin.read()"]) == b''
try:
    read_reference_token()
except RuntimeError as error:
    assert str(error) == 'completed_reading_reference_token_required'
else:
    raise AssertionError('a missing credential was accepted')

class SimulatedTime:
    current = 0
    def monotonic(self): return self.current
    def time(self): return 1780000000 + self.current
    def sleep(self, seconds): self.current += seconds

class Opener:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.samples = []
    def open(self, request, timeout):
        assert request.full_url.startswith('https://api.github.com/?gridex_completed_reading_clock_nonce=')
        assert request.get_method() == 'HEAD'
        assert request.get_header('Authorization') == 'Bearer ' + reference_token
        assert 0 < timeout <= 15
        self.samples.append((request.full_url, timeout))
        status, headers = next(self.responses)
        if status != 200:
            raise urllib.error.HTTPError(request.full_url, status, 'synthetic', headers, io.BytesIO())
        from contextlib import nullcontext
        return nullcontext(SimpleNamespace(headers=headers))

def sample(responses, expected_error=None, expected_attempts=1):
    global time
    time = SimulatedTime()
    opener = Opener(responses)
    def build(handler):
        assert isinstance(handler, TrustedReferenceNoRedirect)
        assert handler.redirect_request(None, None, 302, '', {}, 'https://example.invalid') is None
        return opener
    with patch.object(urllib.request, 'build_opener', build):
        try:
            accepted = trusted_reference()
        except (RuntimeError, urllib.error.HTTPError) as error:
            assert str(error) == expected_error
        else:
            assert expected_error is None
            assert abs(accepted - time.time()) <= 30
    assert len(opener.samples) == expected_attempts
    assert len({url for url, _ in opener.samples}) == expected_attempts

fresh = {'Date': email.utils.formatdate(1780000000, usegmt=True)}
stale = {'Date': email.utils.formatdate(1779999900, usegmt=True)}
sample([(200, fresh)])
sample([(403, fresh)], 'HTTP Error 403: synthetic')
sample([(403, {**fresh, 'Retry-After':'1'}), (200, stale), (200, fresh)], expected_attempts=3)
sample([(429, {**fresh, 'Retry-After':'60'})], 'HTTP Error 429: synthetic')
sample([(200, stale)] * 3, 'completed_reading_trusted_normal_reference_skew', 3)
`, control], { input: token + '\n' })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('completed E66 native clock phase', () => {
  it('uses the exact F wire with unchanged chronology and crosses the current real guide boundary in the model', () => {
    const wire = z06fNativeReadingWire(scope)
    const registration = readCompletedReadingRegistration(wire)
    expect(registration).toBe(physicalEnd)
    const phase = plan([registration])
    const after = clock(phase.targetRealtimeMs, 31_000)
    const observed = new Date(phase.targetRealtimeMs).toISOString()
    verifyCompletedReadingPhase(phase, controllerReceipt(phase.targetRealtimeMs), after, new Date(observed).toUTCString())
    expect(validateAt(wire, ordinary).validation.issues).toContainEqual(expect.objectContaining({
      code: 'UTILTS_E66_REGISTRATION_DATE_INVALID', aperakErcCode: '42', aperakFieldCode: '512',
    }))
    const runtime = validateAt(wire, observed)
    expect(runtime.transactionDispositions).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
    expect(runtime.facts.transactions[0].quantities.filter(quantity => quantity.qualifier === '136').map(quantity => quantity.value)).toEqual([1000])
  })

  it('advances past the actual registration of the next-day Z06F reading', () => {
    const original = readCompletedReadingRegistration(z06fNativeReadingWire(scope))
    const nextDay = readCompletedReadingRegistration(z06fNativeReadingWire(scope, { date: 'next-day' }))
    expect(Date.parse(nextDay) - Date.parse(original)).toBe(86_400_000)
    const phase = plan([nextDay])
    expect(phase.latestRegistrationMs).toBe(Date.parse(nextDay))
    expect(phase.targetRealtimeMs).toBeGreaterThan(phase.latestRegistrationMs)
    expect(phase.targetRealtimeMs - plan([original]).targetRealtimeMs).toBe(86_400_000)
  })

  it('uses the latest registration for both exact Z10M reading wires while retaining both energy volumes', () => {
    const producer = actualZ10Wire()
    const change = '202612200000'
    const old = producer(scope, change, 'old', 'METER-1', ['101']).wire
    const fresh = producer(scope, change, 'new', 'NEW-METER', ['101', '102']).wire
    const registrations = [old, fresh].map(readCompletedReadingRegistration)
    expect(registrations).toEqual([chronology.structureEffectiveAt, physicalEnd])
    expect(localEdifactDateTimeToUtc('202612210000', { raw: '+0100', offsetMinutes: 60, format: '406' })).toBeNull()
    const phase = plan(registrations)
    const observed = new Date(phase.targetRealtimeMs).toISOString()
    verifyCompletedReadingPhase(phase, controllerReceipt(phase.targetRealtimeMs), clock(phase.targetRealtimeMs, 31_000), new Date(observed).toUTCString())
    for (const [wire, expected] of [[old, 500], [fresh, 1000]] as const) {
      expect(validateAt(wire, ordinary).transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
      const runtime = validateAt(wire, observed)
      expect(runtime.transactionDispositions, JSON.stringify(runtime.validation.issues)).toMatchObject([{ disposition: 'accepted', responseType: 'positive_aperak' }])
      expect(runtime.facts.transactions[0].quantities.filter(quantity => quantity.qualifier === '136').map(quantity => quantity.value)).toEqual([expected])
    }
  })

  it('rejects retroactive supply and a phase requiring movement beyond the existing 35-day cap', () => {
    expect(() => planCompletedReadingPhase({ ...chronology, marketStartAt: '2026-11-09T00:00:00.000Z' }, admission, before))
      .toThrow('reading_clock_prospective_supply_required')
    expect(() => plan(['2026-12-30T00:00:00.000Z'])).toThrow('reading_clock_target_outside_owned_epoch')
    expect(() => plan(['2026-11-31T00:00:00.000Z'])).toThrow('reading_clock_absolute_instant_required')
    expect(() => readCompletedReadingRegistration("SEQ++1'DTM+597:202612210000:203'")).toThrow('reading_clock_physical_registration_required')
  })

  it('rejects a stale epoch or a controller that has moved too early', () => {
    expect(() => planCompletedReadingPhase(chronology, { ...admission, deadline_monotonic_ms: 30_000 }, before))
      .toThrow('reading_clock_owned_epoch_required')
    const phase = plan()
    const early = phase.latestRegistrationMs - 250
    expect(() => verifyCompletedReadingPhase(phase, controllerReceipt(phase.targetRealtimeMs), clock(early, 31_000), new Date(early).toUTCString()))
      .toThrow('reading_clock_after_phase_not_qualified')
    const unrelatedClock = phase.targetRealtimeMs + 60_000
    expect(() => verifyCompletedReadingPhase(phase, controllerReceipt(phase.targetRealtimeMs), clock(unrelatedClock, 31_000), new Date(unrelatedClock).toUTCString()))
      .toThrow('reading_clock_after_phase_not_qualified')
  })

  it('rejects a replaced backend or external/ordinary-clock Auth proxy after movement', () => {
    const phase = plan()
    const after = clock(phase.targetRealtimeMs, 31_000)
    const receipt = controllerReceipt(phase.targetRealtimeMs)
    const swapped = { ...after, postgres_new_transaction: { ...after.postgres_new_transaction, system_identifier: '812345678900002' } }
    expect(() => verifyCompletedReadingPhase(phase, receipt, swapped, new Date(phase.targetRealtimeMs).toUTCString()))
      .toThrow('reading_clock_after_phase_not_qualified')
    expect(() => verifyCompletedReadingPhase(phase, receipt, after, new Date(ordinary).toUTCString()))
      .toThrow('reading_clock_after_phase_not_qualified')
  })
})
