import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { preparationProducerScope, prepareAtomicNative } from '../scripts/simulation/track4/lib/atomicNativePreparation.mjs'

import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createOutputHome, main, readPrivateJson, realAdapters, verifyLocalDockerBindings, verifyNeutralProducerCapsule, FINAL_SOURCE_PREDICATE } from '../scripts/simulation/track4/prepare-atomic-native.mjs'

import { PGlite } from '@electric-sql/pglite'

const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const sha = 'a'.repeat(64)
const source = { commit: '1'.repeat(40), tree: '2'.repeat(40), buildEvidenceSha256: sha,
  genArtifacts: Object.fromEntries(['supabase/schema.sql', 'supabase/database.types.ts', 'supabase/schema.fingerprint.json',
    'scripts/migration-history-manifest.json', 'scripts/supabase-types-manifest.json'].map((path) => [path, sha])) }
const harness = { root: '/private/preparer', commit: '4'.repeat(40), tree: '5'.repeat(40),
  files: Object.fromEntries(['scripts/simulation/track4/lib/atomicNativePreparation.mjs',
    'scripts/simulation/track4/prepare-atomic-native.mjs',
    '__tests__/simulation-track4-atomic-native-preparation.test.ts'].map((path) => [path, sha])) }
const backend = {
  daemonId: 'owned-daemon', dockerRootDir: '/owned/docker', driver: 'overlay2',
  databaseContainerId: 'd'.repeat(64), apiContainerId: 'e'.repeat(64), databaseSystemIdentifier: '12345',
  socketPath: '/var/run/docker.sock', socketDev: '10', socketIno: '20', appPid: 123,
  appStartTicks: '10000', appPort: 3104, containerIds: ['d'.repeat(64), 'e'.repeat(64)], networkIds: ['network'], volumeNames: ['volume'],
}
function fixture() {
  const companyId = uuid('1'), otherCompanyId = uuid('2')
  const actors = Object.fromEntries(['a', 'a2', 'b'].map((key, index) => [key, {
    id: uuid(String(index + 3)), email: `${key}@synthetic.invalid`, password: 'private-fixture-password',
  }]))
  const targets = Object.fromEntries(['concurrent', 'contextDrift', 'rollback'].map((key, index) => [key, {
    underlayId: uuid(String(index + 6)), billingMonth: `2026-0${index + 7}`,
  }]))
  const input = {
    format: 't4_atomic_native_preparation_input_v1', source, harness, backend,
    expiresAt: '2026-11-01T18:00:00Z', appUrl: 'http://127.0.0.1:3104',
    companyId, otherCompanyId, actors, targets, tools: { supabaseCli: { path: '/private/cli/supabase', sha256: sha } }, cohort: { path: '/private/cohort.json', sha256: sha },
    producer: { ref: 'refs/tags/agent-claims/masterplan/producer-t4-atomic-native-test', nativeResource: 'producer-t4-atomic-native-test', inputEpoch: 'owned-input-epoch', outputHome: '/private/producer/atomic-preparation', attempt: { path: '/private/producer/attempt.json', sha256: sha }, receipt: '3'.repeat(40),
      bodySha256: sha, agent: 'owned-producer', slot: 'owned-slot' },
  }
  const provenance = { normalizedIdsSha256: sha, sourceBasisSha256: sha,
    sourceMessages: [{ id: uuid('9'), payloadSha256: sha }] }
  const cohort = { format: 't4_retained_atomic_native_cohort_v1', sourceCommit: source.commit, companyId,
    targets: Object.fromEntries(Object.entries(targets).map(([name, target]) => [name, { ...target, provenance }])) }
  const events: Array<Record<string, unknown>> = []
  const sessions: string[] = []
  const prepared = new Set<string>()
  const observeTarget = async (name: string) => {
    const target = targets[name]
    return { ...target, companyId, sourceQualified: true, finalSourceCount: 2688,
      allSourcesFinal: true, ready: true, graphHash: sha, provenance,
      eligibleUnderlayIds: prepared.has(name) ? [] : [target.underlayId],
      graphs: prepared.has(name) ? [{ exportItemId: uuid(String(['concurrent', 'contextDrift', 'rollback'].indexOf(name) + 1)),
        underlayId: target.underlayId, pending: true, mirrorDraft: true, lockedPricing: true,
        initialApprovalEvents: 0, initialOutboxRows: 0, graphHash: sha }] : [] }
  }
  const io = {
    now: () => Date.parse('2026-11-01T17:00:00Z'),
    verifyProducer: vi.fn(async () => ({ ...input.producer, source: source.commit, epoch: 'gridex-five-agent-20261012', protocol: 'masterplan-reservation-v1',
      neutralVerified: true, attemptVerified: true, scope: preparationProducerScope(input) })),
    observeHost: vi.fn(async () => ({ source, harness, backend, effectiveRamBytes: 9 * 2 ** 30,
      freeDockerBytes: 50 * 2 ** 30, appStartedAfterBuild: true, appBuildAndEnvironmentBound: true })),
    observeDatabase: vi.fn(async () => ({ databaseSystemIdentifier: backend.databaseSystemIdentifier,
      majorVersion: 17, approvalSourceBound: true, status: {
        API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'private-service', ANON_KEY: 'private-anon',
      } })),
    verifyCohort: vi.fn(async () => cohort),
    signIn: vi.fn(async (key: string) => { sessions.push(key); return { key, userId: actors[key].id } }),
    permissions: vi.fn(async (session: { key: string }, targetCompany: string) => ({
      authorized: session.key === 'b' ? targetCompany === otherCompanyId : targetCompany === companyId,
      userId: actors[session.key].id,
    })),
    observeTarget: vi.fn(observeTarget),
    prepareMonth: vi.fn(async (_session: unknown, month: string) => {
      const names = Object.keys(targets).filter((key) => targets[key].billingMonth === month)
      names.forEach((name) => prepared.add(name))
      return { status: 200, body: { mode: 'prepare_only', approval_required: true,
        data: { created: names.length, failed: 0, alreadyPrepared: 0, blocked: 0 } }, bodySha256: sha }
    }),
    evidence: vi.fn(async (event: Record<string, unknown>) => { events.push(event) }),
    signOut: vi.fn(async () => undefined),
  }
  return { input, io, events, prepared, sessions }
}

describe('T4 normal-flow atomic-native preparation contract (controlled adapters only)', () => {
  it('uses authenticated prepare-only requests and emits the exact c8c fixture after cleanup', async () => {
    const { input, io } = fixture()
    const result = await prepareAtomicNative(input, io)
    expect(io.prepareMonth).toHaveBeenCalledTimes(3)
    expect(io.signOut).toHaveBeenCalledTimes(3)
    expect(result.fixture.format).toBe('t4_invoice_approval_native_fixture_v1')
    expect(result.fixture.permittedActorIds).toEqual([input.actors.a.id, input.actors.a2.id])
    expect(Object.values(result.fixture.graphs)).toHaveLength(3)
    expect(result.state).toBe('PREPARED_INPUTS_NOT_NATIVE_ACCEPTANCE')
    expect(result).not.toHaveProperty('PASS')
  })

  it.each(['capacity', 'source', 'old-app', 'environment', 'producer', 'database'])(
    'rejects %s drift before authentication or preparation', async (fault) => {
      const { input, io } = fixture()
      if (fault === 'capacity') io.observeHost.mockImplementation(async () => ({
        source, harness, backend, effectiveRamBytes: 7 * 2 ** 30, freeDockerBytes: 50 * 2 ** 30,
        appStartedAfterBuild: true, appBuildAndEnvironmentBound: true,
      }))
      if (fault === 'source') input.source = { ...source, tree: 'f'.repeat(40) }
      if (fault === 'old-app') io.observeHost.mockImplementation(async () => ({
        source, harness, backend, effectiveRamBytes: 9 * 2 ** 30, freeDockerBytes: 50 * 2 ** 30,
        appStartedAfterBuild: false, appBuildAndEnvironmentBound: true,
      }))
      if (fault === 'environment') io.observeHost.mockImplementation(async () => ({
        source, harness, backend, effectiveRamBytes: 9 * 2 ** 30, freeDockerBytes: 50 * 2 ** 30,
        appStartedAfterBuild: true, appBuildAndEnvironmentBound: false,
      }))
      if (fault === 'producer') io.verifyProducer.mockImplementation(async () => ({
        ...input.producer, receipt: '0'.repeat(40), source: source.commit, epoch: 'gridex-five-agent-20261012',
        protocol: 'masterplan-reservation-v1', neutralVerified: true, attemptVerified: true, scope: preparationProducerScope(input),
      }))
      if (fault === 'database') io.observeDatabase.mockImplementation(async () => ({
        databaseSystemIdentifier: 'wrong', majorVersion: 17, approvalSourceBound: true,
        status: { API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'private-service', ANON_KEY: 'private-anon' },
      }))
      await expect(prepareAtomicNative(input, io)).rejects.toThrow()
      expect(io.signIn).not.toHaveBeenCalled()
      expect(io.prepareMonth).not.toHaveBeenCalled()
    },
  )

  it('checks capacity before any database connection', async () => {
    const { input, io } = fixture()
    io.observeHost.mockRejectedValue(new Error('owned_capacity_hold'))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('owned_capacity_hold')
    expect(io.observeDatabase).not.toHaveBeenCalled()
  })

  it('rejects another eligible underlay because the endpoint prepares the whole month', async () => {
    const { input, io } = fixture()
    const original = io.observeTarget.getMockImplementation()!
    io.observeTarget.mockImplementation(async (name) => ({ ...await original(name),
      eligibleUnderlayIds: [input.targets[name].underlayId, uuid('9')],
    }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('month_scope_not_exclusive')
    expect(io.prepareMonth).not.toHaveBeenCalled()
    expect(io.signOut).toHaveBeenCalledTimes(3)
  })

  it('rejects unqualified/final-source gaps without mutation', async () => {
    const { input, io } = fixture()
    const original = io.observeTarget.getMockImplementation()!
    io.observeTarget.mockImplementation(async (name) => ({ ...await original(name), allSourcesFinal: false }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('retained_final_underlay_required')
    expect(io.prepareMonth).not.toHaveBeenCalled()
  })

  it('does one readback and stops after an unknown prepare outcome, without another POST', async () => {
    const { input, io, events } = fixture()
    io.prepareMonth.mockRejectedValue(new Error('private-token-must-not-leak'))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('prepare_outcome_unqualified_no_retry')
    expect(io.prepareMonth).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.phase === 'prepare-unknown-readback')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('private-token-must-not-leak')
    expect(io.signOut).toHaveBeenCalledTimes(3)
  })

  it('does not publish a fixture when local session cleanup fails', async () => {
    const { input, io } = fixture()
    io.signOut.mockRejectedValue(new Error('private-refresh-token'))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('owned_session_cleanup_failed')
    expect(io.signOut).toHaveBeenCalledTimes(3)
  })

  it('rejects non-loopback URLs before all adapter calls', async () => {
    const { input, io } = fixture()
    input.appUrl = 'https://production.invalid'
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('fixed_local_app_required')
    expect(io.verifyProducer).not.toHaveBeenCalled()
  })
})


describe('T4 preparation additional negative boundaries', () => {
  it('rejects arbitrary cohort JSON even when its private file hash was supplied', async () => {
    const { input, io } = fixture()
    io.verifyCohort.mockResolvedValue({} as Awaited<ReturnType<typeof io.verifyCohort>>)
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('qualified_retained_cohort_facts_required')
    expect(io.signIn).not.toHaveBeenCalled()
  })

  it('rejects a retained source-payload mismatch rather than relabeling it as this cohort', async () => {
    const { input, io } = fixture()
    const original = io.observeTarget.getMockImplementation()!
    io.observeTarget.mockImplementation(async (name) => ({ ...await original(name), provenance: {
      normalizedIdsSha256: sha, sourceBasisSha256: sha,
      sourceMessages: [{ id: uuid('9'), payloadSha256: '0'.repeat(64) }],
    } }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('retained_cohort_provenance_changed')
    expect(io.prepareMonth).not.toHaveBeenCalled()
  })

  it('requires bound schema/type/manifest GEN source artifacts', async () => {
    const { input, io } = fixture()
    input.source = { ...source, genArtifacts: {} }
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('exact_gen_artifacts_required')
    expect(io.verifyProducer).not.toHaveBeenCalled()
  })

  it('rejects expired input before producer, Auth or business calls', async () => {
    const { input, io } = fixture()
    input.expiresAt = '2026-11-01T16:00:00Z'
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('preparation_input_expired')
    expect(io.verifyProducer).not.toHaveBeenCalled()
  })

  it('does not accept the separate GEN producer as native admission', async () => {
    const { input, io } = fixture()
    input.producer.nativeResource = 'producer-gen'
    input.producer.ref = 'refs/tags/agent-claims/masterplan/producer-gen'
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('existing_producer_binding_required')
    expect(io.verifyProducer).not.toHaveBeenCalled()
  })

  it('rejects a sealed producer scope from a different backend or output home', async () => {
    const { input, io } = fixture()
    const scope = preparationProducerScope(input)
    io.verifyProducer.mockImplementation(async () => ({ ...input.producer, source: source.commit,
      epoch: 'gridex-five-agent-20261012', protocol: 'masterplan-reservation-v1', neutralVerified: true, attemptVerified: true,
      scope: { ...scope, backendSha256: '0'.repeat(64) } }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('live_producer_binding_changed')
    expect(io.observeHost).not.toHaveBeenCalled()
  })

  it('keeps the40GiB vfs gate rather than the overlay threshold', async () => {
    const { input, io } = fixture()
    input.backend = { ...backend, driver: 'vfs' }
    io.observeHost.mockImplementation(async () => ({ source, harness, backend: input.backend,
      effectiveRamBytes: 9 * 2 ** 30, freeDockerBytes: 39 * 2 ** 30,
      appStartedAfterBuild: true, appBuildAndEnvironmentBound: true }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('owned_capacity_hold')
    expect(io.observeDatabase).not.toHaveBeenCalled()
  })

  it('rejects actor identity substitution and signs out the session actually created', async () => {
    const { input, io } = fixture()
    io.signIn.mockImplementation(async (key: string) => ({ key, userId: uuid('9') }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('actual_auth_actor_mismatch')
    expect(io.signOut).toHaveBeenCalledTimes(1)
    expect(io.prepareMonth).not.toHaveBeenCalled()
  })

  it('does not accept a B actor whose real context also permits companyA', async () => {
    const { input, io } = fixture()
    io.permissions.mockImplementation(async (session: { key: string }) => ({
      authorized: true, userId: input.actors[session.key].id,
    }))
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('other_company_actor_must_be_denied')
    expect(io.prepareMonth).not.toHaveBeenCalled()
    expect(io.signOut).toHaveBeenCalledTimes(3)
  })

  it('reconciles a500 response but never retries that business operation', async () => {
    const { input, io, events } = fixture()
    io.prepareMonth.mockResolvedValue({ status: 500, body: { mode: 'prepare_only', approval_required: true,
      data: { created: 0, failed: 1, alreadyPrepared: 0, blocked: 0 } }, bodySha256: sha })
    await expect(prepareAtomicNative(input, io)).rejects.toThrow('normal_prepare_response_unqualified_no_retry')
    expect(io.prepareMonth).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.phase === 'prepare-unqualified-readback')).toBe(true)
  })
})

const privateRoots: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  for (const path of privateRoots.splice(0)) rmSync(path, { recursive: true, force: true })
})
function privateRoot() {
  const path = mkdtempSync(join(tmpdir(), 't4-preparation-source-test-'))
  chmodSync(path, 0o700)
  privateRoots.push(path)
  return path
}

describe('T4 private output and real HTTP adapter controls', () => {
  it('refuses symlinked or nonprivate input files without reading credentials', () => {
    const root = privateRoot(), input = join(root, 'input.json')
    writeFileSync(input, '{"private":"fixture-only"}', { mode: 0o600 })
    expect(readPrivateJson(input)).toEqual({ private: 'fixture-only' })
    const alias = join(root, 'alias.json')
    symlinkSync(input, alias)
    expect(() => readPrivateJson(alias)).toThrow('private_input_invalid')
    chmodSync(input, 0o644)
    expect(() => readPrivateJson(input)).toThrow('private_input_invalid')
  })

  it('publishes only0600 files in a new0700 home and refuses stale output reuse', () => {
    const root = privateRoot(), home = join(root, 'one-operation')
    const output = createOutputHome(home)
    output.publish({ fixture: { synthetic: true }, status: { private: 'fixture-only' },
      state: 'PREPARED_INPUTS_NOT_NATIVE_ACCEPTANCE', command: ['node'] })
    output.close()
    expect(lstatSync(home).mode & 0o777).toBe(0o700)
    for (const name of ['native-fixture.json', 'native-status.json', 'preparation-result.json']) {
      expect(lstatSync(join(home, name)).mode & 0o777).toBe(0o600)
    }
    const original = readFileSync(join(home, 'native-status.json'))
    expect(() => createOutputHome(home)).toThrow('fresh_output_home_required')
    expect(readFileSync(join(home, 'native-status.json'))).toEqual(original)
  })

  it('refuses a symlinked output parent', () => {
    const root = privateRoot(), actual = join(root, 'actual'), alias = join(root, 'alias')
    mkdirSync(actual, { mode: 0o700 })
    symlinkSync(actual, alias)
    expect(() => createOutputHome(join(alias, 'output'))).toThrow('canonical_private_directory_required')
  })

  it('passes only the exact month/company and actual session cookies to the normal route', async () => {
    const { input } = fixture()
    const network = vi.fn(async () => new Response('{"data":{}}', { status: 200 }))
    vi.stubGlobal('fetch', network)
    const adapter = realAdapters(input, { evidence: async () => undefined })
    const result = await adapter.prepareMonth({ jar: new Map([['owned-session', 'fixture-cookie']]) }, '2026-07')
    expect(result.status).toBe(200)
    expect(network).toHaveBeenCalledTimes(1)
    const [url, request] = network.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:3104/api/internal/invoice-exports/create')
    expect(request.redirect).toBe('manual')
    expect(request.body).toBe(JSON.stringify({ companyId: input.companyId, billing_month: '2026-07' }))
    expect(request.headers).toMatchObject({ cookie: 'owned-session=fixture-cookie' })
  })

  it('help is source-only and does not contact Auth or provision a backend', async () => {
    const network = vi.fn(() => { throw Error('unexpected network') })
    vi.stubGlobal('fetch', network)
    expect(await main(['--help'])).toContain('no provisioning or native execution')
    expect(network).not.toHaveBeenCalled()
  })
})


describe('T4 actual Docker mapping validation (controlled observations)', () => {
  const container = (id: string, port: string, hostPort: string) => ({ Id: id, State: { Running: true },
    NetworkSettings: { Ports: { [port]: [{ HostIp: '127.0.0.1', HostPort: hostPort }] } } })

  it('rejects a remote Docker context even when the expected local socket exists', () => {
    const { input } = fixture()
    const db = container(backend.databaseContainerId, '5432/tcp', '54322')
    const api = container(backend.apiContainerId, '8000/tcp', '54321')
    expect(() => verifyLocalDockerBindings(input, 'ssh://foreign-daemon', db, api))
      .toThrow('actual_local_docker_context_required')
  })

  it('requires the exact DB/API port mappings of the inspected containers', () => {
    const { input } = fixture()
    const db = container(backend.databaseContainerId, '5432/tcp', '54322')
    const api = container(backend.apiContainerId, '8000/tcp', '54321')
    expect(() => verifyLocalDockerBindings(input, 'unix:///var/run/docker.sock', db, api)).not.toThrow()
    api.NetworkSettings.Ports['8000/tcp'][0].HostPort = '54399'
    expect(() => verifyLocalDockerBindings(input, 'unix:///var/run/docker.sock', db, api))
      .toThrow('fixed_local_database_api_mappings_required')
  })
})

describe('T4 publication evidence and stopped-operation diagnostics', () => {
  it('saves the actual bytes named by each c8c preparationEvidenceSha256', async () => {
    const { input, io } = fixture()
    const result = await prepareAtomicNative(input, io)
    const output = createOutputHome(join(privateRoot(), 'artifacts'))
    output.publish(result)
    output.close()
    for (const [name, graph] of Object.entries(result.fixture.graphs)) {
      const home = privateRoots.at(-1)!
      const bytes = readFileSync(join(home, 'artifacts', `prepare-${name}.json`))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(graph.preparationEvidenceSha256)
    }
  })

  it('records only a canonical failure code in its owned private journal', async () => {
    const { input } = fixture()
    const root = privateRoot(), home = join(root, 'operation')
    input.producer.outputHome = home
    input.appUrl = 'https://not-authorized.invalid'
    const path = join(root, 'input.json')
    writeFileSync(path, JSON.stringify(input), { mode: 0o600 })
    await expect(main([path, home])).rejects.toThrow('fixed_local_app_required')
    const evidence = readFileSync(join(home, 'preparation-evidence.jsonl'), 'utf8')
    expect(JSON.parse(evidence)).toEqual({ phase: 'preparation-failed', code: 'fixed_local_app_required' })
    expect(evidence).not.toContain(input.actors.a.password)
    expect(evidence).not.toContain(input.actors.a.email)
  })
})


describe('T4 producer neutral capsule with private sealed attempt', () => {
  function binding() {
    const { input } = fixture()
    const attempt = { protocol: 'masterplan-reservation-v1', repo: 'heke99/gridex-ops-platform',
      owner: input.producer.agent, slot: input.producer.slot, epoch: 'gridex-five-agent-20261012',
      inputEpoch: input.producer.inputEpoch, resource: input.producer.ref, sourceHead: source.commit,
      sourceTree: source.tree, scope: preparationProducerScope(input),
      budget: { prepareCalls: 3, nativeFixtureRuns: 0, manualReruns: 0, provision: 0, builds: 0,
        migrations: 0, genCaptures: 0, merges: 0, deployments: 0 },
      sourceResources: [{ ref: `refs/tags/agent-claims/masterplan/file-${sha}`, receipt: '6'.repeat(40) }],
    }
    const resourceHash = createHash('sha256').update(input.producer.ref).digest('hex')
    const capsule = { base: '7'.repeat(40), files: [],
      operation: `Acquire bounded ${input.producer.nativeResource}; resources-sha256=${resourceHash}; attempt-sha256=${input.producer.attempt.sha256}; state=PENDING_INPUT_QUALIFICATION` }
    const commit = { sha: input.producer.receipt, message: JSON.stringify(capsule),
      parents: [{ sha: capsule.base }], tree: { sha: '8'.repeat(40) } }
    input.producer.bodySha256 = createHash('sha256').update(commit.message).digest('hex')
    return { input, attempt, capsule, commit, base: { sha: capsule.base, tree: { sha: '8'.repeat(40) } } }
  }

  it('accepts the existing public-minimal/private-attempt pattern without publishing identity or allocation', () => {
    const { input, attempt, commit, base } = binding()
    expect(() => verifyNeutralProducerCapsule(input, attempt, commit, base)).not.toThrow()
    expect(Object.keys(JSON.parse(commit.message)).sort()).toEqual(['base', 'files', 'operation'])
    expect(commit.message).not.toContain(input.backend.databaseContainerId)
    expect(commit.message).not.toContain(input.producer.agent)
  })

  it('rejects public full-identity or allocation fields', () => {
    const { input, attempt, capsule, commit, base } = binding()
    commit.message = JSON.stringify({ ...capsule, agent: input.producer.agent })
    input.producer.bodySha256 = createHash('sha256').update(commit.message).digest('hex')
    expect(() => verifyNeutralProducerCapsule(input, attempt, commit, base))
      .toThrow('neutral_public_capsule_mismatch')
  })

  it('requires the exact private-attempt hash sealed by the public operation', () => {
    const { input, attempt, commit, base } = binding()
    input.producer.attempt.sha256 = '0'.repeat(64)
    expect(() => verifyNeutralProducerCapsule(input, attempt, commit, base))
      .toThrow('neutral_public_capsule_mismatch')
  })

  it('rejects a non-neutral tree or another commit target', () => {
    const { input, attempt, commit, base } = binding()
    commit.tree.sha = '9'.repeat(40)
    expect(() => verifyNeutralProducerCapsule(input, attempt, commit, base))
      .toThrow('neutral_producer_parent_tree_mismatch')
  })

  it('rejects a private budget that would also run native, provision or perform GEN', () => {
    const { input, attempt, commit, base } = binding()
    attempt.budget.nativeFixtureRuns = 1
    expect(() => verifyNeutralProducerCapsule(input, attempt, commit, base))
      .toThrow('bounded_preparation_budget_required')
  })

  it('rejects a substituted private backend scope even with unchanged public receipt data', () => {
    const { input, attempt, commit, base } = binding()
    attempt.scope.backendSha256 = '0'.repeat(64)
    expect(() => verifyNeutralProducerCapsule(input, attempt, commit, base))
      .toThrow('sealed_private_producer_scope_mismatch')
  })
})


// In-process PostgreSQL expression evaluation only; no native backend/Auth proof.
// Execute the SAME exported predicate interpolated by the real CLI source query.
describe('T4 actual FINAL-source SQL predicate null semantics', () => {
  let db: PGlite
  beforeAll(async () => { db = new PGlite(); await db.waitReady }, 15_000)
  afterAll(async () => { await db.close() })
  const valid = { id: 'one', billing_source_basis: { normalizedValueId: 'one', qualified: true,
    qualityEstablished: true, quality: null } }
  async function allFinal(values: unknown[]) {
    const result = await db.query<{ all_final: boolean | null }>(
      `SELECT bool_and(${FINAL_SOURCE_PREDICATE}) AS all_final FROM jsonb_array_elements($1::jsonb) v`,
      [JSON.stringify(values)],
    )
    return result.rows[0].all_final
  }

  it('qualifies an explicit FINAL observation', async () => {
    expect(await allFinal([valid])).toBe(true)
  })
  it('does not ignore a missing basis beside a valid FINAL row', async () => {
    expect(await allFinal([valid, { id: 'two' }])).toBe(false)
  })
  it('does not confuse missing quality with explicit JSONnull', async () => {
    expect(await allFinal([valid, { id: 'two', billing_source_basis: {
      normalizedValueId: 'two', qualified: true, qualityEstablished: true,
    } }])).toBe(false)
  })
  it('rejects estimated quality or an observation-identity mismatch', async () => {
    expect(await allFinal([valid, { ...valid, billing_source_basis: {
      ...valid.billing_source_basis, quality: 'estimated',
    } }])).toBe(false)
    expect(await allFinal([valid, { ...valid, id: 'another-id' }])).toBe(false)
  })
  it('an empty source set cannot qualify FINAL', async () => {
    expect(await allFinal([])).not.toBe(true)
  })
})
