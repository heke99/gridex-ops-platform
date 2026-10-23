// reality-defects: F113
// FINDINGS F113 (F111 side finding 1 and the open F101 variant). In the registry model (F41) grid owners are
// platform-shared rows (grid_owners.company_id IS NULL) that the product assigns to the tenant's own sites and points.
// Two installed bodies still required a tenant-owned grid owner:
//   * gridex_prodat_object_batch.require_wire_projection_v1 (via require_plan_v1, the admin's masterdata approval of a
//     PRODAT object batch) looked up the wire grid area (RFF+Z05) by owner_code among the tenant's own rows only, so a
//     command whose site/metering point names the shared grid owner failed with
//     prodat_object_batch_wire_grid_owner_required;
//   * gridex_regulated_supply.scope_v1 required grid_owners.company_id = c, so a shared grid owner gave a NULL scope.
// 20261023198000 applies the canonical rule: the tenant's own row, else the shared row the tenant's own records name;
// never another tenant's row, and ambiguity is never guessed.
//
// Native proof on the owned local Supabase with synthetic tenants only. The PRODAT Z04 source, its canonical assessment
// and facets are produced by the production chain (as in ediel-prodat-object-batch-current-source-native) for a fresh
// synthetic tenant. Every case then calls the installed function inside ONE transaction that is always rolled back:
// while the installed body still predates F113 the old body is shown first, then the migration body is applied inside
// the same transaction, so the world database (and its function bodies) is never changed.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-f113-shared-grid-owner-object-batch-scope-native.config.ts
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getEdielMessageById } from '@/lib/ediel/db'
import { resolveCanonicalRuntimeDecisionWithRegistry } from '@/lib/ediel/core/runtimeDecision'
import { recordReceivedSourceValidation } from '@/lib/ediel/core/receivedSourceValidationLedger'
import { captureFreshEdielSourceRulePackEvidence } from '@/lib/ediel/core/sourceRulePackEvidence'
import { createInboundEdielMessage } from '@/lib/inbound-mail/inboundStatusUpdater'
import { matchMeteringPointForInbound, matchOutboundRequestForInbound } from '@/lib/inbound-mail/inboundMatcher'
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { seedOriginalMailboxNative } from './helpers/originalMailboxNative'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
// Both F113 bodies are proven from the held proposal; only its scope_v1 part ships as migration 20261023198000
// (require_wire_projection_v1 is DB-05/SC-031 protected and needs an owner handoff).
const MIGRATION = resolve(__dirname, '../quality/audits/live-chain-20261015/proposals/F113-object-batch-and-scope-shared-grid-owner.sql')
const SHIPPED = resolve(__dirname, '../supabase/migrations/20261023198000_regulated_supply_scope_shared_grid_owner.sql')
const WIRE_FN = `'gridex_prodat_object_batch.require_wire_projection_v1(text,jsonb,jsonb,text,uuid)'::regprocedure`
const SCOPE_FN = `'gridex_regulated_supply.scope_v1(uuid,jsonb)'::regprocedure`
const AREA = 'TES' // the fixture's wire grid area (RFF+Z05) and the owner_code of its grid owner row

function psql<T>(statement: string, timeout = 60_000): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout, maxBuffer: 2_000_000 }).trim()
  return (out ? JSON.parse(out) : undefined) as T
}
const installed = () => psql<{ wire: boolean; scope: boolean; wireSrc: string; scopeSrc: string }>(`SELECT jsonb_build_object(
  'wire',(SELECT position('company_id IS NULL AND owner_code=area' in prosrc)>0 FROM pg_proc WHERE oid=${WIRE_FN}),
  'scope',(SELECT position('(company_id=c OR company_id IS NULL)' in prosrc)>0 FROM pg_proc WHERE oid=${SCOPE_FN}),
  'wireSrc',(SELECT md5(prosrc) FROM pg_proc WHERE oid=${WIRE_FN}),'scopeSrc',(SELECT md5(prosrc) FROM pg_proc WHERE oid=${SCOPE_FN}))`)
const migrationBody = () => {
  const block = readFileSync(MIGRATION, 'utf8').match(/do \$f113\$[\s\S]*?\$f113\$;/)?.[0]
  if (!block) throw Error('f113_migration_block_required')
  return block
}
type Outcome = { value?: unknown; error?: string }
type Replay = { old: Outcome | null; fixed: Outcome }
/**
 * Runs `statement` (which assigns the jsonb `r`) in one rolled-back transaction after `setup`: first against the old
 * body when it is still installed, then against the F113 body applied inside the same transaction.
 */
function replay(statement: string, setup: string, fixedInstalled: boolean): Replay {
  const attempt = (label: string) => `DO $t$ DECLARE r jsonb; BEGIN ${statement}
    INSERT INTO pg_temp.f113_out VALUES(${literal(label)},jsonb_build_object('value',r));
    EXCEPTION WHEN OTHERS THEN INSERT INTO pg_temp.f113_out VALUES(${literal(label)},jsonb_build_object('error',SQLERRM)); END $t$;`
  return psql<Replay>(`BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TEMP TABLE f113_out(k text, v jsonb) ON COMMIT DROP;
${setup}
${fixedInstalled ? '' : `${attempt('old')}\n${migrationBody()}`}
${attempt('fixed')}
SELECT jsonb_build_object('old',(SELECT v FROM pg_temp.f113_out WHERE k='old'),'fixed',(SELECT v FROM pg_temp.f113_out WHERE k='fixed'));
ROLLBACK;`)
}
const sharedOwner = (id: string, area = AREA) => `INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code)
  VALUES(${literal(id)},NULL,${literal(`F113 synthetic shared ${id.slice(0, 8)}`)},${literal(`73${Date.now() % 1e11}`)},'test',true,'active',${literal(area)});`
const otherTenant = (id: string) => `INSERT INTO public.companies(id,name,status) VALUES(${literal(id)},'F113 other tenant synthetic','active');`

/** A real Z04 object for a fresh synthetic tenant, through the production source/assessment chain. */
async function prodatObjectSource() {
  const base = await seedNormalSwitchNativeFixture({ deferOriginal: true })
  const doc = 'F' + randomUUID().replaceAll('-', '').slice(0, 13).toUpperCase()
  const point = 'A' + randomUUID().replaceAll('-', '').slice(0, 23).toUpperCase()
  const segments = [`UNH+${doc}+PRODAT:D:97A:UN:E2SE6A`, `BGM+Z04+${doc}+9+AB`, 'DTM+137:202610011200:203', 'DTM+ZZZ:1:805', `NAD+FR+${base.receiver}:160:SVK+++++++SE`, `NAD+DO+${base.sender}:160:SVK+++++++SE`,
    `LIN+1++${point}:::89`, 'DTM+92:202611010000:203', 'DTM+354:15:806', 'QTY+31:100:KWH', 'CCI++Z13', 'CAV+Z22', 'CCI++Z04', 'CAV+Z03', 'CCI++Z07', 'CAV+Z12', 'CCI++Z12', 'CAV+:::W', 'CCI++Z15', 'CAV+Z32',
    'CCI++Z14', 'CAV+:::L917:8716867000030', 'CCI++Z02', 'CAV+:::1', 'CCI++Z05', 'CAV+:::6', 'CCI++Z16', 'CAV+:::111', 'RFF+MG:METER-0', `RFF+Z05:${AREA}`, 'RFF+LI:CASE-0',
    'NAD+UD+CUSTOMER0::89++Synthetic F113+Testgatan+Teststad++12345+SE', `NAD+IT+${point}::89+++Testgatan+Teststad++12345+SE`, `NAD+Z02+${base.brpEdielId}:160:SVK`]
  const wire = `UNA:+.? 'UNB+UNOC:3+${base.receiver}:14+${base.sender}:14+261001:1200+${doc}++23-DDQ-PRODAT++1++1'${segments.join("'")}'UNT+${segments.length + 1}+${doc}'UNZ+1+${doc}'`
  const mail = await seedOriginalMailboxNative(psql, literal, { companyId: base.companyId, environment: 'test', raw: wire, receivedAt: new Date().toISOString(), smtpFrom: 'synthetic-f113@example.invalid' })
  const outboundMatch = await matchOutboundRequestForInbound({ companyId: base.companyId, parsed: mail.parsed, inboundEmailMessageId: mail.inboundEmailMessageId, parseResultId: mail.parseResultId })
  const meteringPointMatch = await matchMeteringPointForInbound({ companyId: base.companyId, parsed: mail.parsed })
  const sourceId = await createInboundEdielMessage({ companyId: base.companyId, actorUserId: base.actorUserId, environment: 'test', inboundEmailMessageId: mail.inboundEmailMessageId,
    parseResultId: mail.parseResultId, parsed: mail.parsed, outboundMatch, meteringPointMatch })
  expect(sourceId).toMatch(/^[a-f0-9-]{36}$/)
  const message = (await getEdielMessageById(sourceId!))!
  expect(message).toMatchObject({ company_id: base.companyId, direction: 'inbound', message_code: 'Z04', raw_payload: wire })
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(message, { actorUserId: base.actorUserId })
  expect({ syntax: decision.syntaxDecision, application: decision.applicationDecision }, JSON.stringify(decision.issues)).toEqual({ syntax: 'accepted', application: 'accepted' })
  expect((await recordReceivedSourceValidation({ original: message, validated: message, resolvedCompanyId: base.companyId, decision })).status).toBe('recorded')
  await captureFreshEdielSourceRulePackEvidence(base.companyId, sourceId!)
  // The canonical object exactly as the plan's require_plan_v1 passes it (committed assessment, separate transaction).
  const own = psql<Record<string, unknown>>(`SELECT gridex_received_sources.require_prodat_application_objects_v1(${literal(base.companyId)},${literal(sourceId)})->'objects'->0`)
  expect(own).toMatchObject({ objectId: point, identityAgency: '89' })
  const ownOwner = psql<{ company: string; area: string }>(`SELECT jsonb_build_object('company',company_id,'area',owner_code) FROM public.grid_owners WHERE id=${literal(base.gridId)}`)
  expect(ownOwner).toEqual({ company: base.companyId, area: AREA })
  return { ...base, sourceId: sourceId!, own }
}

describe('F113 PRODAT object batch wire projection (require_wire_projection_v1, via require_plan_v1)', () => {
  it('takes the shared grid owner the command names when the tenant has none; never another tenant row; never guesses', async () => {
    const f = await prodatObjectSource()
    const before = installed()
    /** The approved command for the object; only the fields require_wire_projection_v1 binds to the grid owner. */
    const call = (owners: { site?: string | null; point?: string | null }) => {
      const command: Record<string, unknown> = { company_id: f.companyId, application: { payload_snapshot: { edielMessageId: f.sourceId } } }
      if (owners.site !== undefined) command.site = { grid_owner_id: owners.site }
      if (owners.point !== undefined) command.metering_point = { grid_owner_id: owners.point }
      return `PERFORM gridex_prodat_object_batch.require_wire_projection_v1((SELECT raw_payload FROM public.ediel_messages WHERE id=${literal(f.sourceId)} AND company_id=${literal(f.companyId)}),
        ${literal(f.own)}::jsonb,${literal(command)}::jsonb,'create_new_customer',${literal(f.actorUserId)}::uuid); r:='"accepted"';`
    }
    const run = (setup: string, owners: { site?: string | null; point?: string | null }) => replay(call(owners), setup, before.wire)
    const share = `UPDATE public.grid_owners SET company_id=NULL WHERE id=${literal(f.gridId)};`
    const other = randomUUID(), second = randomUUID(), otherArea = randomUUID()
    const cases = {
      // World shape: the tenant's grid owner is the platform-shared registry row; the command's site and point name it.
      // Another shared row of the same area exists, so owner_code alone would be ambiguous.
      shared: run(`${share}${sharedOwner(second)}`, { site: f.gridId, point: f.gridId }),
      // Another tenant's row for the area, named by the command.
      foreign: run(`${otherTenant(other)}UPDATE public.grid_owners SET company_id=${literal(other)} WHERE id=${literal(f.gridId)};`, { site: f.gridId, point: f.gridId }),
      // Site and point name two different shared rows of the area.
      ambiguous: run(`${share}${sharedOwner(second)}`, { site: f.gridId, point: second }),
      // The tenant's own row takes precedence over a shared row of the same area.
      ownFirstNamedShared: run(sharedOwner(second), { site: second, point: second }),
      ownFirstNamedOwn: run(sharedOwner(second), { site: f.gridId, point: f.gridId }),
      // A shared row of another area is not the wire's grid owner.
      otherArea: run(`${share}${sharedOwner(otherArea, 'F13')}`, { site: otherArea, point: otherArea }),
      // Nothing named: no grid owner is chosen (unchanged).
      unnamed: run(share, {}),
    }
    console.info(JSON.stringify({ label: 'F113 object batch', fixedInstalled: before.wire, cases }))
    const refused = { error: 'prodat_object_batch_wire_grid_owner_required' }
    if (!before.wire) {
      // Old installed body: the shared registry row is refused (F113), and so is the two-row case.
      expect(cases.shared.old).toEqual(refused)
      expect(cases.ambiguous.old).toEqual(refused)
      expect(cases.ownFirstNamedOwn.old).toEqual({ value: 'accepted' })
    }
    expect(cases.shared.fixed).toEqual({ value: 'accepted' })
    expect(cases.foreign.fixed).toEqual(refused)
    expect(cases.ambiguous.fixed).toEqual({ error: 'prodat_object_batch_grid_namespace_ambiguous' })
    expect(cases.ownFirstNamedShared.fixed).toEqual(refused)
    expect(cases.ownFirstNamedOwn.fixed).toEqual({ value: 'accepted' })
    expect(cases.otherArea.fixed).toEqual(refused)
    expect(cases.unnamed.fixed).toEqual({ value: 'accepted' })
    // Nothing from the replays is visible afterwards; the installed body is unchanged.
    expect(installed()).toEqual(before)
    expect(sql<{ company: string | null }>(`SELECT jsonb_build_object('company',company_id) FROM public.grid_owners WHERE id=${literal(f.gridId)}`)).toEqual({ company: f.companyId })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.grid_owners WHERE id IN(${literal(second)},${literal(otherArea)})`)).toBe(0)
  })
})

describe('F113 regulated supply scope (gridex_regulated_supply.scope_v1)', () => {
  it('scopes the shared grid owner of the tenant\'s own site; another tenant\'s grid owner still gives no scope', async () => {
    // The shipped migration carries exactly the proposal's scope_v1 rewrite (needle, replacement and markers).
    const scopeTuple = (file: string) => readFileSync(file, 'utf8').match(/\('gridex_regulated_supply\.scope_v1[\s\S]*?'gridex_regulated_supply\.lock_graph_v1\(\)'\)/)?.[0]
    expect(scopeTuple(SHIPPED)).toBeTruthy()
    expect(scopeTuple(SHIPPED)).toBe(scopeTuple(MIGRATION))
    const f = await seedNormalSwitchNativeFixture({ deferOriginal: true })
    const agreement = randomUUID()
    const dso = sql<string>(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(f.receiver)} AND is_verified`)
    sql(`INSERT INTO public.tenant_bilateral_agreements(id,company_id,environment,counterparty_actor_id,capability_code,terms,is_enabled,valid_from,valid_to,source_reference)
      VALUES(${literal(agreement)},${literal(f.companyId)},'test',${literal(dso)},'PRODAT:Z04:A','{"synthetic_fixture_only":true}',true,clock_timestamp()-interval '1 day','2100-01-01','SYNTHETIC F113 AGREEMENT');`)
    const selector = { environment: 'test', kind: 'assigned_supply', contractId: f.contractId, meteringPointId: f.pointId, identityAgency: '9', bilateralAgreementId: agreement,
      startAt: new Date((Math.floor(Date.now() / 86_400_000) + 2) * 86_400_000).toISOString() } // a future whole minute
    const before = installed()
    const run = (setup: string) => replay(`r:=gridex_regulated_supply.scope_v1(${literal(f.companyId)}::uuid,${literal(selector)}::jsonb);`, setup, before.scope)
    const other = randomUUID()
    const cases = {
      own: run(''),
      shared: run(`UPDATE public.grid_owners SET company_id=NULL WHERE id=${literal(f.gridId)};`),
      foreign: run(`${otherTenant(other)}UPDATE public.grid_owners SET company_id=${literal(other)} WHERE id=${literal(f.gridId)};`),
      sharedInactive: run(`UPDATE public.grid_owners SET company_id=NULL,is_active=false WHERE id=${literal(f.gridId)};`),
    }
    console.info(JSON.stringify({ label: 'F113 regulated scope', fixedInstalled: before.scope, cases: Object.fromEntries(Object.entries(cases).map(([k, v]) => [k,
      { old: v.old && (v.old.error ?? (v.old.value ? 'scoped' : null)), fixed: v.fixed.error ?? (v.fixed.value ? 'scoped' : null) }])) }))
    const scoped = expect.objectContaining({ companyId: f.companyId, environment: 'test', kind: 'assigned_supply', meteringPointId: f.pointId, legalReceiverId: f.receiver })
    if (!before.scope) {
      expect(cases.own.old).toEqual({ value: scoped })
      expect(cases.shared.old).toEqual({ value: null }) // F113: the shared grid owner gave no scope
    }
    expect(cases.own.fixed).toEqual({ value: scoped })
    expect(cases.shared.fixed).toEqual({ value: scoped })
    // Same scope apart from the grid owner's tenancy (the scope does not hash the grid owner row).
    expect(cases.shared.fixed.value).toEqual(cases.own.fixed.value)
    expect(cases.foreign.fixed).toEqual({ value: null })
    expect(cases.sharedInactive.fixed).toEqual({ value: null })
    expect(installed()).toEqual(before)
    expect(sql<{ company: string | null; active: boolean }>(`SELECT jsonb_build_object('company',company_id,'active',is_active) FROM public.grid_owners WHERE id=${literal(f.gridId)}`))
      .toEqual({ company: f.companyId, active: true })
  })
})
