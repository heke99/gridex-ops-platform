#!/usr/bin/env node
/**
 * Source-only until an existing producer supplies genuine retained inputs,
 * separately admitted disposable resources and a fresh bound running app.
 * Usage: node scripts/simulation/track4/prepare-atomic-native.mjs INPUT OUTPUT_HOME
 * INPUT is private0600 JSON; OUTPUT_HOME must be a new child of private0700.
 * Required extras to the orchestrator input: appRoot, buildHome, and backend's
 * full containerIds/networkIds/volumeNames. No backend/app/native process starts.
 * Outputs are private observational evidence and exact c8c inputs, not approval
 * ledgers. The producer retains business graphs for native; it owns final backend
 * disposal. Only this invocation's real Auth sessions are signed out here.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { createServerClient } from '@supabase/ssr'
import { canonicalPreparationJson, NATIVE_SOURCE, PreparationError, preparationFailureCode, preparationProducerScope, prepareAtomicNative, observeMemoryBoundary, CGROUP_NAMESPACE_PROBE_PYTHON } from './lib/atomicNativePreparation.mjs'

export const FINAL_SOURCE_PREDICATE = `COALESCE(v#>>'{billing_source_basis,normalizedValueId}'=v->>'id'
  AND v#>>'{billing_source_basis,qualified}'='true'
  AND v#>>'{billing_source_basis,qualityEstablished}'='true'
  AND v#>'{billing_source_basis,quality}'='null'::jsonb,false)`

const must = (condition, code) => { if (!condition) throw new PreparationError(code) }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`
const psqlArgs = ['postgresql://postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']

export function readPrivateJson(path) {
  try {
    must(isAbsolute(path) && realpathSync(path) === path, 'canonical_private_path_required')
    const stat = lstatSync(path)
    must(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o600
      && stat.size <= 8_000_000, 'private_owned_file_required')
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch { throw new PreparationError('private_input_invalid') }
}
function regularHash(path) {
  must(lstatSync(path).isFile() && realpathSync(path) === path, 'regular_bound_file_required')
  return sha(readFileSync(path))
}
function command(program, args, options = {}) {
  try {
    return execFileSync(program, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 16_000_000,
      stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim()
  } catch { throw new PreparationError('qualified_command_failed') }
}
function jsonCommand(program, args, options) {
  try { return JSON.parse(command(program, args, options)) }
  catch { throw new PreparationError('qualified_command_result_invalid') }
}
function sql(body) {
  const output = command('psql', psqlArgs, { input: `SET statement_timeout='20s'; SET lock_timeout='5s';\n${body}`,
    env: { ...process.env, PGPASSWORD: 'postgres' } })
  try { return JSON.parse(output.split('\n').filter(Boolean).at(-1)) }
  catch { throw new PreparationError('qualified_database_result_invalid') }
}
function serviceSql(body) {
  return sql(`BEGIN; SET LOCAL ROLE service_role;
    SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
    SELECT set_config('request.jwt.claim.role','service_role',true); ${body} COMMIT;`)
}
function canonicalPythonHash() {
  return command('python3', ['-c', `import hashlib,json,os
print(hashlib.sha256(json.dumps({k:v for k,v in os.environ.items() if k not in ('SKIP_BUILD','SHLVL','_')},sort_keys=True,separators=(',',':')).encode()).hexdigest())`])
}
function privateDirectory(path) {
  must(isAbsolute(path) && realpathSync(path) === path, 'canonical_private_directory_required')
  const stat = lstatSync(path)
  must(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700,
    'owned_private_directory_required')
}
export function createOutputHome(path) {
  must(isAbsolute(path) && resolve(path) === path, 'canonical_output_required')
  privateDirectory(dirname(path))
  must(!existsSync(path), 'fresh_output_home_required')
  mkdirSync(path, { mode: 0o700 }) // Exclusive: no stale reuse or overwrite.
  const journal = openSync(join(path, 'preparation-evidence.jsonl'), 'wx', 0o600)
  return {
    evidence: async (event) => writeFileSync(journal, `${JSON.stringify(event)}\n`),
    publish: (result) => {
      for (const [name, artifact] of Object.entries(result.preparationEvidence ?? {})) {
        must(['concurrent', 'contextDrift', 'rollback'].includes(name), 'known_evidence_artifact_required')
        const fd = openSync(join(path, `prepare-${name}.json`), 'wx', 0o600)
        try { writeFileSync(fd, canonicalPreparationJson(artifact)) } finally { closeSync(fd) }
      }
      for (const [name, value] of [['native-fixture.json', result.fixture], ['native-status.json', result.status],
        ['preparation-result.json', { state: result.state, nativeExecuted: false, command: result.command }]]) {
        const fd = openSync(join(path, name), 'wx', 0o600)
        try { writeFileSync(fd, `${JSON.stringify(value)}\n`) } finally { closeSync(fd) }
      }
    },
    close: () => closeSync(journal),
  }
}

/** Validate the existing minimal public capsule/private sealed-attempt pattern.
 * No owner, allocation, backend or budget metadata may enter the public message.
 * The private attempt is bounded input data, never an ACTIVE authorization flag.
 */
export function verifyNeutralProducerCapsule(input, attempt, commit, base) {
  let capsule
  try { capsule = JSON.parse(commit.message) } catch { throw new PreparationError('neutral_producer_capsule_invalid') }
  const resourceDigest = sha(Buffer.from(input.producer.ref))
  const operation = `Acquire bounded ${input.producer.nativeResource}; resources-sha256=${resourceDigest}; attempt-sha256=${input.producer.attempt.sha256}; state=PENDING_INPUT_QUALIFICATION`
  must(Object.keys(capsule).sort().join(',') === 'base,files,operation'
    && Array.isArray(capsule.files) && capsule.files.length === 0
    && capsule.operation === operation && sha(Buffer.from(commit.message)) === input.producer.bodySha256,
  'neutral_public_capsule_mismatch')
  must(commit.sha === input.producer.receipt && base.sha === capsule.base && commit.parents.length === 1 && commit.parents[0].sha === capsule.base
    && commit.tree.sha === base.tree.sha, 'neutral_producer_parent_tree_mismatch')
  const scope = preparationProducerScope(input)
  must(attempt.protocol === 'masterplan-reservation-v1' && attempt.repo === 'heke99/gridex-ops-platform'
    && attempt.owner === input.producer.agent && attempt.slot === input.producer.slot
    && attempt.epoch === 'gridex-five-agent-20261012' && attempt.inputEpoch === input.producer.inputEpoch
    && attempt.resource === input.producer.ref && attempt.sourceHead === input.source.commit
    && attempt.sourceTree === input.source.tree
    && canonicalPreparationJson(attempt.scope) === canonicalPreparationJson(scope),
  'sealed_private_producer_scope_mismatch')
  must(attempt.budget?.prepareCalls === scope.prepareBudget
    && ['nativeFixtureRuns', 'manualReruns', 'provision', 'builds', 'migrations', 'genCaptures', 'merges', 'deployments']
      .every((key) => attempt.budget[key] === 0), 'bounded_preparation_budget_required')
  must(Array.isArray(attempt.sourceResources) && attempt.sourceResources.length > 0
    && attempt.sourceResources.every((binding) =>
      /^refs\/tags\/agent-claims\/masterplan\/(file-[a-f0-9]{64}|slot-session-[a-f0-9-]{36})$/.test(binding.ref)
      && /^[a-f0-9]{40}$/.test(binding.receipt)), 'exact_source_resource_bindings_required')
}

export function verifyLocalDockerBindings(input, contextHost, database, api) {
  must(contextHost === `unix://${input.backend.socketPath}`, 'actual_local_docker_context_required')
  const reachesLoopback = (bindings, port) => Array.isArray(bindings) && bindings.length > 0
    && bindings.every((binding) => binding.HostPort === port
      && ['127.0.0.1', '0.0.0.0'].includes(binding.HostIp))
  must(database.Id === input.backend.databaseContainerId && api.Id === input.backend.apiContainerId
    && database.State?.Running === true && api.State?.Running === true,
  'actual_backend_containers_required')
  must(reachesLoopback(database.NetworkSettings?.Ports?.['5432/tcp'], '54322')
    && reachesLoopback(api.NetworkSettings?.Ports?.['8000/tcp'], '54321'),
  'fixed_local_database_api_mappings_required')
}

function observeHarness(input) {
  const root = input.harness.root
  must(realpathSync(root) === root && fileURLToPath(import.meta.url)
    === join(root, 'scripts/simulation/track4/prepare-atomic-native.mjs'), 'running_harness_root_mismatch')
  const commit = command('git', ['-C', root, 'rev-parse', 'HEAD'])
  const tree = command('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'])
  must(!command('git', ['-C', root, 'status', '--porcelain', '--untracked-files=normal']),
    'clean_committed_harness_required')
  const files = {}
  for (const [path, expected] of Object.entries(input.harness.files)) {
    must(['scripts/simulation/track4/lib/atomicNativePreparation.mjs',
      'scripts/simulation/track4/prepare-atomic-native.mjs',
      '__tests__/simulation-track4-atomic-native-preparation.test.ts'].includes(path),
    'known_harness_source_file_required')
    files[path] = regularHash(join(root, path))
    must(files[path] === expected, 'preparation_harness_file_changed')
  }
  return { root, commit, tree, files }
}

function observeBuildAndProcess(input) {
  const app = input.appRoot, home = input.buildHome
  must(isAbsolute(app) && realpathSync(app) === app && isAbsolute(home) && realpathSync(home) === home,
    'canonical_app_build_home_required')
  privateDirectory(home)
  const environmentFile = lstatSync(join(home, 'env'))
  must(environmentFile.isFile() && environmentFile.uid === process.getuid()
    && (environmentFile.mode & 0o777) === 0o600, 'private_build_environment_required')
  const receiptPath = join(home, 'build-evidence.json')
  const receipt = readPrivateJson(receiptPath)
  must(regularHash(receiptPath) === input.source.buildEvidenceSha256
    && receipt.kind === 't4-build-evidence-v1-not-runtime-admission', 'actual_build_evidence_required')
  const head = command('git', ['-C', app, 'rev-parse', 'HEAD'])
  const tree = command('git', ['-C', app, 'rev-parse', 'HEAD^{tree}'])
  must(!command('git', ['-C', app, 'status', '--porcelain', '--untracked-files=normal']), 'clean_committed_app_required')
  command('git', ['-C', app, 'merge-base', '--is-ancestor', NATIVE_SOURCE.productCommit, head])
  for (const [path, expected] of Object.entries(input.source.genArtifacts)) {
    must(['supabase/schema.sql', 'supabase/database.types.ts', 'supabase/schema.fingerprint.json',
      'scripts/migration-history-manifest.json', 'scripts/supabase-types-manifest.json'].includes(path)
      && regularHash(join(app, path)) === expected, 'gen_source_artifacts_changed')
  }
  for (const [path, expected] of [[NATIVE_SOURCE.migrationPath, NATIVE_SOURCE.migrationSha256],
    [NATIVE_SOURCE.testPath, NATIVE_SOURCE.testSha256], [NATIVE_SOURCE.configPath, NATIVE_SOURCE.configSha256]]) {
    must(regularHash(join(app, path)) === expected, 'frozen_product_proof_source_mismatch')
  }
  must(receipt.inputs.app === app && receipt.inputs.head === head && receipt.inputs.tree === tree,
    'build_source_changed')
  must(receipt.inputs.environmentSha256 === regularHash(join(home, 'env'))
    && receipt.inputs.processEnvironmentSha256 === canonicalPythonHash(), 'build_environment_changed')
  const dotenv = Object.fromEntries(readdirSync(app).filter((name) => name.startsWith('.env')).sort()
    .map((name) => [name, regularHash(join(app, name))]))
  must(JSON.stringify(dotenv) === JSON.stringify(receipt.inputs.dotenvSha256), 'build_dotenv_changed')
  const actualOutputs = {}
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (directory === join(app, '.next') && name === 'cache') continue
      const path = join(directory, name), stat = lstatSync(path)
      must(!stat.isSymbolicLink(), 'symlinked_build_output_refused')
      if (stat.isDirectory()) walk(path)
      else actualOutputs[relative(join(app, '.next'), path)] = regularHash(path)
    }
  }
  walk(join(app, '.next'))
  must(JSON.stringify(Object.entries(actualOutputs).sort()) === JSON.stringify(Object.entries(receipt.outputs).sort()),
    'build_outputs_changed')
  const pid = input.backend.appPid
  const processRoot = `/proc/${pid}`
  must(realpathSync(join(processRoot, 'cwd')) === app, 'app_process_source_root_changed')
  const processStat = readFileSync(join(processRoot, 'stat'), 'utf8').split(') ').at(-1).split(' ')
  const startTicks = processStat[19]
  must(startTicks === input.backend.appStartTicks, 'app_process_identity_changed')
  const btime = Number(readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)$/m)?.[1])
  const ticksPerSecond = Number(command('getconf', ['CLK_TCK']))
  const startedMs = btime * 1000 + Number(startTicks) / ticksPerSecond * 1000
  const buildMs = lstatSync(join(app, '.next', 'BUILD_ID')).mtimeMs
  const processEnvironment = readFileSync(join(processRoot, 'environ'))
  // Compare the same whole environment projection used for the successful build.
  const processEnvHash = command('python3', ['-c', `import hashlib,json,sys
raw=sys.stdin.buffer.read().split(b'\\0'); pairs=[p.split(b'=',1) for p in raw if b'=' in p]
env={k.decode():v.decode() for k,v in pairs if k.decode() not in ('SKIP_BUILD','SHLVL','_')}
print(hashlib.sha256(json.dumps(env,sort_keys=True,separators=(',',':')).encode()).hexdigest())`], { input: processEnvironment })
  const inodeSet = new Set(readdirSync(join(processRoot, 'fd')).flatMap((fd) => {
    try { return [readlinkSync(join(processRoot, 'fd', fd))] } catch { return [] }
  }))
  const port = input.backend.appPort.toString(16).toUpperCase().padStart(4, '0')
  const listens = readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1).some((line) => {
    const fields = line.trim().split(/\s+/)
    return fields[3] === '0A' && fields[1]?.endsWith(`:${port}`) && inodeSet.has(`socket:[${fields[9]}]`)
  })
  must(listens, 'owned_app_listener_required')
  return { source: { ...input.source, commit: head, tree, buildEvidenceSha256: regularHash(receiptPath) },
    appStartedAfterBuild: Number.isFinite(startedMs) && startedMs > buildMs,
    appBuildAndEnvironmentBound: processEnvHash === receipt.inputs.processEnvironmentSha256 }
}

export function realAdapters(input, output) {
  let status
  const cwd = input.appRoot
  return {
    now: () => Date.now(), evidence: output.evidence,
    verifyProducer: async () => {
      const attempt = readPrivateJson(input.producer.attempt.path)
      must(regularHash(input.producer.attempt.path) === input.producer.attempt.sha256,
        'private_producer_attempt_changed')
      const ref = jsonCommand('gh', ['api', `repos/heke99/gridex-ops-platform/git/ref/${input.producer.ref.slice(5)}`])
      must(ref.object.sha === input.producer.receipt, 'live_producer_ref_changed')
      const commit = jsonCommand('gh', ['api', `repos/heke99/gridex-ops-platform/git/commits/${ref.object.sha}`])
      let capsule
      try { capsule = JSON.parse(commit.message) } catch { throw new PreparationError('neutral_producer_capsule_invalid') }
      must(/^[a-f0-9]{40}$/.test(capsule.base), 'neutral_producer_base_required')
      const base = jsonCommand('gh', ['api', `repos/heke99/gridex-ops-platform/git/commits/${capsule.base}`])
      verifyNeutralProducerCapsule(input, attempt, commit, base)
      for (const binding of attempt.sourceResources) {
        const current = jsonCommand('gh', ['api', `repos/heke99/gridex-ops-platform/git/ref/${binding.ref.slice(5)}`])
        must(current.object.sha === binding.receipt, 'source_resource_binding_changed')
      }
      return { ...input.producer, source: attempt.sourceHead, agent: attempt.owner, slot: attempt.slot,
        epoch: attempt.epoch, protocol: attempt.protocol, neutralVerified: true, attemptVerified: true,
        scope: attempt.scope }
    },
    observeHost: async () => {
      const memoryProof = observeProcessMemory()
      if (memoryProof.qualification !== 'KNOWN' || memoryProof.effectiveRamBytes < 8 * 2 ** 30) {
        return { memoryProof, effectiveRamBytes: memoryProof.effectiveRamBytes }
      }
      must(process.versions.node.startsWith('22.'), 'node22_runtime_required')
      must(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === `unix://${input.backend.socketPath}`,
        'local_docker_endpoint_required')
      const contextName = command('docker', ['context', 'show'])
      const context = jsonCommand('docker', ['context', 'inspect', contextName])[0]
      const contextHost = context?.Endpoints?.docker?.Host
      must(contextHost === `unix://${input.backend.socketPath}`, 'actual_local_docker_context_required')
      const info = jsonCommand('docker', ['info', '--format', '{{json .}}'])
      const socket = lstatSync(input.backend.socketPath)
      must(socket.isSocket() && realpathSync(input.backend.socketPath) === input.backend.socketPath,
        'actual_daemon_socket_required')
      const ids = command('docker', ['ps', '-aq', '--no-trunc']).split('\n').filter(Boolean).sort()
      must(JSON.stringify(ids) === JSON.stringify([...input.backend.containerIds].sort()), 'exclusive_backend_containers_changed')
      const db = jsonCommand('docker', ['inspect', input.backend.databaseContainerId])[0]
      const api = jsonCommand('docker', ['inspect', input.backend.apiContainerId])[0]
      const networkIds = command('docker', ['network', 'ls', '--no-trunc', '--format', '{{.ID}}']).split('\n').filter(Boolean).sort()
      const volumeNames = command('docker', ['volume', 'ls', '--format', '{{.Name}}']).split('\n').filter(Boolean).sort()
      must(JSON.stringify(networkIds) === JSON.stringify([...input.backend.networkIds].sort())
        && JSON.stringify(volumeNames) === JSON.stringify([...input.backend.volumeNames].sort()),
      'exclusive_backend_networks_volumes_changed')
      verifyLocalDockerBindings(input, contextHost, db, api)
      const fs = statfsSync(info.DockerRootDir)
      const freeDockerBytes = Number(fs.bavail) * Number(fs.bsize)
      const effectiveRamBytes = memoryProof.effectiveRamBytes
      // Reject undercapacity before inspecting the running app or contacting DB/Auth.
      const minimum = info.Driver === 'vfs' ? 40 : ['overlay2', 'overlayfs'].includes(info.Driver) ? 15 : Infinity
      must(effectiveRamBytes >= 8 * 2 ** 30 && freeDockerBytes >= minimum * 2 ** 30, 'owned_capacity_hold')
      const build = observeBuildAndProcess(input)
      const harness = observeHarness(input)
      return { ...build, harness, memoryProof, effectiveRamBytes, freeDockerBytes,
        cpu: { availableParallelism: availableParallelism(),
          quota: existsSync('/sys/fs/cgroup/cpu.max') ? readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null },
        toolVersions: { node: process.version, docker: info.ServerVersion }, backend: { ...input.backend,
        daemonId: info.ID, dockerRootDir: info.DockerRootDir, driver: info.Driver,
        socketDev: String(socket.dev), socketIno: String(socket.ino) } }
    },
    observeDatabase: async () => {
      must(/^psql \(PostgreSQL\) 17\./.test(command('psql', ['--version'])), 'postgres17_client_required')
      const supabase = input.tools.supabaseCli.path
      must(isAbsolute(supabase) && realpathSync(supabase) === supabase
        && regularHash(supabase) === input.tools.supabaseCli.sha256, 'bound_supabase_cli_changed')
      must(command(supabase, ['--version'], { cwd }) === '2.101.0', 'supabase_2_101_0_required')
      status = jsonCommand(supabase, ['status', '--output', 'json'], { cwd })
      must(status.API_URL === 'http://127.0.0.1:54321', 'actual_local_status_required')
      const migration = readFileSync(join(cwd, NATIVE_SOURCE.migrationPath), 'utf8')
      const body = migration.match(/\bAS \$\$([\s\S]*?)\$\$;/)?.[1]
      must(body, 'qualified_migration_source_required')
      const identity = sql(`SELECT jsonb_build_object('databaseSystemIdentifier',system_identifier::text,
        'majorVersion',current_setting('server_version_num')::int/10000,
        'approvalSourceBound',(SELECT prosrc=${literal(body)} FROM pg_proc
          WHERE oid='public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'::regprocedure))
        FROM pg_control_system();`)
      return { ...identity, status }
    },
    verifyCohort: async () => {
      const cohort = readPrivateJson(input.cohort.path)
      must(regularHash(input.cohort.path) === input.cohort.sha256, 'retained_cohort_artifact_changed')
      must(/^[a-f0-9]{40}$/.test(cohort.sourceCommit), 'retained_cohort_source_required')
      command('git', ['-C', cwd, 'merge-base', '--is-ancestor', cohort.sourceCommit, input.source.commit])
      return cohort
    },
    signIn: async (key) => {
      const jar = new Map()
      const localFetch = (url, options) => {
        must(new URL(typeof url === 'string' ? url : url.url).origin === 'http://127.0.0.1:54321',
          'auth_loopback_required')
        return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
      }
      const client = createServerClient(status.API_URL, status.ANON_KEY, { global: { fetch: localFetch },
        cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookies) => cookies.forEach(({ name, value }) => jar.set(name, value)) } })
      const actor = input.actors[key]
      const response = await client.auth.signInWithPassword({ email: actor.email, password: actor.password })
      must(!response.error && response.data.session, 'real_fixture_signin_failed')
      try {
        const current = await client.auth.getUser()
        must(!current.error && current.data.user, 'real_auth_user_required')
        return { key, userId: current.data.user.id, client, jar }
      } catch {
        const cleanup = await client.auth.signOut({ scope: 'local' })
        must(!cleanup.error, 'own_auth_session_cleanup_failed')
        throw new PreparationError('real_auth_user_required')
      }
    },
    permissions: async (session, companyId) => {
      const { data, error } = await session.client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: companyId })
      must(!error && data && data.user_id === session.userId, 'actual_tenant_context_unavailable')
      const active = data.active_permission_keys, denied = data.denied_permissions
      must(Array.isArray(active) && Array.isArray(denied), 'actual_permission_catalog_required')
      const granted = data.is_platform_admin === true ? active : data.permissions
      return { userId: data.user_id, authorized: data.authorized === true && data.selected_company_id === companyId
        && Array.isArray(granted) && granted.includes('billing_underlay.export')
        && active.includes('billing_underlay.export') && !denied.includes('billing_underlay.export') }
    },
    observeTarget: async (name) => {
      const target = input.targets[name], company = literal(input.companyId), underlay = literal(target.underlayId)
      const state = sql(`BEGIN; SELECT gridex_billing_source.require_underlay_v1(${company}::uuid,${underlay}::uuid);
        SELECT jsonb_build_object('companyId',u.company_id,'underlayId',u.id,
          'billingMonth',u.underlay_year||'-'||lpad(u.underlay_month::text,2,'0'),
          'ready',u.status='validated' AND u.readiness_status='ready','sourceQualified',true,
          'graphHash',encode(sha256(convert_to(to_jsonb(u)::text,'UTF8')),'hex'),
          'eligibleUnderlayIds',(SELECT coalesce(jsonb_agg(x.id ORDER BY x.id),'[]') FROM public.billing_underlays x
            WHERE x.company_id=u.company_id AND x.underlay_year=u.underlay_year AND x.underlay_month=u.underlay_month
              AND x.status='validated' AND x.readiness_status='ready' AND NOT EXISTS(
                SELECT FROM public.invoice_export_items i WHERE i.company_id=x.company_id
                  AND i.billing_underlay_id=x.id AND i.status<>'cancelled')),
          'graphs',(SELECT coalesce(jsonb_agg(jsonb_build_object('exportItemId',i.id,'underlayId',i.billing_underlay_id,
            'pending',i.status='pending' AND i.metadata#>>'{approval,status}'='pending_review',
            'mirrorDraft',inv.status='draft' AND inv.metadata#>>'{approval,status}'='pending_review',
            'lockedPricing',p.status='locked' AND p.locked_at IS NOT NULL,
            'graphHash',encode(sha256(convert_to(jsonb_build_object('item',to_jsonb(i),'invoice',to_jsonb(inv),
              'pricing',to_jsonb(p))::text,'UTF8')),'hex'),
            'initialApprovalEvents',(SELECT count(*) FROM public.domain_events e WHERE e.aggregate_id=i.id::text
              AND e.event_type='invoice.approved'),
            'initialOutboxRows',(SELECT count(*) FROM public.event_outbox o JOIN public.domain_events e
              ON e.id=o.domain_event_id WHERE e.aggregate_id=i.id::text AND e.event_type='invoice.approved'))),'[]')
            FROM public.invoice_export_items i JOIN public.customer_invoices inv
              ON inv.company_id=i.company_id AND inv.invoice_export_item_id=i.id
            JOIN public.pricing_runs p ON p.company_id=i.company_id AND p.id=i.pricing_run_id
            WHERE i.company_id=u.company_id AND i.billing_underlay_id=u.id AND i.status<>'cancelled'))
          FROM public.billing_underlays u WHERE u.company_id=${company}::uuid AND u.id=${underlay}::uuid; COMMIT;`)
      const quality = serviceSql(`WITH ids AS (
        SELECT DISTINCT source_normalized_metering_value_id AS id FROM public.billing_underlay_items
        WHERE company_id=${company}::uuid AND billing_underlay_id=${underlay}::uuid
          AND source_normalized_metering_value_id IS NOT NULL), numbered AS (
        SELECT id,(row_number() OVER(ORDER BY id)-1)/250 AS batch FROM ids), batches AS (
        SELECT batch,array_agg(id ORDER BY id) AS ids FROM numbered GROUP BY batch), bodies AS MATERIALIZED (
        SELECT public.gridex_read_billing_source_values_v1(${company}::uuid,ids) body FROM batches), actual AS (
        SELECT v FROM bodies CROSS JOIN LATERAL jsonb_array_elements(body) v)
        SELECT jsonb_build_object('finalSourceCount',(SELECT count(*) FROM actual),
          'normalizedIdsSha256',(SELECT encode(sha256(convert_to(string_agg(id::text,',' ORDER BY id),'UTF8')),'hex') FROM ids),
          'sourceMessages',(SELECT jsonb_agg(source ORDER BY source->>'id') FROM (
            SELECT DISTINCT jsonb_build_object('id',v#>>'{billing_source_basis,sourceMessageId}',
              'payloadSha256',v#>>'{billing_source_basis,sourcePayloadHash}') AS source FROM actual) sources),
          'allSourcesFinal',(SELECT count(*)=(SELECT count(*) FROM ids)
            AND count(DISTINCT v->>'id')=(SELECT count(*) FROM ids)
            AND NOT EXISTS(SELECT FROM actual WHERE NOT EXISTS(SELECT FROM ids WHERE id::text=actual.v->>'id'))
            AND bool_and(${FINAL_SOURCE_PREDICATE}) FROM actual)
          AND NOT EXISTS(SELECT FROM public.billing_underlay_items WHERE company_id=${company}::uuid
            AND billing_underlay_id=${underlay}::uuid AND source_normalized_metering_value_id IS NULL));`)
      const binding = sql(`SELECT jsonb_build_object('sourceBasisSha256',source_basis_hash)
        FROM gridex_billing_source.underlay_bindings WHERE company_id=${company}::uuid AND underlay_id=${underlay}::uuid;`)
      return { ...state, ...quality, provenance: { sourceMessages: quality.sourceMessages,
        normalizedIdsSha256: quality.normalizedIdsSha256, sourceBasisSha256: binding.sourceBasisSha256 } }
    },
    prepareMonth: async (session, month) => {
      const response = await fetch(`${input.appUrl}${NATIVE_SOURCE.preparePath}`, { method: 'POST', redirect: 'manual',
        signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json',
          cookie: [...session.jar].map(([name, value]) => `${name}=${value}`).join('; ') },
        body: JSON.stringify({ companyId: input.companyId, billing_month: month }) })
      const bytes = Buffer.from(await response.arrayBuffer())
      must(bytes.length <= 2_000_000, 'prepare_response_too_large')
      let body
      try { body = JSON.parse(bytes.toString('utf8')) } catch { throw new PreparationError('prepare_response_invalid') }
      return { status: response.status, body, bodySha256: sha(bytes) }
    },
    signOut: async (session) => {
      const { error } = await session.client.auth.signOut({ scope: 'local' })
      must(!error, 'own_auth_session_cleanup_failed')
    },
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') {
    return 'Usage: prepare-atomic-native.mjs PRIVATE_INPUT NEW_PRIVATE_OUTPUT_HOME; no provisioning or native execution'
  }
  must(argv.length === 2, 'private_input_and_fresh_output_required')
  const input = readPrivateJson(argv[0])
  must(argv[1] === input.producer?.outputHome, 'single_bound_output_home_required')
  const output = createOutputHome(argv[1])
  try {
    const result = await prepareAtomicNative(input, realAdapters(input, output))
    output.publish(result)
    return result.state
  } catch (error) {
    await output.evidence({ phase: 'preparation-failed', code: preparationFailureCode(error) })
    throw error
  } finally { output.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((message) => process.stdout.write(`${message}\n`)).catch((error) => {
    process.stderr.write(`T4 preparation stopped: ${preparationFailureCode(error)}; preserve private evidence and reconcile before retry.\n`)
    process.exitCode = 1
  })
}

export function observeProcessMemory() {
  return observeMemoryBoundary({ read: (path) => readFileSync(path, 'utf8'),
    mount: (path) => ({ fsType: Number(statfsSync(path).type), directory: lstatSync(path).isDirectory(), symlink: lstatSync(path).isSymbolicLink() }),
    namespace: () => jsonCommand('python3', ['-c', CGROUP_NAMESPACE_PROBE_PYTHON], { stdio: ['ignore', 'pipe', 'pipe'] }) })
}
