import {defineConfig} from 'vitest/config'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import native from './ediel-sc014-technical-intake-native.config'

// The imported existing config first validates the producer's real owned-local
// Supabase status. Nothing starts a stack or obtains a new backend/producer.
// Node reads NODE_EXTRA_CA_CERTS once at process startup: create throwaway public
// loopback trust here, BEFORE Vitest starts the explicitly selected worker fork.
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('native_smtp_certificate_verification_required')
const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'gridex-ops04-loopback-pki-'))
const cleanup = () => rmSync(directory, {recursive: true, force: true})
process.once('exit', cleanup)
const openssl = (args: string[]) => execFileSync('openssl', args,
  {cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000})
try {
  writeFileSync(join(directory, 'extensions.cnf'), [
    '[ca]', 'basicConstraints=critical,CA:true', 'keyUsage=critical,keyCertSign,cRLSign',
    '[server]', 'basicConstraints=critical,CA:false', 'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '',
  ].join('\n'), {mode: 0o600})
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem',
    '-days', '2', '-subj', '/CN=SYNTHETIC OPS04 LOOPBACK TEST CA', '-config', 'extensions.cnf', '-extensions', 'ca'])
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost'])
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-set_serial', '51704',
    '-days', '2', '-out', 'server.pem', '-extfile', 'extensions.cnf', '-extensions', 'server'])
  // Preserve any preexisting public extra CA material; never replace the
  // transporter's rejectUnauthorized/TLS version settings or trust callbacks.
  const existing = process.env.NODE_EXTRA_CA_CERTS
  const trust = [existing ? readFileSync(existing) : Buffer.alloc(0), readFileSync(join(directory, 'ca.pem'))]
  writeFileSync(join(directory, 'worker-ca.pem'), Buffer.concat(trust.map(value => Buffer.concat([value, Buffer.from('\n')]))), {mode: 0o600})
} catch (error) {cleanup(); throw error}
process.env.NODE_EXTRA_CA_CERTS = join(directory, 'worker-ca.pem')
process.env.GRIDEX_OPS04_LOOPBACK_PKI = directory
process.env.GRIDEX_OPS04_LOOPBACK_PASSWORD = randomUUID() + randomUUID()

export default defineConfig({
  ...native,
  plugins: [...(native.plugins ?? []), {name: 'owned-ops04-loopback-pki-cleanup', closeBundle: cleanup}],
  test: {
    ...native.test,
    include: ['scripts/ediel-ops04-controlled-send-native.test.ts'],
    testTimeout: 240000,
    hookTimeout: 240000,
    fileParallelism: false,
    pool: 'forks',
    maxWorkers: 1,
    env: {...native.test?.env, NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS,
      GRIDEX_OPS04_LOOPBACK_PKI: directory,
      GRIDEX_OPS04_LOOPBACK_PASSWORD: process.env.GRIDEX_OPS04_LOOPBACK_PASSWORD},
  },
})
