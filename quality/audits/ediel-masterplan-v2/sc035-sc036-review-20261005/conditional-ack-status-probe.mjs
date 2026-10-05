// Review-only conditional probe. Reuses the existing SC055 finite transport and
// unchanged historical ACK SQL capture; does not register a second harness.
// It starts from a declared confirmed request, NOT from real Z04 registration.
// A result cannot establish current native/source admission or whole SC036.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '.')
const sourcePath = resolve(root, '__tests__/ediel-sc-055-wrong-legal-ack-isolation.test.ts')
const bytes = readFileSync(sourcePath, 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex')
const prefix = bytes.split("describe('SC-055 wrong legal APERAK")[0]
assert.equal(bytes.split("describe('SC-055 wrong legal APERAK").length, 2)
let adapted = prefix
const replaceOnce = (before, after) => {
  assert.equal(adapted.split(before).length, 2, before)
  adapted = adapted.replace(before, () => after)
}
replaceOnce('// masterplan: SC-055', '// Review-only probe; deliberately no masterplan approval tags.')
replaceOnce("'customer_case_events', 'audit_logs'].includes(this.table)", "'customer_case_events', 'audit_logs', 'outbound_requests', 'outbound_dispatch_events', 'supplier_switch_events'].includes(this.table)")
const sourceStart = adapted.indexOf('function sourceRaw(')
const messageStart = adapted.indexOf('function message(', sourceStart)
assert.ok(sourceStart > 0 && messageStart > sourceStart)
adapted = adapted.slice(0, sourceStart) + `
function sourceRaw(document = 'SC036-SOURCE-D', sender = '12345', receiver = '54321') {
  return wire('PRODAT:D:96A:UN:E2SE6A', [
    'BGM+Z03+' + document + '+9+AB', 'NAD+FR+' + sender + ':160:SVK',
    'NAD+DO+' + receiver + ':160:SVK', 'LIN+1', 'RFF+LI:P-A', 'LIN+2', 'RFF+LI:P-B',
  ])
}
function ackRaw(document = 'SC036-SOURCE-D', sender = '54321', receiver = '12345', mixed = false) {
  return wire('APERAK:D:96A:UN:E2SE6A', [
    'BGM+12+SC036-ACK-D+34', 'RFF+ACW:' + document,
    'NAD+FR+' + sender + ':160:SVK', 'NAD+DO+' + receiver + ':160:SVK',
    'ERC+100::260', 'RFF+LI:P-A', 'ERC+' + (mixed ? '42' : '100') + '::260', 'RFF+LI:P-B',
  ], true)
}
` + adapted.slice(messageStart)
replaceOnce("applicationReference: '23-DDQ-E66-T'", "applicationReference: '23-DDQ-PRODAT'")
replaceOnce("message_family: direction === 'inbound' ? 'APERAK' : 'UTILTS', message_code: direction === 'inbound' ? '312' : 'E66'", "message_family: direction === 'inbound' ? 'APERAK' : 'PRODAT', message_code: direction === 'inbound' ? '12' : 'Z03'")

const probe = `
it('conditional real ACK consumer preserves confirmed request with a mixed receipt, but regresses it after a final positive receipt', async () => {
  const probe = await captureExistingSqlRunner()
  expect(probe.count).toBe(18)
  const { db } = probe
  await db.exec('ALTER TABLE public.ediel_messages ADD COLUMN outbound_request_id uuid')
  const request = '12345678-4444-4444-8444-444444444444'
  const observed: unknown[] = []
  for (const mixed of [true, false]) {
    await db.exec('BEGIN')
    try {
      port.tables.ediel_messages = [message(SOURCE, COMPANY, 'outbound', sourceRaw()) as unknown as Row, message(ACK, COMPANY, 'inbound', ackRaw(undefined, undefined, undefined, mixed)) as unknown as Row]
      const source = port.tables.ediel_messages[0]
      source.outbound_request_id = request
      port.candidate = structuredClone(source) as unknown as EdielMessageRow
      port.tables.outbound_requests = [{id: request, company_id: COMPANY, status: 'confirmed', sent_at: '2026-09-30T11:00:00Z', response_payload: {z04: 'declared-before-state'}, attempts_count: 1}]
      port.tables.outbound_dispatch_events = []
      port.tables.customer_cases = []
      port.calls = []; port.writes = []
      await db.query(\`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash,outbound_request_id) values($1,$2,'test','outbound','PRODAT','Z03',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4)\`, [SOURCE, COMPANY, sourceRaw(), request])
      await db.query(\`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at,status) values($1,$2,'test','inbound','APERAK','12',$3,'2026-09-30T12:00:00Z','received')\`, [ACK, COMPANY, ackRaw(undefined, undefined, undefined, mixed)])
      // Exact inherited fixture admission. No claim of current protected authority.
      await db.query(\`insert into gridex_received_sources.validation_assessments select $1,id,company_id,environment,immutable_payload_hash,'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null from public.ediel_messages where id=$1\`, [ACK])
      port.apply = async args => {
        await db.exec('set role service_role')
        try {
          const receipt = (await db.query<{result: Row}>('select public.gridex_apply_inbound_ack_source_v1($1,$2,$3,$4,$5) result', [args.p_company_id, args.p_environment, args.p_ack_message_id, args.p_source_message_id, args.p_actor_user_id])).rows[0].result
          Object.assign(source, receipt.sourceMessage)
          return receipt
        } finally { await db.exec('reset role') }
      }
      const result = await processInboundAckMessage({actorUserId: ACTOR, message: incoming()})
      expect(result).toMatchObject({finalAckReached: true, sourceAccepted: !mixed})
      // Observation oracle, not a passing normative preservation assertion.
      expect(port.tables.outbound_requests[0].status).toBe(mixed ? 'confirmed' : 'acknowledged')
      expect(port.tables.outbound_requests[0].response_payload).toMatchObject({z04: 'declared-before-state'})
      observed.push({mixed, finalAckReached: result.finalAckReached, sourceAccepted: result.sourceAccepted, requestStatus: port.tables.outbound_requests[0].status, requestWrites: port.writes.filter(w => w.table === 'outbound_requests')})
      if (process.env.SC036_ASSERT_PRESERVATION === '1') {
        expect(port.tables.outbound_requests[0].status, 'normative confirmed-status preservation at this declared boundary').toBe('confirmed')
      }
    } finally { await db.exec('ROLLBACK') }
  }
  console.log('SC036_CONDITIONAL_OBSERVATION ' + JSON.stringify(observed))
}, 30000)
`
const temporary = resolve(root, '__tests__/.sc036-review-conditional.test.ts')
writeFileSync(temporary, adapted + probe, { flag: 'wx' })
try {
  console.log('SC036_REUSED_FIXTURE_SHA256 ' + hash(bytes))
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', temporary, '--reporter=default'], { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temporary)
  assert.equal(hash(readFileSync(sourcePath, 'utf8')), hash(bytes))
}
