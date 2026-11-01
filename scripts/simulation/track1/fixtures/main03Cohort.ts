// Same-cohort source protocol. A candidate is never a PASS or a runtime grant.
// Native CLI (separately admitted read-only phase): node main03Cohort.ts seal
// The existing prepared-hosted assignment is infrastructure_smoke ONLY. It
// cannot provide the distinct root-pinned business admission required here.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, closeSync, fstatSync, fsyncSync, linkSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { createServerClient } from '@supabase/ssr'
import { SupabaseClient } from '@supabase/supabase-js'
import type { Main03Fixture, Main03Params } from './main03Fixture'
import type { Session } from './runtime'
// Explicit extension permits the standalone Node22 type-stripping CLI.
import { buildOracle, chooseSafeSalt, parseMilliKwh, type Oracle } from './synthetic.ts'

export const COHORT_ORACLE_SHA256 = '96518c184c240dafa5890df8f6b375b0730acd90f0e97d8f39063fb68c329df3'
export const MAIN03_STEPS = ['MAIN03.01', 'MAIN03.02', 'MAIN03.03', 'MAIN03.05', 'MAIN03.04'] as const
const PROTOCOL_FILES = ['scripts/simulation/track1/scenarios/main03.test.ts', 'scripts/simulation/track1/scenarios/main04.test.ts',
  'scripts/simulation/track1/fixtures/main03Cohort.ts', '__tests__/simulation-main03-cohort-handoff.test.ts']
type JsonRow = Record<string, unknown>
export type FileRef = { path: string; sha256: string }
type CohortIds = { companyId: string; actorUserId: string; customerId: string; siteId: string; pointId: string; contractId: string; supplyPeriodId: string; gridOwnerId: string; dataRequestId: string }
const ID_FIELDS: Array<keyof CohortIds> = ['companyId', 'actorUserId', 'customerId', 'siteId', 'pointId', 'contractId', 'supplyPeriodId', 'gridOwnerId', 'dataRequestId']
type RuntimeIdentity = { appCommit: string; appTree: string; harnessCommit: string; harnessTree: string; nextBuildId: string;
  daemonId: string; databaseSystemIdentifier: string; serverMajor: number; catalogSha256: string; ledgerSha256: string;
  resourcesSha256: string; immutableFilesSha256: string; custodySha256: string; appProcessSha256: string }
type AppProcess = { pid: number; startTicks: string; pgid: number; sid: number; uid: number; cwd: string; exe: string; exeSha256: string; commandSha256: string }
export type InputApproval = { basisKind: 'original_frozen_input' | 'separately_qualified_synthetic_input'; oracleSha256: string;
  params: Main03Params; salt: number; inputVectorSha256: string; independentReviewRefs: FileRef[]; substitutions: string[] }
type Phase = 'MAIN03_CANDIDATE' | 'MAIN03_SEAL' | 'MAIN04_PREPARE_REVIEW'
export type BusinessAdmission = {
  schema: 'track1-cohort-business-admission-v1' | 'track1-cohort-business-admission-v2'; reportKind: 'business_cohort'; phase: Phase;
  campaignId: string; operationId: string; producerId: string; runId: string; createdAtUtc: string; expiresAtUtc: string;
  privateHome: string; simHome: string; runDir: string; appDir: string; harnessDir: string; dbUrl: string; appUrl: string; authUrl: string; anonKey: string; serviceRoleKeySha256: string;
  runtime: RuntimeIdentity; appProcess: AppProcess; sourceManifest: Record<string, string>; buildManifest: FileRef; immutableFiles: FileRef[]; stack: FileRef;
  resourceManifest: FileRef; custody: { refs: Record<string, string>; receipts: Array<{ sha: string; parent: string; tree: string; messageSha256: string }> };
  inputApproval: FileRef; candidatePath: string; graphPath: string; authPath: string; sealedPath: string; adoptedPath: string; draftPath: string;
  candidate?: FileRef; sealed?: FileRef; terminal?: FileRef; resolution?: FileRef; reports?: { raw: FileRef; normalized: FileRef; meta: FileRef; log: FileRef };
  phaseAdapter?: { schema: 'track1-parent-custody-ipc-v1'; assignment: FileRef; runtimeObservation: FileRef; preparedSha256: string;
    socketPath: string; nonce: string; deadlineAtMs: number; minimumAuthHeadroomMs: number; parent: { pid: number; startTicks: string; bootId: string; exeSha256: string } };
}
export type ProtectedGraph = {
  sources: JsonRow[]; normalized: JsonRow[]; physical: JsonRow[]; underlays: JsonRow[]; items: JsonRow[];
  bindings: JsonRow[]; qualified: JsonRow[]; contracts: JsonRow[]; supplies: JsonRow[]; spots: JsonRow[]; spotLocks: JsonRow[];
  priceSnapshots: JsonRow[]; priceVersions: JsonRow[];
  pricingRuns: JsonRow[]; pricingEvidence: JsonRow[]; invoices: JsonRow[]; exportItems: JsonRow[]; exports: JsonRow[];
}
type AuthObservation = { userId: string; companyId: string; expiresAtMs: number; permissions: string[] }
export type CohortPorts = { now: () => number; observeRuntime: (admission: BusinessAdmission) => Promise<RuntimeIdentity>;
  readGraph: (ids: CohortIds, oracle: Oracle) => Promise<ProtectedGraph>; authenticate: (session: Session, admission: BusinessAdmission) => Promise<AuthObservation> }
type Candidate = { schema: 'main03-cohort-candidate-v1'; state: 'CANDIDATE_NOT_ADMITTED'; campaignId: string; operationId: string; runId: string;
  createdAtMs: number; startedAfterMs: number; ids: CohortIds; runtime: RuntimeIdentity; inputApproval: FileRef; graph: FileRef; auth: FileRef; completed: string[];
  sourceObservation: unknown; unknownOutcome: unknown }
type Sealed = { schema: 'main03-sealed-cohort-v1'; state: 'SEALED_MAIN03_SOURCE_COHORT_NOT_BUSINESS_PASS'; candidate: FileRef;
  candidateValue: Candidate; graphSha256: string; inputApproval: FileRef; terminal: FileRef; resolution: FileRef; createdAtMs: number; expiresAtMs: number }
export type Main04Cohort = CohortIds & { params: Main03Params; salt: number; oracle: Oracle; session: Session; underlayId: string; cohortSha256: string;
  protocol: { admission: BusinessAdmission; admissionSha256: string; sealed: Sealed; graph: ProtectedGraph; ports: CohortPorts } }

function need(value: unknown, code: string): asserts value { if (!value) throw new Error(`cohort_hold:${code}`) }
export const cohortHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
const bytesHash = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
function canonical(value: unknown): string {
  need(value !== undefined && typeof value !== 'bigint' && typeof value !== 'function' && (typeof value !== 'number' || Number.isFinite(value)), 'non_json_value')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as JsonRow)[key])}`).join(',')}}`
}
function row(value: unknown): JsonRow { need(value && typeof value === 'object' && !Array.isArray(value), 'object'); return value as JsonRow }
function text(value: unknown): string { need(typeof value === 'string' && value.length > 0, 'string'); return value }
function uuid(value: unknown): string { need(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value), 'uuid'); return value }
function hash(value: unknown): string { need(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'sha256'); return value }
function same(a: unknown, b: unknown, code: string) { need(canonical(a) === canonical(b), code) }
const integer = (value: unknown) => { need(Number.isSafeInteger(value), 'integer'); return value as number }
const ms = (value: unknown) => { const parsed = Date.parse(text(value)); need(Number.isSafeInteger(parsed), 'timestamp'); return parsed }

/** Reject duplicate keys before JSON.parse can discard them, including nested keys. */
export function parseCohortJson(raw: string): unknown {
  need(Buffer.byteLength(raw) <= 16 * 1024 * 1024, 'json_size')
  let pos = 0
  const whitespace = () => { while (/\s/.test(raw[pos] ?? '') && pos < raw.length) pos++ }
  const string = (): string => {
    const start = pos++; let escaped = false
    while (pos < raw.length) { const char = raw[pos++]; if (char === '"' && !escaped) return JSON.parse(raw.slice(start, pos)); escaped = char === '\\' && !escaped }
    throw new Error('cohort_hold:json_string')
  }
  const value = (depth: number): unknown => {
    need(depth <= 40, 'json_depth'); whitespace(); const char = raw[pos]
    if (char === '"') return string()
    if (char === '{') {
      pos++; const object: JsonRow = Object.create(null); whitespace(); if (raw[pos] === '}') { pos++; return object }
      while (pos < raw.length) { whitespace(); need(raw[pos] === '"', 'json_key'); const key = string(); need(!Object.hasOwn(object, key) && !['__proto__', 'constructor', 'prototype'].includes(key), 'json_duplicate_key'); whitespace(); need(raw[pos++] === ':', 'json_colon'); object[key] = value(depth + 1); whitespace(); const end = raw[pos++]; if (end === '}') return object; need(end === ',', 'json_comma') }
    }
    if (char === '[') {
      pos++; const array: unknown[] = []; whitespace(); if (raw[pos] === ']') { pos++; return array }
      while (pos < raw.length) { need(array.length < 100_000, 'json_array'); array.push(value(depth + 1)); whitespace(); const end = raw[pos++]; if (end === ']') return array; need(end === ',', 'json_comma') }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(pos))
    need(match, 'json_value'); pos += match[0].length; const parsed: unknown = JSON.parse(match[0]); need(typeof parsed !== 'number' || Number.isFinite(parsed), 'json_number'); return parsed
  }
  const result = value(0); whitespace(); need(pos === raw.length, 'json_trailing'); return result
}

function privatePath(file: string, home?: string): void {
  need(path.isAbsolute(file) && path.normalize(file) === file, 'private_absolute_path')
  for (let parent = file; parent !== path.dirname(parent); parent = path.dirname(parent)) need(!lstatSync(parent).isSymbolicLink(), 'private_symlink')
  const stat = lstatSync(file); need(stat.uid === process.getuid?.(), 'private_owner')
  if (stat.isDirectory()) need((stat.mode & 0o777) === 0o700, 'private_directory_mode')
  else need(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600, 'private_file_mode')
  need(realpathSync(file) === file, 'private_realpath')
  if (home) need(file.startsWith(home + path.sep), 'private_outside_home')
}
export function readCohortFile<T>(file: FileRef, home: string, max = 256 * 1024): T {
  hash(file.sha256); privatePath(file.path, home)
  const fd = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try { const stat = fstatSync(fd); need(stat.size <= max && stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o600, 'private_bound'); const raw = readFileSync(fd); need(bytesHash(raw) === file.sha256, 'file_changed'); return parseCohortJson(raw.toString('utf8')) as T } finally { closeSync(fd) }
}
export function appendCohortFile(file: string, value: unknown, home: string): FileRef {
  need(file.startsWith(home + path.sep), 'output_outside_home'); privatePath(path.dirname(file)); need(!path.relative(home, file).split(path.sep).includes('..'), 'output_escape')
  const raw = Buffer.from(canonical(value) + '\n'); need(raw.length <= 16 * 1024 * 1024, 'output_size')
  const temporary = path.join(path.dirname(file), `.cohort-${randomUUID()}.tmp`)
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { writeFileSync(fd, raw); fsyncSync(fd) } finally { closeSync(fd) }
  try { linkSync(temporary, file) } finally { unlinkSync(temporary) }
  const directory = openSync(path.dirname(file), constants.O_RDONLY | constants.O_DIRECTORY)
  try { fsyncSync(directory) } finally { closeSync(directory) }
  return { path: file, sha256: bytesHash(raw) }
}

function validTime(admission: BusinessAdmission, now: number) {
  need(ms(admission.createdAtUtc) <= now && ms(admission.expiresAtUtc) > now + 60_000, 'phase_expired')
  need(ms(admission.expiresAtUtc) - ms(admission.createdAtUtc) <= 4 * 3_600_000, 'phase_lifetime')
}
export function validateBusinessAdmission(admission: BusinessAdmission, phase: Phase, now: number) {
  need(['track1-cohort-business-admission-v1', 'track1-cohort-business-admission-v2'].includes(admission.schema) && admission.reportKind === 'business_cohort' && admission.phase === phase, 'distinct_business_phase_required')
  if (admission.schema === 'track1-cohort-business-admission-v1') need(!admission.phaseAdapter, 'legacy_phase_expansion')
  else assertPhasedAssignment(admission)
  validTime(admission, now); text(admission.campaignId); text(admission.operationId); text(admission.runId); text(admission.producerId)
  need(path.isAbsolute(admission.runDir) && path.normalize(admission.runDir) === admission.runDir && !admission.runDir.endsWith('/'), 'run_directory_path')
  privatePath(admission.privateHome); need(!admission.privateHome.startsWith(admission.runDir + '/'), 'private_home_inside_run')
  need(lstatSync(admission.privateHome).isDirectory() && ![admission.appDir, admission.harnessDir].some(root => admission.privateHome === root || admission.privateHome.startsWith(root + '/')), 'private_home_inside_source')
  for (const file of [admission.candidatePath, admission.graphPath, admission.authPath, admission.sealedPath, admission.adoptedPath, admission.draftPath]) {
    need(file.startsWith(admission.privateHome + '/') && !file.startsWith(admission.runDir + '/'), 'receipt_or_auth_inside_report')
  }
  need(new Set([admission.candidatePath, admission.graphPath, admission.authPath, admission.sealedPath, admission.adoptedPath, admission.draftPath]).size === 6, 'output_alias')
  need(PROTOCOL_FILES.every(file => hash(admission.sourceManifest[file])), 'protocol_source_manifest')
  need(admission.runtime.serverMajor === 17, 'postgres_major')
  for (const endpoint of [admission.appUrl, admission.authUrl, admission.dbUrl]) need(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname), 'nonlocal_endpoint')
  // The unchanged native fixture's own SQL port is fixed. A descriptor cannot
  // redirect only our reads while letting that fixture mutate another backend.
  same([admission.dbUrl, admission.authUrl, admission.appUrl], ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'http://127.0.0.1:54321', 'http://127.0.0.1:3101'], 'native_canonical_endpoint_basis')
  // No ambient stack/assignment/cookie or inferred prepared receipt is accepted.
}

function inputOracle(admission: BusinessAdmission): { approval: InputApproval; oracle: Oracle } {
  const approval = readCohortFile<InputApproval>(admission.inputApproval, admission.privateHome)
  need(approval.oracleSha256 === COHORT_ORACLE_SHA256, 'canonical_oracle_identity')
  need(approval.independentReviewRefs.length === 2 && new Set(approval.independentReviewRefs.map(ref => ref.sha256)).size === 2, 'independent_input_review')
  const reviewers = approval.independentReviewRefs.map(reference => {
    const review = readCohortFile<JsonRow>(reference, admission.privateHome)
    need(text(review.decision).startsWith('APPROVE') && review.inputVectorSha256 === approval.inputVectorSha256 && review.basisKind === approval.basisKind && review.oracleSha256 === COHORT_ORACLE_SHA256, 'input_review_applicability')
    need(review.reviewerId !== admission.producerId, 'self_input_review'); return text(review.reviewerId)
  })
  need(new Set(reviewers).size === 2, 'independent_input_reviewers')
  const params = approval.params
  need(params.billingMonth === '2027-02' && params.sites === 1 && params.priceArea === 'SE3' && params.contractStartDate === '2026-10-15' && params.delivery.kind === 'active', 'unsupported_input_terms')
  same(params.pricing, { spotWeightPercent: 100, markupOrePerKwh: 4, monthlyFeeSek: 49, vatPercent: 25 }, 'pricing_terms')
  integer(approval.salt); const oracle = buildOracle(params.billingMonth, approval.salt, params.pricing)
  need(oracle.ambiguities.length === 0 && oracle.intervalCount === 2688 && oracle.month.days === 28, 'input_integer_oracle')
  need(cohortHash(oracle.intervals) === approval.inputVectorSha256, 'independent_input_vector')
  if (approval.basisKind === 'original_frozen_input') {
    same([oracle.totalExVatCents, oracle.vatCents.total, oracle.totalIncVatCents], [144761, 36190, 180951], 'original_frozen_money_input_unqualified')
  } else need(approval.basisKind === 'separately_qualified_synthetic_input' && approval.substitutions.length > 0, 'synthetic_qualification_required')
  return { approval, oracle }
}

/** Bind the actual unchanged builder's full defaults and deterministic salt
 * before its first mutation. An arbitrary safe admitted salt is insufficient. */
export function validateMain03DefaultInput(admission: BusinessAdmission, actualDefaults: Main03Params): Main03Params {
  need(actualDefaults && typeof actualDefaults === 'object' && !Array.isArray(actualDefaults), 'main03_default_params')
  const fixtureParams = structuredClone(actualDefaults), { approval } = inputOracle(admission)
  same(approval.params, fixtureParams, 'main03_default_params')
  const chosen = chooseSafeSalt(fixtureParams.billingMonth, fixtureParams.saltStart, fixtureParams.pricing)
  need(approval.salt === chosen.salt && approval.inputVectorSha256 === cohortHash(chosen.oracle.intervals), 'main03_default_chosen_salt')
  return fixtureParams
}

function unique(rows: JsonRow[], key: string, expected: number) {
  need(Array.isArray(rows) && rows.length === expected && new Set(rows.map(item => uuid(item[key]))).size === expected, 'graph_count_or_duplicate')
}
function timestamp(value: unknown): number { return ms(value) }
function quantity(value: unknown): number { return parseMilliKwh(text(value)) }
function scaled5(value: unknown): number {
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(text(value)); need(match, 'price_decimal_scale')
  const result = Number(match[1]) * 100000 + Number((match[2] ?? '').padEnd(5, '0')); return integer(result)
}

/** Reconstruct each edge and integer input; monetary DB output is never an input. */
export function verifyCohortGraph(graph: ProtectedGraph, ids: CohortIds, oracle: Oracle): string {
  ID_FIELDS.forEach(key => uuid(ids[key]))
  unique(graph.sources, 'id', 28); unique(graph.normalized, 'id', 2688); unique(graph.physical, 'id', 2688); unique(graph.items, 'id', 2688); unique(graph.underlays, 'id', 1)
  const underlay = graph.underlays[0], underlayId = uuid(underlay.id)
  same([underlay.company_id, underlay.customer_id, underlay.metering_point_id, underlay.contract_id, underlay.supply_period_id], [ids.companyId, ids.customerId, ids.pointId, ids.contractId, ids.supplyPeriodId], 'underlay_lineage')
  same([underlay.site_id, underlay.price_area], [ids.siteId, 'SE3'], 'underlay_site_or_area')
  same([underlay.underlay_year, underlay.underlay_month, underlay.status, underlay.readiness_status, underlay.energy_direction, underlay.settlement_type], [2027, 2, 'validated', 'ready', 'consumption', 'invoice'], 'underlay_state')
  same([underlay.billing_period_start, underlay.billing_period_end], ['2027-02-01', '2027-03-01'], 'underlay_civil_month')
  const period = row(underlay.payload)
  need(timestamp(period.billing_period_start_instant) === oracle.month.startMs && timestamp(period.billing_period_end_instant) === oracle.month.endMs && period.billing_period_timezone === 'Europe/Stockholm' && period.billing_period_end_exclusive === true, 'underlay_exact_utc_month')
  need(quantity(underlay.total_kwh) === oracle.totalMilliKwh && underlay.source_meter_value_count === 2688 && underlay.missing_values_count === 0, 'underlay_quantity')
  const sources = new Map(graph.sources.map(source => [uuid(source.id), source]))
  const physical = new Map(graph.physical.map(value => [uuid(value.id), value]))
  const normalized = new Map(graph.normalized.map(value => [uuid(value.id), value]))
  const ordered = [...graph.normalized].sort((a, b) => timestamp(a.period_start) - timestamp(b.period_start))
  const daySources = new Map<number, string>(), sourceDays = new Map<string, number>()
  for (const [index, value] of ordered.entries()) {
    const expected = oracle.intervals[index], source = sources.get(uuid(value.source_message_id)), meter = physical.get(uuid(value.source_metering_value_id))
    need(source && meter, 'physical_source_edge')
    same([value.company_id, value.customer_id, value.metering_point_id, value.supply_period_id, value.revision_status, value.billing_status, value.billing_gate_status, value.unit], [ids.companyId, ids.customerId, ids.pointId, ids.supplyPeriodId, 'current', 'billable', 'eligible', 'kWh'], 'normalized_lineage_or_state')
    same([value.site_id, value.direction], [ids.siteId, 'consumption'], 'normalized_site_or_direction')
    need(timestamp(value.period_start) === expected.startMs && timestamp(value.period_end) === expected.endMs && quantity(value.quantity_kwh) === expected.milliKwh, 'normalized_input_vector')
    same([meter.company_id, meter.source_ediel_message_id, meter.is_current], [ids.companyId, source.id, true], 'physical_lineage')
    same([meter.customer_id, meter.site_id, meter.metering_point_id], [ids.customerId, ids.siteId, ids.pointId], 'physical_tenant_entity')
    need(timestamp(meter.period_start) === expected.startMs && timestamp(meter.period_end) === expected.endMs && quantity(meter.quantity_kwh) === expected.milliKwh, 'physical_input_vector')
    same([source.company_id, source.direction, source.message_family, source.message_code], [ids.companyId, 'inbound', 'UTILTS', 'E66'], 'source_origin')
    same([source.environment, source.customer_id, source.site_id, source.metering_point_id, source.grid_owner_id, source.grid_owner_data_request_id], ['test', ids.customerId, ids.siteId, ids.pointId, ids.gridOwnerId, ids.dataRequestId], 'source_entity_lineage')
    hash(source.raw_sha256); text(source.bgm); need(value.source_transaction_reference === source.transaction_ref, 'source_transaction')
    const previous = daySources.get(expected.day); need(!previous || previous === source.id, 'day_source_partition'); daySources.set(expected.day, String(source.id))
    const priorDay = sourceDays.get(String(source.id)); need(!priorDay || priorDay === expected.day, 'source_reused_for_day'); sourceDays.set(String(source.id), expected.day)
  }
  need(daySources.size === 28 && sourceDays.size === 28 && new Set(graph.sources.map(source => source.raw_sha256)).size === 28 && new Set(graph.sources.map(source => source.bgm)).size === 28 && new Set(graph.sources.map(source => source.transaction_ref)).size === 28, 'source_bijection')
  const linkedNormalized = new Set<string>(), linkedPhysical = new Set<string>()
  for (const item of graph.items) {
    const value = normalized.get(uuid(item.source_normalized_metering_value_id)); need(value, 'item_normalized_edge')
    same([item.company_id, item.billing_underlay_id, item.meter_value_id, item.metering_point_id, item.contract_id, item.energy_direction, item.settlement_type, item.unit], [ids.companyId, underlayId, value.source_metering_value_id, ids.pointId, ids.contractId, 'consumption', 'invoice', 'kWh'], 'item_lineage')
    same([timestamp(item.period_start), timestamp(item.period_end), quantity(item.quantity_kwh)], [timestamp(value.period_start), timestamp(value.period_end), quantity(value.quantity_kwh)], 'item_input_vector')
    linkedNormalized.add(String(value.id)); linkedPhysical.add(String(item.meter_value_id))
  }
  need(linkedNormalized.size === 2688 && linkedPhysical.size === 2688, 'item_bijection')
  need(graph.bindings.length === 1 && graph.qualified.length === 1, 'bound_basis_count')
  const binding = graph.bindings[0], qualified = graph.qualified[0]
  same([binding.company_id, binding.underlay_id, binding.actor_user_id], [ids.companyId, underlayId, ids.actorUserId], 'basis_lineage')
  hash(binding.source_basis_hash); need(binding.finalized_at && binding.source_basis && binding.bodyHashMatches === true && quantity(binding.exact_total_kwh) === oracle.totalMilliKwh, 'basis_body')
  same([qualified.id, qualified.qualified, qualified.correctionRequired], [underlayId, true, false], 'actual_source_basis_refusal')
  need(quantity(qualified.totalKwh) === oracle.totalMilliKwh, 'qualified_quantity')
  need(graph.contracts.length === 1 && graph.supplies.length === 1, 'contract_supply_count')
  same([graph.contracts[0].id, graph.contracts[0].company_id, graph.contracts[0].customer_id], [ids.contractId, ids.companyId, ids.customerId], 'contract_identity')
  same([graph.supplies[0].id, graph.supplies[0].company_id, graph.supplies[0].contract_id, graph.supplies[0].metering_point_id], [ids.supplyPeriodId, ids.companyId, ids.contractId, ids.pointId], 'supply_identity')
  need(['signed', 'active'].includes(String(graph.contracts[0].status)) && ['active', 'confirmed_by_grid_owner'].includes(String(graph.supplies[0].status)), 'contract_supply_state')
  need(graph.priceSnapshots.length === 1 && graph.priceVersions.length === 1, 'price_snapshot_count')
  const snapshot = graph.priceSnapshots[0], version = graph.priceVersions[0], terms = row(snapshot.snapshot_json)
  same([snapshot.id, snapshot.company_id, snapshot.contract_id, snapshot.price_plan_version_id], [underlay.contract_price_snapshot_id, ids.companyId, ids.contractId, version.id], 'price_snapshot_lineage')
  same(underlay.pricing_snapshot, snapshot.snapshot_json, 'underlay_price_snapshot'); hash(snapshot.snapshot_hash); hash(version.content_sha256)
  need(version.locked_at && version.company_id === ids.companyId && ['active', 'approved', 'published'].includes(String(version.status)), 'price_version_state')
  need(terms.pricing_model === 'spot' && Number(terms.vat_rate) === 0.25 && terms.energy_direction === 'consumption', 'contract_pricing_model')
  const base = terms.base_components as JsonRow[], components = terms.price_components as JsonRow[]
  need(Array.isArray(base) && base.length === 1 && base[0].source_type === 'spot' && Number(base[0].weight_percent) === 100 && base[0].price_area === 'SE3', 'spot_terms')
  need(Array.isArray(components) && components.length === 2, 'contract_component_count')
  const markup = components.filter(component => component.calculation_type === 'per_kwh'), fee = components.filter(component => component.calculation_type === 'fixed_monthly')
  need(markup.length === 1 && Number(markup[0].amount) === 4 && markup[0].unit === 'ore_per_kwh' && fee.length === 1 && Number(fee[0].amount) === 49 && fee[0].unit === 'sek_month', 'independent_contract_terms')
  need(graph.spots.length === 672 && graph.spotLocks.length === 1, 'spot_coverage')
  const spots = [...graph.spots].sort((a, b) => timestamp(a.time_start) - timestamp(b.time_start))
  for (const [index, spot] of spots.entries()) {
    const expected = oracle.intervals[index * 4]
    same([spot.source, spot.price_area, spot.resolution], ['elprisetjustnu', 'SE3', 'hourly'], 'spot_identity')
    need(timestamp(spot.time_start) === expected.startMs && timestamp(spot.time_end) === expected.startMs + 3_600_000 && scaled5(spot.sek_per_kwh) === expected.spotE5, 'spot_input_vector')
  }
  const lock = graph.spotLocks[0]
  same([lock.source, lock.price_area, lock.billing_month, lock.status], ['elprisetjustnu', 'SE3', '2027-02', 'locked'], 'spot_lock')
  need(lock.locked_at && lock.verified_at && lock.covered_duration_minutes === 40320 && lock.expected_duration_minutes === 40320 && Array.isArray(lock.quality_issues) && lock.quality_issues.length === 0, 'spot_lock_coverage')
  hash(lock.source_checksum)
  return underlayId
}

async function actualAuth(session: Session, admission: BusinessAdmission): Promise<AuthObservation> {
  need(session.cookieHeader.split('; ').includes(`gridex_admin_selected_company_id=${session.companyId}`), 'auth_company_cookie')
  const cookies = session.cookieHeader.split('; ').map(pair => { const offset = pair.indexOf('='); need(offset > 0, 'auth_cookie_shape'); return { name: pair.slice(0, offset), value: pair.slice(offset + 1) } })
  const client = createServerClient(admission.authUrl, admission.anonKey, { cookies: { getAll: () => cookies, setAll: () => { throw new Error('cohort_hold:auth_refresh_not_admitted') } } })
  const current = await client.auth.getSession(); need(!current.error && current.data.session, 'auth_session_expiry')
  // getSession supplies the token/expiry only; server getUser validates that
  // exact token before any identity or canonical permissions are accepted.
  const user = await client.auth.getUser(current.data.session.access_token); need(!user.error && user.data.user?.id === session.userId, 'actual_auth_user')
  const claims = row(parseCohortJson(Buffer.from(current.data.session.access_token.split('.')[1], 'base64url').toString('utf8')))
  need(claims.sub === session.userId && claims.exp === current.data.session.expires_at, 'auth_verified_claims')
  const sessionId = uuid(claims.session_id)
  const active = row(sqlRead(admission, `SELECT jsonb_build_object('active',count(*)) FROM auth.sessions WHERE id=${literal(sessionId)}::uuid AND user_id=${literal(uuid(session.userId))}::uuid AND (not_after IS NULL OR not_after>now());`))
  need(active.active === 1, 'auth_session_revoked')
  const result = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: session.companyId })
  const context = row(result.data)
  need(!result.error && context.authorized === true && context.user_id === session.userId && context.selected_company_id === session.companyId, 'actual_auth_tenant_context')
  const activePermissions = context.active_permission_keys, granted = context.is_platform_admin ? activePermissions : context.permissions, denied = context.denied_permissions
  need(Array.isArray(activePermissions) && Array.isArray(granted) && Array.isArray(denied), 'auth_permissions_shape')
  const permissions = granted.filter((permission): permission is string => typeof permission === 'string' && activePermissions.includes(permission) && !denied.includes(permission))
  return { userId: session.userId, companyId: session.companyId, expiresAtMs: integer(current.data.session.expires_at) * 1000, permissions }
}

function command(args: string[], input?: string): string {
  try { return execFileSync(args[0], args.slice(1), { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch { throw new Error('cohort_hold:readonly_observation_failed') }
}
function sqlRead(admission: BusinessAdmission, statement: string): unknown {
  const output = command(['psql', admission.dbUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1'], `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${statement}\nCOMMIT;`)
  return parseCohortJson(output.trim())
}
type ReadonlyCommand = (args: string[], input?: string) => string
type ProcReader = { read: (file: string) => Buffer; link: (file: string) => string; entries: (directory: string) => string[] }
/** Read-only actual executable/session/listener custody. No kill or port probe. */
export function observeCohortAppProcess(expected: AppProcess, appUrl: string, io: ProcReader = {
  read: file => readFileSync(file), link: readlinkSync, entries: directory => readdirSync(directory),
}): string {
  const pid = integer(expected.pid); need(pid > 1 && expected.uid === process.getuid?.(), 'app_process_owner')
  const root = `/proc/${pid}`, stat = io.read(`${root}/stat`).toString('utf8'), end = stat.lastIndexOf(') ')
  need(end > 0 && stat.slice(0, stat.indexOf(' ')) === String(pid), 'app_process_stat')
  const fields = stat.slice(end + 2).trim().split(/\s+/)
  need(!['Z', 'X'].includes(fields[0]) && fields[19] === expected.startTicks && Number(fields[2]) === expected.pgid && Number(fields[3]) === expected.sid, 'app_process_birth')
  const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m.exec(io.read(`${root}/status`).toString('utf8'))
  need(uids && uids.slice(1).every(uid => Number(uid) === expected.uid), 'app_process_uid')
  need(io.link(`${root}/cwd`) === expected.cwd && io.link(`${root}/exe`) === expected.exe && bytesHash(io.read(`${root}/exe`)) === expected.exeSha256 && bytesHash(io.read(`${root}/cmdline`)) === expected.commandSha256, 'app_process_image')
  const owned = new Set(io.entries(`${root}/fd`).map(fd => io.link(`${root}/fd/${fd}`)))
  const port = Number(new URL(appUrl).port)
  need(Number.isSafeInteger(port) && port > 0 && port <= 65535, 'app_listener_port')
  const listening = ['/proc/net/tcp', '/proc/net/tcp6'].flatMap(file => io.read(file).toString('utf8').trim().split('\n').slice(1))
    .map(line => line.trim().split(/\s+/)).filter(fields => fields[3] === '0A' && parseInt(fields[1].split(':')[1], 16) === port)
  need(listening.length === 1 && ['0100007F', '00000000000000000000000001000000'].includes(listening[0][1].split(':')[0]) && owned.has(`socket:[${listening[0][9]}]`), 'app_listener_custody')
  return cohortHash(expected)
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
function collectSql(table: string, predicate: string, fields = 'to_jsonb(t)'): string {
  return `(SELECT coalesce(jsonb_agg(${fields} ORDER BY t.id),'[]'::jsonb) FROM ${table} t WHERE ${predicate})`
}
export function protectedGraphSql(ids: CohortIds, oracle: Oracle): string {
  ID_FIELDS.forEach(key => uuid(ids[key])); const c = literal(ids.companyId), month = literal(oracle.month.billingMonth)
  const scoped = `t.company_id=${c}`, underlays = `${scoped} AND t.underlay_year=2027 AND t.underlay_month=2`
  const normal = `${scoped} AND t.period_start>=${literal(new Date(oracle.month.startMs).toISOString())} AND t.period_start<${literal(new Date(oracle.month.endMs).toISOString())}`
  const underlayIds = `SELECT id FROM public.billing_underlays WHERE company_id=${c} AND underlay_year=2027 AND underlay_month=2`
  const sourceFields = `(to_jsonb(t)-'raw_payload') || jsonb_build_object('raw_sha256',encode(sha256(convert_to(t.raw_payload,'UTF8')),'hex'),'transaction_ref',(SELECT min(n.source_transaction_reference) FROM public.normalized_metering_values n WHERE n.company_id=${c} AND n.source_message_id=t.id),'bgm',substring(t.raw_payload from 'BGM\\+E66::260\\+([^+]+)\\+'))`
  const fields: Record<string, string> = {
    sources: collectSql('public.ediel_messages', `${scoped} AND t.message_family='UTILTS' AND t.message_code='E66' AND t.direction='inbound'`, sourceFields),
    normalized: collectSql('public.normalized_metering_values', normal, `(to_jsonb(t)-'raw_payload')||jsonb_build_object('quantity_kwh',t.quantity_kwh::text,'raw_payload_sha256',encode(sha256(convert_to(t.raw_payload::text,'UTF8')),'hex'))`),
    physical: collectSql('public.metering_values', `${scoped} AND t.source_ediel_message_id IN (SELECT source_message_id FROM public.normalized_metering_values WHERE company_id=${c})`, `(to_jsonb(t)-'raw_payload')||jsonb_build_object('quantity_kwh',coalesce(t.value_kwh,t.quantity)::text,'raw_payload_sha256',encode(sha256(convert_to(t.raw_payload::text,'UTF8')),'hex'))`),
    underlays: collectSql('public.billing_underlays', underlays, `to_jsonb(t)||jsonb_build_object('total_kwh',t.total_kwh::text)`),
    items: collectSql('public.billing_underlay_items', `${scoped} AND t.billing_underlay_id IN (${underlayIds})`, `to_jsonb(t)||jsonb_build_object('quantity_kwh',t.quantity_kwh::text)`),
    bindings: `(SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('exact_total_kwh',t.exact_total_kwh::text,'bodyHashMatches',t.source_basis_hash=encode(sha256(convert_to(t.source_basis::text,'UTF8')),'hex')) ORDER BY t.underlay_id),'[]'::jsonb) FROM gridex_billing_source.underlay_bindings t WHERE ${scoped} AND t.underlay_id IN (${underlayIds}))`,
    qualified: `'[]'::jsonb`, // populated by the same read-only snapshot's service-role RPC below
    contracts: collectSql('public.customer_contracts', `${scoped} AND t.id=${literal(ids.contractId)}`),
    supplies: collectSql('public.customer_supply_periods', `${scoped} AND t.id=${literal(ids.supplyPeriodId)}`),
    priceSnapshots: collectSql('public.contract_price_snapshots', `${scoped} AND t.id IN (SELECT contract_price_snapshot_id FROM public.billing_underlays WHERE company_id=${c} AND id IN (${underlayIds}))`),
    priceVersions: collectSql('public.price_plan_versions', `${scoped} AND t.id IN (SELECT price_plan_version_id FROM public.billing_underlays WHERE company_id=${c} AND id IN (${underlayIds}))`),
    spots: collectSql('public.spot_price_intervals', `t.source='elprisetjustnu' AND t.price_area='SE3' AND t.time_start>=${literal(new Date(oracle.month.startMs).toISOString())} AND t.time_start<${literal(new Date(oracle.month.endMs).toISOString())}`, `to_jsonb(t)||jsonb_build_object('sek_per_kwh',t.sek_per_kwh::text)`),
    spotLocks: collectSql('public.spot_price_monthly_summaries', `t.source='elprisetjustnu' AND t.price_area='SE3' AND t.billing_month=${month}`),
    pricingRuns: collectSql('public.pricing_runs', `${scoped} AND t.billing_underlay_id IN (${underlayIds})`),
    pricingEvidence: collectSql('public.pricing_interval_evidence', `${scoped} AND t.billing_underlay_id IN (${underlayIds})`),
    invoices: collectSql('public.customer_invoices', scoped), exportItems: collectSql('public.invoice_export_items', scoped), exports: collectSql('public.invoice_export_files', scoped),
  }
  return `SELECT jsonb_build_object(${Object.entries(fields).map(([key, value]) => `${literal(key)},${value}`).join(',\n')});`
}

export async function observeCohortRuntime(admission: BusinessAdmission, execute: ReadonlyCommand = command,
  listener: (process: AppProcess, appUrl: string) => string = observeCohortAppProcess): Promise<RuntimeIdentity> {
  const source = (directory: string, expectedCommit: string, expectedTree: string) => {
    same(execute(['git', '-C', directory, 'rev-parse', 'HEAD']).trim(), expectedCommit, 'source_head')
    same(execute(['git', '-C', directory, 'rev-parse', 'HEAD^{tree}']).trim(), expectedTree, 'source_tree')
    need(execute(['git', '-C', directory, 'status', '--porcelain=v1']).trim() === '', 'dirty_source')
  }
  source(admission.appDir, admission.runtime.appCommit, admission.runtime.appTree); source(admission.harnessDir, admission.runtime.harnessCommit, admission.runtime.harnessTree)
  for (const [file, expected] of Object.entries(admission.sourceManifest)) { hash(expected); need(!path.isAbsolute(file) && !file.split('/').includes('..'), 'source_path'); need(bytesHash(readFileSync(path.join(admission.harnessDir, file))) === expected, 'protocol_source_changed') }
  const build = readCohortFile<Record<string, string>>(admission.buildManifest, admission.privateHome, 16 * 1024 * 1024)
  const buildRoot = path.join(admission.appDir, '.next'), actual: string[] = []
  const walk = (directory: string) => { for (const entry of readdirSync(directory, { withFileTypes: true })) { need(!entry.isSymbolicLink(), 'build_symlink'); const file = path.join(directory, entry.name); if (entry.isDirectory()) walk(file); else { need(entry.isFile(), 'build_special'); actual.push(path.relative(buildRoot, file)); need(actual.length <= 30_000, 'build_inventory_size') } } }
  walk(buildRoot); same(actual.sort(), Object.keys(build).sort(), 'build_inventory')
  for (const file of actual) need(bytesHash(readFileSync(path.join(buildRoot, file))) === hash(build[file]), 'build_changed')
  need(admission.immutableFiles.some(file => file.path === admission.stack.path && file.sha256 === admission.stack.sha256), 'stack_immutable_binding')
  const immutable = admission.immutableFiles.map(reference => { readCohortFile(reference, admission.privateHome, 16 * 1024 * 1024); return reference })
  const expectedResources = readCohortFile<{ containerIds: string[]; networkIds: string[]; volumeNames: string[]; roles: { database: string; api: string; storage: string } }>(admission.resourceManifest, admission.privateHome)
  need(expectedResources.containerIds.length > 0 && expectedResources.networkIds.length > 0 && expectedResources.volumeNames.length > 0, 'full_resource_inventory_required')
  for (const ids of [expectedResources.containerIds, expectedResources.networkIds]) need(ids.every(id => /^[a-f0-9]{64}$/.test(id)) && new Set(ids).size === ids.length, 'full_resource_ids')
  need(Object.values(expectedResources.roles).every(id => expectedResources.containerIds.includes(id)) && new Set(Object.values(expectedResources.roles)).size === 3, 'distinct_role_resources')
  const inspect = (kind: string, ids: string[], format: string) => ids.map(id => {
    need(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id), 'resource_name'); return parseCohortJson(execute(['docker', kind, 'inspect', '--format', format, id]).trim())
  })
  const resources = { containers: inspect('container', expectedResources.containerIds, '[{{json .Id}},{{json .Name}},{{json .Created}},{{json .Image}},{{json .Config.Labels}},{{json .NetworkSettings.Networks}},{{json .Mounts}},{{json .State.Running}},{{json .NetworkSettings.Ports}},{{json .HostConfig.PortBindings}}]'),
    networks: inspect('network', expectedResources.networkIds, '[{{json .Id}},{{json .Name}},{{json .Labels}},{{json .Options}},{{json .IPAM}},{{json .Internal}},{{json .EnableIPv6}}]'),
    volumes: inspect('volume', expectedResources.volumeNames, '[{{json .Name}},{{json .Driver}},{{json .Labels}},{{json .Mountpoint}},{{json .Options}}]') }
  for (const [role, internal, external] of [['database', '5432/tcp', new URL(admission.dbUrl).port], ['api', '8000/tcp', new URL(admission.authUrl).port]] as const) {
    const roleId = expectedResources.roles[role]; need(/^[a-f0-9]{64}$/.test(roleId), 'full_role_container_id')
    const container = (resources.containers as unknown[][]).find(value => value[0] === roleId)
    need(container && container[7] === true, 'role_container_running')
    for (const ports of [container[8], container[9]]) same(row(ports)[internal], [{ HostIp: '127.0.0.1', HostPort: external }], 'role_endpoint_binding')
  }
  need(expectedResources.containerIds.includes(expectedResources.roles.storage), 'storage_resource_required')
  const receipts = admission.custody.receipts
  need(Object.keys(admission.custody.refs).some(ref => ref.includes('backend-')) && Object.keys(admission.custody.refs).some(ref => ref.includes('producer-')), 'held_business_pair_required')
  if (admission.schema === 'track1-cohort-business-admission-v2') {
    const observed = await parentCustodyRequest(admission, 'CUSTODY', {})
    need(observed.custodySha256 === cohortHash(admission.custody), 'parent_custody_changed')
  } else for (const [ref, expected] of Object.entries(admission.custody.refs)) {
    need(ref.startsWith('refs/tags/agent-claims/masterplan/') && /^[a-f0-9]{40}$/.test(expected), 'custody_ref')
    const observed = row(parseCohortJson(execute(['gh', 'api', 'repos/heke99/gridex-ops-platform/git/ref/' + ref.slice(5)])))
    need(row(observed.object).sha === expected && receipts.some(receipt => receipt.sha === expected), 'custody_changed')
  }
  if (admission.schema === 'track1-cohort-business-admission-v1') for (const receipt of receipts) {
    const observed = row(parseCohortJson(execute(['gh', 'api', 'repos/heke99/gridex-ops-platform/git/commits/' + receipt.sha])))
    need(row(observed.tree).sha === receipt.tree && bytesHash(text(observed.message)) === receipt.messageSha256, 'neutral_receipt_changed')
    same((observed.parents as JsonRow[]).map(parent => parent.sha), [receipt.parent], 'neutral_parent')
    const parent = row(parseCohortJson(execute(['gh', 'api', 'repos/heke99/gridex-ops-platform/git/commits/' + receipt.parent])))
    need(row(parent.tree).sha === receipt.tree, 'neutral_tree')
  }
  // Entire stable catalogs include function bodies/config/owners/ACLs, RLS,
  // policies, types, views/rules, triggers and role membership, not the old
  // selected-table fingerprint. The independently admitted identity pins this
  // exact observation protocol; no schema is repaired or migration inferred.
  const catalogs = ['pg_namespace', 'pg_class', 'pg_attribute', 'pg_proc', 'pg_policy', 'pg_constraint', 'pg_trigger', 'pg_type', 'pg_enum', 'pg_collation', 'pg_extension', 'pg_default_acl', 'pg_rewrite', 'pg_roles', 'pg_auth_members']
  const catalogSql = catalogs.map(table => {
    // Autovacuum's physical row/page/freeze statistics are observations, not
    // schema/security. All semantic class fields remain in the identity.
    const projection = table === 'pg_class' ? "to_jsonb(x)-'relpages'-'reltuples'-'relallvisible'-'relallfrozen'-'relfrozenxid'-'relminmxid'" : 'to_jsonb(x)'
    return `${literal(table)},(SELECT coalesce(jsonb_agg(${projection} ORDER BY (${projection})::text),'[]') FROM pg_catalog.${table} x)`
  }).join(',')
  const databaseStatement = `SELECT jsonb_build_object('sysid',(SELECT system_identifier::text FROM pg_control_system()),'major',current_setting('server_version_num')::int/10000,'catalogs',jsonb_build_object(${catalogSql}),'ledger',(SELECT jsonb_agg(to_jsonb(t) ORDER BY version) FROM supabase_migrations.schema_migrations t));`
  const database = row(parseCohortJson(execute(['psql', admission.dbUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1'], `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n${databaseStatement}\nCOMMIT;`).trim()))
  return { appCommit: admission.runtime.appCommit, appTree: admission.runtime.appTree, harnessCommit: admission.runtime.harnessCommit, harnessTree: admission.runtime.harnessTree,
    nextBuildId: readFileSync(path.join(buildRoot, 'BUILD_ID'), 'utf8').trim(), daemonId: JSON.parse(execute(['docker', 'info', '--format', '{{json .ID}}'])),
    databaseSystemIdentifier: text(database.sysid), serverMajor: integer(database.major), catalogSha256: cohortHash(database.catalogs), ledgerSha256: cohortHash(database.ledger),
    resourcesSha256: cohortHash(resources), immutableFilesSha256: cohortHash(immutable), custodySha256: cohortHash(admission.custody), appProcessSha256: listener(admission.appProcess, admission.appUrl) }
}

export function readCohortGraph(admission: BusinessAdmission, ids: CohortIds, oracle: Oracle, execute: ReadonlyCommand = command): ProtectedGraph {
      ID_FIELDS.forEach(key => uuid(ids[key])); const c = literal(ids.companyId)
      // RPC explicitly requires service_role. Only the session role changes;
      // both reads share one READ ONLY REPEATABLE READ snapshot. No grants,
      // persisted settings, helper migrations or product writes are performed.
      const script = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL ROLE service_role;\nSELECT public.gridex_read_billing_underlay_source_basis_v1(${c}::uuid,ARRAY(SELECT id FROM public.billing_underlays WHERE company_id=${c} AND underlay_year=2027 AND underlay_month=2));\nRESET ROLE;\n${protectedGraphSql(ids, oracle)}\nCOMMIT;`
      const lines = execute(['psql', admission.dbUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1'], script).trim().split('\n')
      need(lines.length === 2, 'readonly_snapshot_shape')
      const graph = parseCohortJson(lines[1]) as ProtectedGraph; graph.qualified = parseCohortJson(lines[0]) as JsonRow[]; return graph
}
function actualPorts(admission: BusinessAdmission): CohortPorts {
  return { now: Date.now, observeRuntime: observeCohortRuntime, authenticate: actualAuth,
    readGraph: async (ids, oracle) => readCohortGraph(admission, ids, oracle) }
}
function ownData(object: unknown, key: string): unknown {
  need(object && typeof object === 'object', 'cached_service_client_layout')
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  need(descriptor && Object.hasOwn(descriptor, 'value'), 'cached_service_client_layout')
  return descriptor.value
}
/** SDK2.103's constructor stores these data fields and closes the same key
 * into fetchWithAuth / initialized Auth headers. Inspect the actual singleton;
 * never accept a declared digest, use an API request, or serialize its secrets. */
export function assertCachedServiceClient(admission: BusinessAdmission, client: unknown): void {
  need(client && typeof client === 'object', 'cached_service_client_layout')
  let genuine = client instanceof SupabaseClient
  if (!genuine) {
    need(Object.getPrototypeOf(client) !== Object.prototype && Object.getPrototypeOf(client) !== null, 'cached_service_client_layout')
    // The pinned package has legitimate ESM and CJS constructors. Resolve CJS
    // from the already admitted harness module, never from an ambient cwd/PATH.
    need(path.isAbsolute(admission.harnessDir) && path.normalize(admission.harnessDir) === admission.harnessDir, 'cached_service_client_layout')
    try {
      const require = createRequire(path.join(admission.harnessDir, PROTOCOL_FILES[2]))
      const constructor: unknown = require('@supabase/supabase-js').SupabaseClient
      genuine = typeof constructor === 'function' && client instanceof constructor
    } catch { throw new Error('cohort_hold:cached_service_client_layout') }
  }
  need(genuine, 'cached_service_client_layout')
  const url = ownData(client, 'supabaseUrl'), credential = ownData(client, 'supabaseKey'), auth = ownData(client, 'auth')
  need(url === admission.authUrl && ownData(auth, 'url') === new URL('auth/v1', admission.authUrl + '/').href, 'cached_service_client_url')
  need(typeof credential === 'string' && credential.length > 0, 'cached_service_client_layout')
  const headers = row(ownData(auth, 'headers')), globalHeaders = row(ownData(client, 'headers'))
  need(!Object.keys(globalHeaders).some(key => ['apikey', 'authorization'].includes(key.toLowerCase())), 'cached_service_credential_override')
  need(Object.keys(headers).filter(key => key.toLowerCase() === 'apikey').length === 1 && Object.keys(headers).filter(key => key.toLowerCase() === 'authorization').length === 1, 'cached_service_credential_override')
  need(headers.apikey === credential && headers.Authorization === 'Bearer ' + credential, 'cached_service_credential_override')
  need(bytesHash(credential) === hash(admission.serviceRoleKeySha256), 'cached_service_client_credential')
}

export function assertCohortScenarioEnvironment(admission: BusinessAdmission, actualServiceClient: unknown,
  env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const expected: Record<string, string> = { TRACK1_RUN_DIR: admission.runDir, TRACK1_STACK_JSON: admission.stack.path, TRACK1_APP_URL: admission.appUrl,
    TRACK1_APP_DIR: admission.appDir, TRACK1_APP_COMMIT: admission.runtime.appCommit, TRACK1_APP_PORT: '3101', TRACK1_DB_URL: admission.dbUrl,
    SIM_HOME: admission.simHome, NEXT_PUBLIC_SUPABASE_URL: admission.authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: admission.anonKey }
  need(Object.entries(expected).every(([key, value]) => env[key] === value), 'ambient_scenario_binding')
  need(cwd === admission.harnessDir, 'captured_service_or_harness_binding')
  assertCachedServiceClient(admission, actualServiceClient)
  need(env.NEXT_PHASE !== 'phase-production-build' && env.SUPABASE_SERVICE_ROLE_KEY && bytesHash(env.SUPABASE_SERVICE_ROLE_KEY) === hash(admission.serviceRoleKeySha256), 'service_key_binding')
  // Integration with a future business assignment is a separate reviewed
  // source packet. Never reuse/unset/extend the currently smoke-only assignment.
  if (admission.schema === 'track1-cohort-business-admission-v1') need(!env.TRACK1_ASSIGNMENT_FILE, 'business_assignment_integration_required')
  else { assertPhasedAssignment(admission); need(env.TRACK1_ASSIGNMENT_FILE === admission.phaseAdapter!.assignment.path, 'business_assignment_binding') }
  privatePath(admission.simHome); readCohortFile(admission.stack, admission.privateHome)
}
export function loadCohortAdmissionFromEnv(phase: Phase, actualServiceClient?: unknown): { admission: BusinessAdmission; admissionSha256: string; ports: CohortPorts } {
  const file = process.env.TRACK1_COHORT_ADMISSION_FILE, expected = process.env.TRACK1_COHORT_ADMISSION_SHA256
  need(file && expected, 'separate_root_pinned_business_admission_missing')
  privatePath(path.dirname(file)); const admission = readCohortFile<BusinessAdmission>({ path: file, sha256: expected }, path.dirname(file))
  validateBusinessAdmission(admission, phase, Date.now())
  if (phase !== 'MAIN03_SEAL') assertCohortScenarioEnvironment(admission, actualServiceClient)
  let outsideGit = false
  try { outsideGit = execFileSync('git', ['-C', admission.privateHome, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() !== 'true' }
  catch (error) { outsideGit = (error as { status?: number }).status === 128 }
  need(outsideGit, 'private_home_inside_git')
  return { admission, admissionSha256: expected, ports: actualPorts(admission) }
}

export async function beginMain03CohortFromEnv(actualServiceClient: unknown, actualDefaults: Main03Params) {
  const context = loadCohortAdmissionFromEnv('MAIN03_CANDIDATE', actualServiceClient)
  const fixtureParams = validateMain03DefaultInput(context.admission, actualDefaults)
  same(await context.ports.observeRuntime(context.admission), context.admission.runtime, 'runtime_identity')
  return { ...context, fixtureParams }
}
export async function captureMain03Candidate(context: { admission: BusinessAdmission; ports: CohortPorts }, fixture: Main03Fixture, completed: string[], observation: JsonRow): Promise<FileRef> {
  const { admission, ports } = context
  validateBusinessAdmission(admission, 'MAIN03_CANDIDATE', ports.now()); same(completed, MAIN03_STEPS, 'five_complete_steps_required')
  const { approval, oracle } = inputOracle(admission); same(fixture.params, approval.params, 'fixture_params'); need(fixture.salt === approval.salt, 'chosen_salt_changed')
  const ids: CohortIds = { companyId: fixture.companyId, actorUserId: fixture.actorUserId, customerId: fixture.customerId, siteId: fixture.siteId, pointId: fixture.pointId,
    contractId: fixture.contractId, supplyPeriodId: fixture.supplyPeriodId, gridOwnerId: fixture.gridOwnerId, dataRequestId: fixture.dataRequestId }
  const runtime = await ports.observeRuntime(admission); same(runtime, admission.runtime, 'runtime_identity')
  const graph = await ports.readGraph(ids, oracle); verifyCohortGraph(graph, ids, oracle)
  need(graph.invoices.length === 0 && graph.exportItems.length === 0 && graph.exports.length === 0, 'candidate_already_invoiced')
  const auth = await ports.authenticate(fixture.session, admission); checkAuth(auth, ids, ports.now(), admission.phaseAdapter?.minimumAuthHeadroomMs)
  const sourceObservation = fixture.days.map(day => ({ day: day.day, sourceId: day.sourceId, transactionRef: day.transactionRef, bgmReference: day.bgmReference,
    rawSha256: day.rawSha256, normalizedIds: day.normalizedIds, meteringValueIds: day.meteringValueIds }))
  verifySourceObservation(sourceObservation, graph, oracle)
  const graphFile = appendCohortFile(admission.graphPath, graph, admission.privateHome)
  const authFile = appendCohortFile(admission.authPath, { schema: 'main03-private-actual-ssr-session-v1', session: fixture.session, expiresAtMs: auth.expiresAtMs }, admission.privateHome)
  const candidate: Candidate = { schema: 'main03-cohort-candidate-v1', state: 'CANDIDATE_NOT_ADMITTED', campaignId: admission.campaignId, operationId: admission.operationId, runId: admission.runId,
    createdAtMs: ports.now(), startedAfterMs: ms(admission.createdAtUtc), ids, runtime, inputApproval: admission.inputApproval, graph: graphFile, auth: authFile, completed, sourceObservation, unknownOutcome: observation['MAIN03.05'] }
  return appendCohortFile(admission.candidatePath, candidate, admission.privateHome)
}
function checkAuth(auth: AuthObservation, ids: CohortIds, now: number, minimumMs = 120_000) {
  same([auth.userId, auth.companyId], [ids.actorUserId, ids.companyId], 'auth_actor_or_company')
  need(auth.expiresAtMs > now + minimumMs && auth.permissions.includes('billing_underlay.export') && auth.permissions.includes('billing_underlay.read'), 'auth_expiry_or_permissions')
}
function verifySourceObservation(observation: unknown, graph: ProtectedGraph, oracle: Oracle) {
  need(Array.isArray(observation) && observation.length === 28, 'observed_source_vector')
  const observed = observation.map(row)
  need(new Set(observed.map(day => day.sourceId)).size === 28 && new Set(observed.map(day => day.day)).size === 28 && observed.every(day => Number.isInteger(day.day) && Number(day.day) >= 1 && Number(day.day) <= 28), 'original_source_bijection')
  for (const day of observation) {
    const record = row(day), source = graph.sources.find(source => source.id === record.sourceId)
    need(source && source.raw_sha256 === record.rawSha256 && source.transaction_ref === record.transactionRef && source.bgm === record.bgmReference, 'original_source_identity')
    const expected = graph.normalized.filter(value => value.source_message_id === source.id)
    same([...record.normalizedIds as string[]].sort(), expected.map(value => String(value.id)).sort(), 'original_normalized_ids')
    same([...record.meteringValueIds as string[]].sort(), expected.map(value => String(value.source_metering_value_id)).sort(), 'original_physical_ids')
    need(expected.length === 96 && expected.every(value => Math.floor((timestamp(value.period_start) - oracle.month.startMs) / 86_400_000) + 1 === record.day), 'original_day_partition')
  }
}

function verifyTerminal(admission: BusinessAdmission, candidate: Candidate) {
  need(admission.terminal && admission.resolution && admission.reports, 'terminal_and_native_resolution_required')
  const terminal = readCohortFile<JsonRow>(admission.terminal, admission.privateHome)
  need(terminal.schema === 'main03-observed-terminal-process-v1' && terminal.runId === candidate.runId && terminal.operationId === candidate.operationId && terminal.waitObserved === true && terminal.exitCode === 0, 'terminal_process_not_proved')
  const pid = integer(terminal.pid); need(pid > 1 && typeof terminal.startTicks === 'string' && ms(terminal.endedAtUtc) >= candidate.createdAtMs, 'terminal_identity')
  // A live original/reused PID is never accepted as a completed producer.
  try { lstatSync(`/proc/${pid}`); throw new Error('cohort_hold:producer_still_present') } catch (error) { need((error as NodeJS.ErrnoException).code === 'ENOENT', 'producer_still_present') }
  const references = admission.reports
  same([references.raw.path, references.meta.path, references.log.path], ['report.json', 'run-meta.json', 'run.log'].map(file => path.join(admission.runDir, file)), 'original_report_paths')
  same(terminal.reports, references, 'terminal_report_bindings')
  const raw = readCohortFile<JsonRow>(references.raw, admission.privateHome, 4 * 1024 * 1024)
  const normalized = readCohortFile<JsonRow>(references.normalized, admission.privateHome)
  const meta = readCohortFile<JsonRow>(references.meta, admission.privateHome)
  privatePath(references.log.path, admission.privateHome); const log = readFileSync(references.log.path); need(bytesHash(log) === references.log.sha256 && log.toString('utf8').trimEnd().endsWith('\nexit 0'), 'primary_log_terminal')
  need(raw.success === true && raw.numTotalTests === 5 && raw.numPassedTests === 5 && raw.numFailedTests === 0 && raw.numPendingTests === 0 && raw.numTodoTests === 0 && raw.numFailedTestSuites === 0, 'raw_report_global_failure')
  const suites = raw.testResults as JsonRow[]; need(Array.isArray(suites) && suites.length === 1 && suites[0].status === 'passed' && !suites[0].message, 'raw_suite_or_hook_failure')
  need(suites[0].name === path.join(admission.harnessDir, PROTOCOL_FILES[0]), 'raw_original_scenario')
  const assertions = suites[0].assertionResults as JsonRow[]; need(Array.isArray(assertions) && assertions.length === 5, 'raw_steps')
  same(assertions.map(assertion => text(assertion.title).split(' ')[0]), MAIN03_STEPS, 'raw_exact_steps')
  need(assertions.every(assertion => assertion.status === 'passed' && Array.isArray(assertion.failureMessages) && assertion.failureMessages.length === 0), 'raw_step_failure')
  need(normalized.runId === candidate.runId && normalized.runDir === admission.runDir && normalized.exitCode === 0 && normalized.error === null, 'normalized_run_identity')
  const steps = normalized.steps as JsonRow[]; need(Array.isArray(steps) && steps.length === 5, 'normalized_steps')
  same(steps.map(step => step.declaredStepId), MAIN03_STEPS, 'normalized_exact_steps'); need(steps.every(step => step.status === 'passed' && !step.failure), 'normalized_failure')
  need(normalized.scenarioFile === 'track1/scenarios/main03.test.ts', 'normalized_original_scenario')
  const counters = row(normalized.vitest)
  for (const key of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numFailedTestSuites', 'success']) need(counters[key] === raw[key], 'normalized_raw_disagree')
  need(meta.harnessCommit === admission.runtime.harnessCommit && meta.appCommit === admission.runtime.appCommit && meta.harnessDirty === false && meta.appDirty === false && meta.scenarioSha256 === admission.sourceManifest[PROTOCOL_FILES[0]], 'run_source_identity')
  need(ms(meta.runStartedAtUtc) <= candidate.createdAtMs && ms(meta.runStartedAtUtc) >= candidate.startedAfterMs && text(meta.scenarioFile).endsWith('track1/scenarios/main03.test.ts'), 'run_start_or_scenario')
  same(meta.stack, readCohortFile(admission.stack, admission.privateHome), 'run_stack_identity')
  const resolution = readCohortFile<JsonRow>(admission.resolution, admission.privateHome)
  need(resolution.schema === 'main03-independent-native-operation-resolution-v1' && resolution.runId === candidate.runId && resolution.operationId === candidate.operationId && resolution.databaseSystemIdentifier === candidate.runtime.databaseSystemIdentifier && resolution.outcome === 'COMMITTED_EXACT_COHORT_NO_INFLIGHT_ORIGINAL_HANDLER', 'unknown_operation_unresolved')
  // Neither poll counts nor the Vitest marker establish handler completion.
  need(resolution.proofKind === 'INDEPENDENT_NATIVE_OPERATION_LIFECYCLE' && typeof resolution.nativeOperationId === 'string' && resolution.nativeOperationId.length > 0 && Array.isArray(resolution.independentEvidence) && resolution.independentEvidence.length >= 2, 'native_lifecycle_proof_required')
  const lifecycleReviewers = (resolution.independentEvidence as FileRef[]).map(evidence => {
    const review = readCohortFile<JsonRow>(evidence, admission.privateHome, 4 * 1024 * 1024)
    need(review.schema === 'main03-native-operation-lifecycle-review-v1' && text(review.decision).startsWith('APPROVE') && review.runId === candidate.runId && review.operationId === candidate.operationId && review.nativeOperationId === resolution.nativeOperationId && review.terminalProcessSha256 === admission.terminal!.sha256 && review.candidateSha256 === admission.candidate?.sha256 && review.backendRuntimeSha256 === cohortHash(candidate.runtime), 'native_lifecycle_review_binding')
    need(review.reviewerId !== admission.producerId, 'self_lifecycle_review'); return text(review.reviewerId)
  })
  need(new Set(lifecycleReviewers).size >= 2, 'native_lifecycle_independence')
  need(row(candidate.unknownOutcome).provokedUnknownOutcome === true && row(candidate.unknownOutcome).retryStatus === 200, 'original_abort_stimulus')
}

export async function sealMain03Candidate(admission: BusinessAdmission, ports: CohortPorts): Promise<FileRef> {
  validateBusinessAdmission(admission, 'MAIN03_SEAL', ports.now()); need(admission.candidate, 'candidate_pin_missing')
  const candidate = readCohortFile<Candidate>(admission.candidate, admission.privateHome)
  need(candidate.schema === 'main03-cohort-candidate-v1' && candidate.state === 'CANDIDATE_NOT_ADMITTED' && candidate.runId === admission.runId && candidate.campaignId === admission.campaignId, 'candidate_identity')
  same(candidate.completed, MAIN03_STEPS, 'candidate_steps'); same(candidate.runtime, admission.runtime, 'candidate_backend')
  same(candidate.inputApproval, admission.inputApproval, 'candidate_input_admission')
  verifyTerminal(admission, candidate)
  const { oracle } = inputOracle(admission), original = readCohortFile<ProtectedGraph>(candidate.graph, admission.privateHome, 16 * 1024 * 1024)
  same(await ports.observeRuntime(admission), admission.runtime, 'runtime_identity')
  const graph = await ports.readGraph(candidate.ids, oracle); verifyCohortGraph(graph, candidate.ids, oracle); verifySourceObservation(candidate.sourceObservation, graph, oracle)
  same(graph, original, 'live_graph_changed_since_candidate')
  need(graph.invoices.length === 0 && graph.exportItems.length === 0 && graph.exports.length === 0, 'cohort_already_consumed')
  const sealed: Sealed = { schema: 'main03-sealed-cohort-v1', state: 'SEALED_MAIN03_SOURCE_COHORT_NOT_BUSINESS_PASS', candidate: admission.candidate, candidateValue: candidate,
    graphSha256: cohortHash(graph), inputApproval: admission.inputApproval, terminal: admission.terminal!, resolution: admission.resolution!, createdAtMs: ports.now(), expiresAtMs: ms(admission.expiresAtUtc) }
  return appendCohortFile(admission.sealedPath, sealed, admission.privateHome)
}

export async function adoptMain03Cohort(admission: BusinessAdmission, admissionSha256: string, ports: CohortPorts): Promise<Main04Cohort> {
  validateBusinessAdmission(admission, 'MAIN04_PREPARE_REVIEW', ports.now()); hash(admissionSha256); need(admission.sealed, 'sealed_pin_missing')
  const sealed = readCohortFile<Sealed>(admission.sealed, admission.privateHome)
  need(sealed.schema === 'main03-sealed-cohort-v1' && sealed.state === 'SEALED_MAIN03_SOURCE_COHORT_NOT_BUSINESS_PASS' && sealed.expiresAtMs > ports.now() + 60_000 && sealed.candidateValue.campaignId === admission.campaignId, 'sealed_state_or_expiry')
  const candidate = readCohortFile<Candidate>(sealed.candidate, admission.privateHome)
  same(candidate, sealed.candidateValue, 'sealed_candidate_changed'); same(candidate.runtime, admission.runtime, 'same_running_backend_required'); same(sealed.inputApproval, admission.inputApproval, 'same_input_review')
  const { approval, oracle } = inputOracle(admission), original = readCohortFile<ProtectedGraph>(candidate.graph, admission.privateHome, 16 * 1024 * 1024)
  same(await ports.observeRuntime(admission), admission.runtime, 'runtime_identity')
  const graph = await ports.readGraph(candidate.ids, oracle), underlayId = verifyCohortGraph(graph, candidate.ids, oracle)
  same(graph, original, 'protected_graph_changed'); need(cohortHash(graph) === sealed.graphSha256, 'sealed_graph_hash')
  need(graph.invoices.length === 0 && graph.exportItems.length === 0 && graph.exports.length === 0, 'already_prepared_or_exported')
  verifySourceObservation(candidate.sourceObservation, graph, oracle)
  const capsule = readCohortFile<{ schema: string; session: Session; expiresAtMs: number }>(candidate.auth, admission.privateHome)
  need(capsule.schema === 'main03-private-actual-ssr-session-v1' && capsule.expiresAtMs > ports.now() + 120_000, 'private_auth_expired')
  same([capsule.session.userId, capsule.session.companyId], [candidate.ids.actorUserId, candidate.ids.companyId], 'private_auth_identity')
  checkAuth(await ports.authenticate(capsule.session, admission), candidate.ids, ports.now(), admission.phaseAdapter?.minimumAuthHeadroomMs)
  appendCohortFile(admission.adoptedPath, { state: 'ADOPTED_READ_ONLY_BEFORE_PREPARE', admissionSha256, sealed: admission.sealed, underlayId,
    graphSha256: sealed.graphSha256, inputApproval: admission.inputApproval, basisKind: approval.basisKind, atMs: ports.now(), allowedNextAction: 'PREPARE_AND_REVIEW_ONLY_NO_APPROVAL' }, admission.privateHome)
  return { ...candidate.ids, params: approval.params, salt: approval.salt, oracle, session: capsule.session, underlayId, cohortSha256: admission.sealed.sha256,
    protocol: { admission, admissionSha256, sealed, graph, ports } }
}
export async function adoptMain03CohortFromEnv(actualServiceClient: unknown): Promise<Main04Cohort> {
  const context = loadCohortAdmissionFromEnv('MAIN04_PREPARE_REVIEW', actualServiceClient); return adoptMain03Cohort(context.admission, context.admissionSha256, context.ports)
}
export async function assertAdoptedCohortUnchanged(cohort: Main04Cohort): Promise<void> {
  const { admission, graph, ports } = cohort.protocol
  validateBusinessAdmission(admission, 'MAIN04_PREPARE_REVIEW', ports.now())
  same(await ports.observeRuntime(admission), admission.runtime, 'runtime_identity')
  const current = await ports.readGraph(cohort, cohort.oracle); verifyCohortGraph(current, cohort, cohort.oracle); same(current, graph, 'changed_before_prepare')
  checkAuth(await ports.authenticate(cohort.session, admission), cohort, ports.now())
}
export async function recordPreparedDraftCandidate(cohort: Main04Cohort, draft: unknown): Promise<FileRef> {
  const { admission, ports } = cohort.protocol
  validateBusinessAdmission(admission, 'MAIN04_PREPARE_REVIEW', ports.now())
  same(await ports.observeRuntime(admission), admission.runtime, 'runtime_identity')
  const graph = await ports.readGraph(cohort, cohort.oracle); verifyCohortGraph(graph, cohort, cohort.oracle)
  // Prepare can create/lock another pricing run. Source/input graph stays exact;
  // the new run is observed rather than guessed from MAIN03's latest preview.
  const protectedPart = (value: ProtectedGraph) => Object.fromEntries(Object.entries(value).filter(([key]) => !['pricingRuns', 'pricingEvidence', 'invoices', 'exportItems', 'exports', 'underlays'].includes(key)))
  same(protectedPart(graph), protectedPart(cohort.protocol.graph), 'source_changed_during_prepare')
  need(graph.invoices.length === 1 && graph.exportItems.length === 1 && graph.exports.length === 0, 'prepared_graph_count')
  const invoice = graph.invoices[0], item = graph.exportItems[0], snapshot = row(invoice.calculation_snapshot)
  need(invoice.billing_underlay_id === cohort.underlayId && invoice.invoice_export_item_id === item.id && item.billing_underlay_id === cohort.underlayId, 'prepared_invoice_lineage')
  const locked = graph.pricingRuns.filter(run => run.id === item.pricing_run_id)
  need(locked.length === 1 && locked[0].status === 'locked' && locked[0].locked_at, 'observed_locked_pricing')
  const money = (value: unknown) => {
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value)); need(match, 'money_scale')
    return integer((match[1] ? -1 : 1) * (Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'))))
  }
  const expectedMoney = [cohort.oracle.totalExVatCents, cohort.oracle.vatCents.total, cohort.oracle.totalIncVatCents]
  for (const record of [invoice, item]) same([money(record.amount_ex_vat), money(record.vat_amount), money(record.amount_inc_vat)], expectedMoney, 'fresh_money_oracle')
  same([money(locked[0].total_ex_vat), money(locked[0].vat_amount), money(locked[0].total_inc_vat)], expectedMoney, 'fresh_money_oracle')
  same([money(snapshot.subtotal_sek_ex_vat), money(snapshot.vat_sek), money(snapshot.total_sek_inc_vat)], expectedMoney, 'fresh_snapshot_money_oracle')
  need(snapshot.billing_underlay_id === cohort.underlayId && quantity(String(snapshot.total_kwh)) === cohort.oracle.totalMilliKwh, 'fresh_snapshot_source_quantity')
  const lines = snapshot.pricing_lines as JsonRow[]; need(Array.isArray(lines) && lines.length === 3, 'fresh_snapshot_lines')
  const spot = lines.filter(line => row(line.metadata).source_type === 'spot'), markup = lines.filter(line => row(line.metadata).source_type !== 'spot' && line.unit === 'kWh'), fee = lines.filter(line => row(line.metadata).source_type !== 'spot' && line.unit === 'månad')
  need(spot.length === 1 && markup.length === 1 && fee.length === 1, 'fresh_snapshot_line_types')
  same([money(spot[0].amountExVat), money(markup[0].amountExVat), money(fee[0].amountExVat)], [cohort.oracle.lines.spotCents, cohort.oracle.lines.markupCents, cohort.oracle.lines.monthlyFeeCents], 'fresh_line_money_oracle')
  same([money(spot[0].vatAmount), money(markup[0].vatAmount), money(fee[0].vatAmount)], [cohort.oracle.vatCents.spot, cohort.oracle.vatCents.markup, cohort.oracle.vatCents.monthlyFee], 'fresh_line_vat_oracle')
  hash(invoice.calculation_snapshot_sha256)
  const evidence = snapshot.interval_evidence as JsonRow[]; need(Array.isArray(evidence) && evidence.length === 2688, 'draft_full_evidence')
  const items = new Map(graph.items.map(item => [String(item.id), item])), seen = new Set<string>()
  const native = graph.pricingEvidence.filter(value => value.pricing_run_id === item.pricing_run_id); unique(native, 'id', 2688)
  const nativeById = new Map(native.map(value => [String(value.id), value])), expectedByStart = new Map(cohort.oracle.intervals.map(value => [value.startMs, value]))
  for (const entry of evidence) {
    const original = items.get(uuid(entry.billingUnderlayItemId)); need(original && !seen.has(String(original.id)), 'draft_evidence_bijection'); seen.add(String(original.id))
    const expected = expectedByStart.get(timestamp(original.period_start)); need(expected, 'draft_interval_start')
    need(timestamp(entry.meteringIntervalStart) === expected.startMs && timestamp(entry.meteringIntervalEnd) === expected.endMs && quantity(String(entry.consumptionKwh)) === expected.milliKwh, 'draft_source_quantity')
    need(scaled5(String(entry.priceSekPerKwh)) === expected.spotE5 && entry.priceArea === 'SE3', 'draft_evidence_price')
    const actual = nativeById.get(uuid(entry.id)); need(actual && actual.company_id === cohort.companyId && actual.billing_underlay_id === cohort.underlayId && actual.billing_underlay_item_id === original.id, 'draft_native_evidence_edge')
    need(timestamp(actual.metering_interval_start) === expected.startMs && timestamp(actual.metering_interval_end) === expected.endMs && quantity(String(actual.consumption_kwh)) === expected.milliKwh, 'draft_native_evidence_quantity')
    need(scaled5(String(actual.price_sek_per_kwh)) === expected.spotE5 && actual.price_source_id === entry.priceSourceId && graph.spots.some(price => price.id === actual.price_source_id && timestamp(price.time_start) <= expected.startMs && timestamp(price.time_end) >= expected.endMs), 'draft_native_price_source')
  }
  return appendCohortFile(admission.draftPath, { state: 'PREPARED_DRAFT_CANDIDATE_INDEPENDENT_REVIEW_HOLD_NO_APPROVAL', cohortSha256: cohort.cohortSha256,
    inputApproval: admission.inputApproval, invoiceId: invoice.id, itemId: item.id, underlayId: cohort.underlayId, pricingRunId: item.pricing_run_id,
    calculationSnapshotSha256: invoice.calculation_snapshot_sha256, completeStoredSnapshotSha256: cohortHash(snapshot), snapshot,
    sourceGraphSha256: cohortHash(protectedPart(graph)), priorPricingRuns: cohort.protocol.graph.pricingRuns.map(run => run.id), observedPricingRuns: graph.pricingRuns.map(run => run.id),
    draftObservation: draft, atMs: ports.now(), independentDraftAcceptance: 'NOT_ESTABLISHED', allowedNextAction: 'INDEPENDENT_READ_ONLY_DRAFT_REVIEW_ONLY' }, admission.privateHome)
}

// Importing the module never seals. The CLI requires an explicit subcommand,
// exact root-pinned separate seal admission, real terminal proof and live reads.
if (process.argv[2] === 'seal' && process.argv[1]?.endsWith('/main03Cohort.ts')) {
  void (async () => { const context = loadCohortAdmissionFromEnv('MAIN03_SEAL'); await sealMain03Candidate(context.admission, context.ports) })()
    .then(() => { process.stdout.write('SOURCE_COHORT_SEALED_NOT_BUSINESS_PASS\n') }).catch(() => { process.stderr.write('cohort_hold:seal_failed\n'); process.exitCode = 1 })
}

// A source/resource basis contains only already observed identities and source
// inputs. Full runtime hashes are computed here before any business admission
// is constructed; absent future hashes are never replaced with placeholders.
if (process.argv[2] === 'observe-basis' && process.argv[1]?.endsWith('/main03Cohort.ts')) {
  void (async () => {
    const file = process.env.TRACK1_COHORT_ADMISSION_FILE, digest = process.env.TRACK1_COHORT_ADMISSION_SHA256
    need(file && digest, 'observation_basis_missing')
    const home = path.dirname(file), basis = readCohortFile<BusinessAdmission>({ path: file, sha256: digest }, home)
    need(file === path.join(home, 'phase-basis.json') && basis.privateHome === home
      && basis.schema === 'track1-cohort-business-admission-v2', 'observation_basis_path')
    const observed = await observeCohortRuntime(basis)
    appendCohortFile(path.join(home, 'phase-runtime-observed.json'), observed, home)
  })().catch(() => { process.stderr.write('cohort_hold:runtime_observation_failed\n'); process.exitCode = 1 })
}

// Fixed read-only parent observer; no arbitrary SQL/argv or Auth request.
if (process.argv[2] === 'observe-retry-graph' && process.argv[1]?.endsWith('/main03Cohort.ts')) {
  void (async () => {
    const file = process.env.TRACK1_COHORT_ADMISSION_FILE, digest = process.env.TRACK1_COHORT_ADMISSION_SHA256
    need(file && digest, 'retry_observation_admission')
    const home = path.dirname(path.dirname(file)), admission = readCohortFile<BusinessAdmission>({ path: file, sha256: digest }, home)
    validateBusinessAdmission(admission, 'MAIN03_CANDIDATE', Date.now())
    const factsFile = path.join(home, 'business/retry-facts.json'), raw = readFileSync(factsFile)
    need(bytesHash(raw) === process.env.TRACK1_RETRY_FACTS_SHA256, 'retry_observation_facts')
    const facts = row(parseCohortJson(raw.toString('utf8')))
    const ids = Object.fromEntries(ID_FIELDS.map(key => [key, uuid(row(facts.ids)[key])])) as CohortIds
    const graph = readCohortGraph(admission, ids, inputOracle(admission).oracle)
    process.stdout.write(JSON.stringify({ graphSha256: cohortHash(graph), graph }))
  })().catch(() => { process.stderr.write('cohort_hold:retry_observation_failed\n'); process.exitCode = 1 })
}

/** Integrated v2 has a distinct immutable prepared assignment. Old smoke and
 * standalone admissions cannot silently acquire these business privileges. */
export function assertPhasedAssignment(admission: BusinessAdmission): void {
  const bridge = admission.phaseAdapter
  need(admission.schema === 'track1-cohort-business-admission-v2' && bridge?.schema === 'track1-parent-custody-ipc-v1', 'phased_assignment_required')
  const assigned = readCohortFile<JsonRow>(bridge.assignment, admission.privateHome)
  need(assigned.schema === 'track1-runtime-assignment-v3' && assigned.mode === 'coordinator_prepared_phased'
    && assigned.reportKind === 'phased_cohort' && assigned.preparedReceiptSha256 === bridge.preparedSha256, 'phased_assignment_version')
  same([assigned.simHome, assigned.appDir, assigned.harnessDir, assigned.appCommit, assigned.appTree, assigned.harnessCommit, assigned.harnessTree],
    [admission.simHome, admission.appDir, admission.harnessDir, admission.runtime.appCommit, admission.runtime.appTree, admission.runtime.harnessCommit, admission.runtime.harnessTree], 'phased_assignment_source')
  const prepared = readCohortFile<JsonRow>({ path: text(assigned.preparedReceiptFile), sha256: hash(assigned.preparedReceiptSha256) }, admission.privateHome)
  need(prepared.schema === 'track1-prepared-runtime-v3' && prepared.databaseSystemIdentifier === admission.runtime.databaseSystemIdentifier, 'phased_prepared_backend')
  need(assigned.businessLocalServiceKeySha256 === admission.serviceRoleKeySha256 && assigned.minimumAuthHeadroomMs === bridge.minimumAuthHeadroomMs
    && Number.isSafeInteger(bridge.minimumAuthHeadroomMs) && bridge.minimumAuthHeadroomMs >= 120_000, 'phased_local_credential_and_Auth_budget')
  const observation = readCohortFile<RuntimeIdentity>(bridge.runtimeObservation, admission.privateHome)
  same(observation, admission.runtime, 'phased_actual_observation')
  need(bridge.deadlineAtMs <= ms(admission.expiresAtUtc) && bridge.deadlineAtMs > Date.now(), 'phased_deadline')
  need(/^[a-f0-9]{64}$/.test(bridge.nonce) && bridge.socketPath === path.join(admission.privateHome, 'phase.sock'), 'phased_socket_binding')
}

/** Only two fixed operations. Credentials stay in the parent; the server
 * authenticates this actual Unix peer against its recorded child session. */
export async function parentCustodyRequest(admission: BusinessAdmission, action: 'CUSTODY' | 'BEFORE_RETRY', facts: JsonRow): Promise<JsonRow> {
  const bridge = admission.phaseAdapter
  need(bridge && bridge.schema === 'track1-parent-custody-ipc-v1', 'parent_custody_required')
  privatePath(admission.privateHome)
  const socket = lstatSync(bridge.socketPath)
  need(socket.isSocket() && socket.uid === process.getuid?.() && (socket.mode & 0o777) === 0o600 && !socket.isSymbolicLink(), 'parent_socket_identity')
  const parent = bridge.parent
  need(Number.isSafeInteger(parent.pid) && parent.pid > 1, 'parent_pid')
  const checkParent = () => {
    const raw = readFileSync(`/proc/${parent.pid}/stat`, 'utf8'), fields = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/)
    need(fields[0] !== 'Z' && fields[19] === parent.startTicks && bytesHash(readFileSync(`/proc/${parent.pid}/exe`)) === parent.exeSha256
      && readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() === parent.bootId, 'parent_birth_changed')
  }
  checkParent()
  const requestId = randomUUID(), deadline = Math.min(bridge.deadlineAtMs, ms(admission.expiresAtUtc))
  need(deadline > Date.now() + 60_000, 'parent_deadline_headroom')
  const request = { schema: bridge.schema, action, requestId, nonce: bridge.nonce, assignmentSha256: bridge.assignment.sha256,
    admissionSha256: process.env.TRACK1_COHORT_ADMISSION_SHA256, runId: admission.runId, operationId: admission.operationId, phase: admission.phase, facts }
  return new Promise((resolve, reject) => {
    const stream = connect(bridge.socketPath); const buffers: Buffer[] = []; let size = 0
    const fail = () => { stream.destroy(); reject(new Error('cohort_hold:parent_custody_unavailable')) }
    stream.setTimeout(Math.min(deadline - Date.now(), 600_000), fail)
    stream.once('error', fail); stream.once('connect', () => stream.end(canonical(request) + '\n'))
    stream.on('data', (buffer: Buffer) => { size += buffer.length; if (size > 256 * 1024) fail(); else buffers.push(buffer) })
    stream.once('end', () => {
      try {
        checkParent(); need(Date.now() < deadline, 'parent_deadline')
        const reply = row(parseCohortJson(Buffer.concat(buffers).toString('utf8')))
        need(reply.schema === bridge.schema && reply.requestId === requestId && reply.nonce === bridge.nonce
          && reply.assignmentSha256 === bridge.assignment.sha256 && reply.action === action && reply.state === 'OBSERVED', 'parent_reply_binding')
        resolve(row(reply.observation))
      } catch { fail() }
    })
  })
}

export async function awaitMain03RetryPermit(context: { admission: BusinessAdmission; ports: CohortPorts }, fixture: Main03Fixture, facts: JsonRow): Promise<void> {
  const { admission, ports } = context
  validateBusinessAdmission(admission, 'MAIN03_CANDIDATE', ports.now())
  need(admission.schema === 'track1-cohort-business-admission-v2' && facts.aborted === true, 'native_resolution_required')
  uuid(facts.nativeOperationId)
  const ids = Object.fromEntries(ID_FIELDS.map(key => [key, fixture[key]])) as CohortIds
  const auth = await ports.authenticate(fixture.session, admission)
  checkAuth(auth, ids, ports.now(), admission.phaseAdapter?.minimumAuthHeadroomMs)
  same(await ports.observeRuntime(admission), admission.runtime, 'runtime_before_retry_hold')
  const { oracle } = inputOracle(admission), before = await ports.readGraph(ids, oracle)
  const permit = await parentCustodyRequest(admission, 'BEFORE_RETRY', { ...facts, ids, auth: { userId: auth.userId, companyId: auth.companyId, expiresAtMs: auth.expiresAtMs, canRead: auth.permissions.includes('billing_underlay.read'), canExport: auth.permissions.includes('billing_underlay.export') }, graphSha256: cohortHash(before), runtimeSha256: cohortHash(admission.runtime) })
  need(permit.nativeOperationId === facts.nativeOperationId && permit.decision === 'RETRY_ONCE'
    && permit.graphSha256 === cohortHash(before) && permit.runtimeSha256 === cohortHash(admission.runtime)
    && Number.isSafeInteger(permit.permitExpiresAtMs) && Number(permit.permitExpiresAtMs) <= admission.phaseAdapter!.deadlineAtMs, 'native_permit_binding')
  // A permit never replaces fresh Auth/custody/runtime/graph observations.
  checkAuth(await ports.authenticate(fixture.session, admission), ids, ports.now(), admission.phaseAdapter?.minimumAuthHeadroomMs)
  same(await ports.observeRuntime(admission), admission.runtime, 'runtime_after_retry_hold')
  same(await ports.readGraph(ids, oracle), before, 'graph_changed_during_retry_hold')
  need(Date.now() < Number(permit.permitExpiresAtMs), 'native_permit_expired_before_retry')
}
