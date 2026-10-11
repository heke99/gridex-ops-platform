// Component-only prospective Z10/M source birth. Parser/intake are real;
// catalog/database ports are declared. No whole M or native approval.
import { beforeEach, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { resolveMeterChangeSourceBirthProfile } from '@/lib/inbound-mail/meterChangeSourceBirthProfile'
import { guideOrderedFixtureRaw as orderedFixture } from './helpers/prodatGuideOrderedFixture'
import { z10 } from './fixtures/prodat-identity'
import { characteristic, line, type Parts } from './fixtures/prodat-register'
import { actor, company, inboundReceptionBoundary, mailId, newId, oldId, parseId, receivedAt } from './fixtures/inbound-reception-db'

const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), catalog: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: io.catalog }))

// Retained mail is in test scope; put the actual UNB test indicator on the wire.
const guideOrderedFixtureRaw = (...args: Parameters<typeof orderedFixture>) => orderedFixture(...args)
  .replace("23-DDQ-PRODAT'", "23-DDQ-PRODAT++++1'")
  .replace('23-DDQ-PRODAT~', '23-DDQ-PRODAT;;;;1~')
const raw = guideOrderedFixtureRaw(z10(), 'Z10')
const parse = (wire = raw) => {
  const parsed = parseInboundEmailContent({ attachmentText: wire })
  if (!parsed) throw new Error('actual_parser_required')
  return parsed
}
const evidence = {
  rulePackId: 'declared-pack', messageProfileId: 'declared-profile',
  databaseProfileKey: 'PRODAT:Z10:M:26.A:r3', profileKey: 'semantic-alias',
  originalVersion: '26.A:r3', sourceHash: 'a'.repeat(64), unhAssociationCode: 'E2SE6A',
  originalSnapshot: { rulePack: { id: 'declared-pack' }, messageProfile: { id: 'declared-profile' }, guideSources: [] },
}
let db: ReturnType<typeof inboundReceptionBoundary>
const input = (wire = raw) => ({ companyId: company, actorUserId: actor, environment: 'test',
  inboundEmailMessageId: mailId, parseResultId: parseId, parsed: parse(wire) })

beforeEach(() => {
  vi.clearAllMocks()
  db = inboundReceptionBoundary(parse())
  db.state.existing = false
  io.from.mockImplementation(db.from)
  io.rpc.mockImplementation(db.rpc)
  io.catalog.mockReset().mockImplementation(async () => {
    expect(db.writes('ediel_messages')).toEqual([])
    return evidence
  })
})

it('binds the physical Z10 version and exact original catalog witness before first INSERT', async () => {
  expect(await createInboundEdielMessage(input())).toBe(newId)
  const writes = db.writes('ediel_messages')
  expect(writes).toHaveLength(1)
  expect(writes[0].payload).toMatchObject({ raw_payload: raw, message_version: 'E2SE6A',
    message_received_at: receivedAt, canonical_rule_pack_id: evidence.rulePackId,
    rule_profile_key: evidence.databaseProfileKey, rule_profile_version_id: evidence.messageProfileId,
    rule_profile_version: evidence.originalVersion, rule_pack_checksum: evidence.sourceHash,
    rule_pack_snapshot: { ...evidence.originalSnapshot, profileKey: evidence.databaseProfileKey,
      profileVersionId: evidence.messageProfileId, version: evidence.originalVersion, checksum: evidence.sourceHash },
  })
  expect(io.catalog).toHaveBeenCalledExactlyOnceWith({ family: 'PRODAT', messageCode: 'Z10',
    transactionSubtype: 'E58', applicationReference: '23-DDQ-PRODAT', direction: 'inbound', businessDate: '2026-09-21' })
  expect(writes[0].payload).not.toHaveProperty('execution_context_snapshot')
  expect(writes[0].payload).not.toHaveProperty('prodatDependentFacts')
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission', 'ediel_record_inbound_reception_v1'])
  expect(db.writes('outbound_requests')).toEqual([])
})

it('refuses caller application disagreement before catalog selection or source INSERT', async () => {
  const value = input()
  value.parsed.applicationReference = 'FORGED'
  await expect(createInboundEdielMessage(value)).rejects.toThrow('meter_change_birth_source_scope_mismatch')
  expect(io.catalog).not.toHaveBeenCalled()
  expect(db.writes('ediel_messages')).toEqual([])
})

it('refuses retained production scope for a physical test interchange before catalog or INSERT', async () => {
  db.state.environment = 'production'
  await expect(createInboundEdielMessage({ ...input(), environment: 'production' })).rejects.toThrow('meter_change_birth_source_scope_mismatch')
  expect(io.catalog).not.toHaveBeenCalled()
  expect(db.writes('ediel_messages')).toEqual([])
})

it('binds a matching physical production interchange in retained production scope', async () => {
  const wire = raw.replace('23-DDQ-PRODAT++++1', '23-DDQ-PRODAT')
  db = inboundReceptionBoundary(parse(wire))
  io.from.mockImplementation(db.from)
  io.rpc.mockImplementation(db.rpc)
  db.state.existing = false
  db.state.environment = 'production'
  await expect(createInboundEdielMessage({ ...input(wire), environment: 'production' })).resolves.toBe(newId)
  expect(db.writes('ediel_messages')[0].payload).toMatchObject({ environment: 'production',
    application_reference: '23-DDQ-PRODAT', message_version: 'E2SE6A', rule_profile_key: evidence.databaseProfileKey })
})

it('does not reselect or patch an existing immutable original on replay', async () => {
  db.state.existing = true
  const original = structuredClone(db.state.original)
  expect(await createInboundEdielMessage(input())).toBe(oldId)
  expect(io.catalog).not.toHaveBeenCalled()
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.original).toEqual(original)
})

it('refuses a denied actor before reading optional parsed input or selecting a profile', async () => {
  db.state.permission = false
  const value = input()
  Object.defineProperty(value, 'parsed', { get: () => { throw new Error('optional_source_read_too_early') } })
  await expect(createInboundEdielMessage(value)).rejects.not.toThrow('optional_source_read_too_early')
  expect(io.catalog).not.toHaveBeenCalled()
  expect(db.writes('ediel_messages')).toEqual([])
})

it('propagates catalog refusal before any INSERT or reception', async () => {
  io.catalog.mockRejectedValue(new Error('canonical_rule_pack_evidence_count:0'))
  await expect(createInboundEdielMessage(input())).rejects.toThrow('canonical_rule_pack_evidence_count:0')
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})

it('preserves all PostgreSQL receipt microseconds at Z10 source birth', async () => {
  const precise = '2026-09-21T11:00:00.123456+00:00'
  io.from.mockImplementation((table: string) => {
    const query = db.from(table)
    if (table === 'inbound_email_messages') {
      const original = query.maybeSingle
      query.maybeSingle = async () => {
        const result = await original()
        return { ...result, data: result.data && { ...result.data, received_at: precise } }
      }
    }
    return query
  })
  expect(await createInboundEdielMessage(input())).toBe(newId)
  expect(db.writes('ediel_messages')[0].payload?.message_received_at).toBe(precise)
})

const point = '735123456789012345'
const second = z10().slice(2).map(part => part[0] === 'LIN' ? line('2', '735123456789012346', undefined, '9') : part)
const repeated: Parts[] = [...z10().slice(0, 2), line('1', point, '1', '9'), ...z10().slice(3), line('2', point, '2', '9')]
it.each([
  ['independent M objects', guideOrderedFixtureRaw([...z10(), ...second], 'Z10')],
  ['repeated registers inheriting only their own first reason', guideOrderedFixtureRaw(repeated, 'Z10')],
  ['released delimiters and custom UNA', guideOrderedFixtureRaw(z10(), 'Z10', ['*', ';', '!', '~'])],
])('selects the physical profile for %s', async (_name, wire) => {
  expect(await resolveMeterChangeSourceBirthProfile({ applicationReference: '23-DDQ-PRODAT', environment: 'test', rawPayload: wire, receivedAt })).toMatchObject({
    message_version: 'E2SE6A', message_received_at: receivedAt, rule_profile_key: evidence.databaseProfileKey,
  })
  expect(io.catalog).toHaveBeenCalledOnce()
})

it.each([
  ['missing own second-object reason', guideOrderedFixtureRaw([...z10(), line('2', '735123456789012346', undefined, '9')], 'Z10')],
  ['mixed object reasons', guideOrderedFixtureRaw([...z10(), ...second], 'Z10').replace('CAV+E58', 'CAV+Z22')],
  ['header reason', guideOrderedFixtureRaw([...characteristic('Z13', 'E58'), ...z10()], 'Z10')],
  ['later repeated-register reason', guideOrderedFixtureRaw([...repeated, ...characteristic('Z13', 'E58')], 'Z10')],
  ['duplicate own reason', guideOrderedFixtureRaw([...z10(), ...characteristic('Z13', 'E58')], 'Z10')],
  ['padded reason qualifier', raw.replace('CCI++Z13', 'CCI++ Z13')],
  ['padded physical application', raw.replace('23-DDQ-PRODAT', ' 23-DDQ-PRODAT')],
  ['compound physical application', raw.replace('23-DDQ-PRODAT', '23-DDQ-PRODAT:EXTRA')],
  ['padded physical code', raw.replace('BGM+Z10', 'BGM+ Z10')],
  ['nonstandard test indicator', raw.replace('23-DDQ-PRODAT++++1', '23-DDQ-PRODAT++++2')],
  ['foreign application', raw.replace('23-DDQ-PRODAT', '27-DDQ-PRODAT')],
  ['foreign association', raw.replace('E2SE6A', 'E2SE5A')],
  ['foreign UNSM release', raw.replace('PRODAT:D:97A', 'PRODAT:D:99B')],
  ['foreign physical family', raw.replace('PRODAT:D:97A', 'XPRODAT:D:97A')],
  ['invalid line sequence', raw.replace('LIN+1++', 'LIN+3++')],
  ['invalid agency', raw.replace(`${point}:::9`, `${point}:::260`)],
  ['mismatched envelope reference', raw.replace('UNZ+1+I', 'UNZ+1+OTHER')],
  ['mismatched segment count', raw.replace('UNT+21+M', 'UNT+20+M')],
  ['duplicate message', raw.replace("UNH+M+PRODAT:D:97A:UN:E2SE6A'", "UNH+M+PRODAT:D:97A:UN:E2SE6A'UNH+SECOND+PRODAT:D:97A:UN:E2SE6A'")],
])('does not grant a prospective M witness to %s', async (_name, wire) => {
  expect(await resolveMeterChangeSourceBirthProfile({ applicationReference: '23-DDQ-PRODAT', environment: 'test', rawPayload: wire, receivedAt })).toBeNull()
  expect(io.catalog).not.toHaveBeenCalled()
})

it.each(['2026-02-30T11:00:00Z', '2026-09-21T11:00:00', '2026-09-21T11:00:00+99:00'])('refuses invalid exact receipt %s', async clock => {
  await expect(resolveMeterChangeSourceBirthProfile({ applicationReference: '23-DDQ-PRODAT', environment: 'test', rawPayload: raw, receivedAt: clock })).rejects.toThrow('meter_change_birth_receipt_clock_invalid')
  expect(io.catalog).not.toHaveBeenCalled()
})

it.each([
  ['2026-06-30T22:00:00.123456Z', '2026-07-01'],
  ['2026-10-31T23:00:00.123456+00:00', '2026-11-01'],
])('uses the retained Stockholm date while preserving exact instant %s', async (clock, date) => {
  expect(await resolveMeterChangeSourceBirthProfile({ applicationReference: '23-DDQ-PRODAT', environment: 'test', rawPayload: raw, receivedAt: clock })).toMatchObject({ message_received_at: clock })
  expect(io.catalog).toHaveBeenCalledWith(expect.objectContaining({ businessDate: date }))
})

it.each([
  ['association mismatch', { ...evidence, unhAssociationCode: 'E2SE5A' }, 'meter_change_birth_association_mismatch'],
  ['missing actual profile key', { ...evidence, databaseProfileKey: undefined }, 'meter_change_birth_database_profile_key_missing'],
])('refuses selected catalog %s before source birth', async (_name, selected, reason) => {
  io.catalog.mockResolvedValue(selected)
  await expect(createInboundEdielMessage(input())).rejects.toThrow(reason)
  expect(db.writes('ediel_messages')).toEqual([])
  expect(db.state.rpcCalls.map(call => call.name)).toEqual(['gridex_actor_has_company_permission'])
})

it('pins physical version, original bytes and retained clock while catalog selection is pending', async () => {
  let release!: (value: typeof evidence) => void
  let started!: () => void
  const selecting = new Promise<void>(resolve => { started = resolve })
  io.catalog.mockImplementation(() => { started(); return new Promise(resolve => { release = resolve }) })
  const value = input()
  // A caller version alias must not supply the physical source version.
  value.parsed.messageTypeVersion.associationAssignedCode = 'FORGED'
  const pending = createInboundEdielMessage(value)
  await selecting
  value.parsed.rawPayload = 'FORGED'
  value.parsed.messageTypeVersion.associationAssignedCode = 'LATER-FORGED'
  release(evidence)
  expect(await pending).toBe(newId)
  expect(db.writes('ediel_messages')[0].payload).toMatchObject({ raw_payload: raw, message_version: 'E2SE6A', message_received_at: receivedAt })
})
