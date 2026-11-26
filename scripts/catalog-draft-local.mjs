import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  closeSync, copyFileSync, mkdirSync, mkdtempSync, openSync,
  readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FEATURE = 'KONS-CATALOG-DRIVER-MISSING-DRAFT-VIEW'
const checkout = fileURLToPath(new URL('..', import.meta.url))
const fixtures = fileURLToPath(new URL('./fixtures/catalog-draft-local/', import.meta.url))
const route = [
  'app/admin/contracts/page.tsx',
  'app/admin/contracts/actions.ts',
  'components/admin/contracts/ContractOfferAdminForm.tsx',
]
const archivePaths = [
  'app/admin/contracts', 'lib', 'components', 'types', 'config', 'docs',
  'supabase/database.types.ts', 'scripts/lib/unit-loopback-network-boundary.cjs', 'package.json',
]
const commitRequest = process.env.GRIDEX_CATALOG_REVISION || 'HEAD'
const localDependencies = realpathSync(process.env.GRIDEX_CATALOG_NODE_MODULES || join(checkout, 'node_modules'))
const localRoot = realpathSync(process.env.GRIDEX_CATALOG_WORKDIR || tmpdir())
const prepareOnly = process.argv[2] === '--prepare-only'

function git(args) {
  return execFileSync('git', ['-C', checkout, ...args], {
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 128 * 1024 * 1024,
  })
}

function bindWorkspace() {
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${commitRequest}^{commit}`]).toString().trim()
  const tree = git(['rev-parse', `${commit}^{tree}`]).toString().trim()
  assert.match(commit, /^[a-f0-9]{40}$/)
  assert.match(tree, /^[a-f0-9]{40}$/)
  const root = mkdtempSync(join(localRoot, 'gridex-catalog-draft-'))
  const source = join(root, 'source')
  mkdirSync(source)
  mkdirSync(join(root, 'tmp'))
  execFileSync('tar', ['-x', '-C', source], { input: git(['archive', commit, '--', ...archivePaths]) })
  const files = Object.fromEntries(route.map(path => {
    const expected = git(['rev-parse', `${commit}:${path}`]).toString().trim()
    const actual = git(['hash-object', '--', join(source, path)]).toString().trim()
    assert.equal(actual, expected)
    return [path, expected]
  }))
  for (const [fixture, target] of [
    ['layout.tsx', 'app/layout.tsx'],
    ['server.ts', 'lib/supabase/server.ts'],
    ['service.ts', 'lib/supabase/service.ts'],
    ['canonical.ts', 'lib/contracts/canonical.ts'],
  ]) {
    copyFileSync(join(fixtures, fixture), join(source, target))
  }
  for (const file of ['browser.mjs', 'driver.ts']) copyFileSync(join(fixtures, file), join(root, file))
  symlinkSync(localDependencies, join(source, 'node_modules'), 'dir')
  writeFileSync(join(source, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', baseUrl: '.', paths: { '@/*': ['./*'] }, jsx: 'react-jsx' },
  }))
  return { root, source, commit, tree, files }
}

async function loopbackPort() {
  const supplied = process.env.GRIDEX_CATALOG_PORT
  if (supplied) assert.match(supplied, /^\d{1,5}$/)
  const port = Number(supplied ?? 0)
  assert(Number.isInteger(port) && (port === 0 || port >= 1024 && port <= 65535))
  const server = createServer()
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  await new Promise((done, fail) => server.close(error => error ? fail(error) : done()))
  return address.port
}

async function waitForNext(child, log) {
  let spawnError
  child.once('error', error => { spawnError = error })
  const end = Date.now() + 25000
  while (Date.now() < end) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode) throw Error('catalog_draft_local_next_exited')
    if (readFileSync(log, 'utf8').includes('Ready in')) return
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw Error('catalog_draft_local_next_not_ready')
}

function startOwned(args, cwd, env, log) {
  const output = openSync(log, 'wx')
  try {
    return spawn(process.execPath, args, {
      cwd, env, detached: true, stdio: ['ignore', output, output],
    })
  } finally {
    closeSync(output)
  }
}

function stopOwned(child, signal = 'SIGTERM') {
  if (!child?.pid) return
  try { process.kill(-child.pid, signal) } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

async function stopAndWait(child) {
  stopOwned(child)
  if (!child?.pid || child.exitCode !== null || child.signalCode) return
  try {
    await once(child, 'exit', { signal: AbortSignal.timeout(3000) })
  } catch (error) {
    if (error.name !== 'AbortError') throw error
    stopOwned(child, 'SIGKILL')
    await once(child, 'exit', { signal: AbortSignal.timeout(3000) })
  }
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function main() {
  assert(/^v22\./.test(process.version), 'Use Node 22 for the local catalogue proof')
  assert(process.argv.length === (prepareOnly ? 3 : 2), 'Optional argument: --prepare-only')
  assert.notEqual(process.platform, 'win32', 'This fixture needs a local POSIX process group')
  const workspace = bindWorkspace()
  const { root, source, commit, tree, files } = workspace
  const fixtureFiles = ['layout.tsx', 'server.ts', 'service.ts', 'canonical.ts', 'browser.mjs', 'driver.ts']
  const runnerSha256 = {
    'catalog-draft-local.mjs': digest(fileURLToPath(import.meta.url)),
    ...Object.fromEntries(fixtureFiles.map(path => [path, digest(join(fixtures, path))])),
  }
  const manifest = {
    schema: 'gridex-catalog-draft-local-v1', feature: FEATURE, commit, tree,
    productBlobs: files, runnerSha256, mode: 'local-synthetic', businessOnly: true,
  }
  const manifestPath = join(root, 'evidence.json')
  const record = (status, facts = {}) => writeFileSync(manifestPath,
    JSON.stringify({ ...manifest, status, ...facts }, null, 2) + '\n')
  record('prepared')
  console.log(`Catalogue draft evidence: ${root}`)
  if (prepareOnly) return

  const port = await loopbackPort()
  const origin = `http://127.0.0.1:${port}`
  const guard = join(source, 'scripts/lib/unit-loopback-network-boundary.cjs')
  const env = {
    PATH: process.env.PATH || dirname(process.execPath),
    LANG: 'C.UTF-8', TZ: 'UTC', TMPDIR: join(root, 'tmp'),
    NODE_DISABLE_COMPILE_CACHE: '1', NEXT_TELEMETRY_DISABLED: '1',
    GRIDEX_CATALOG_ORIGIN: origin,
    GRIDEX_CATALOG_DRAFT_RECEIPT: join(root, 'write-receipt.json'),
  }
  if (process.env.GRIDEX_CATALOG_CHROMIUM) {
    env.GRIDEX_CATALOG_CHROMIUM = realpathSync(process.env.GRIDEX_CATALOG_CHROMIUM)
  }
  // Forward Playwright's local browser cache selector without inheriting provider or proxy credentials.
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH

  const nextLog = join(root, 'next.log')
  const next = startOwned([
    join(source, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', String(port),
  ], source, { ...env, NODE_OPTIONS: `--require=${JSON.stringify(guard)} --max-old-space-size=950` }, nextLog)
  let browser
  let browserTmp
  const terminate = () => { stopOwned(browser); stopOwned(next) }
  process.once('SIGINT', terminate)
  process.once('SIGTERM', terminate)
  try {
    await waitForNext(next, nextLog)
    // Chromium needs a short Unix socket path even when the evidence directory is nested.
    browserTmp = mkdtempSync(join(tmpdir(), 'gcd-chrome-'))
    const browserLog = join(root, 'browser.log')
    browser = startOwned([
      '--experimental-strip-types', '--require', guard, join(root, 'browser.mjs'),
    ], root, { ...env, TMPDIR: browserTmp }, browserLog)
    const [code] = await once(browser, 'exit', { signal: AbortSignal.timeout(125000) })
    assert.equal(code, 0, 'Chromium proof failed, see browser.log')
    const observed = readFileSync(browserLog, 'utf8').split('\n')
    for (const marker of [
      'CATALOG478_ACTIVE_VIEW_NO_POST',
      'CATALOG478_NORMAL_ROUTE_BEFORE_HYDRATION_DISABLED_NO_POST',
      'CATALOG478_NORMAL_NEXT_POST_ONCE_AND_SAME_DRAFT_READBACK',
    ]) assert(observed.includes(marker), `Missing receipt: ${marker}`)
  } catch (error) {
    record('failed')
    throw error
  } finally {
    await Promise.all([stopAndWait(browser), stopAndWait(next)])
    if (browserTmp) rmSync(browserTmp, { recursive: true, force: true })
    process.off('SIGINT', terminate)
    process.off('SIGTERM', terminate)
  }
  record('passed', {
    results: { activePosts: 0, beforeHydrationPosts: 0, savedDraftPosts: 1, sameDraftReadback: true },
    evidenceSha256: Object.fromEntries(['browser.log', 'next.log', 'write-receipt.json']
      .map(path => [path, digest(join(root, path))])),
  })
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
