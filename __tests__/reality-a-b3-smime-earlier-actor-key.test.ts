// reality-defects: A-B3
// A-B3: every world restart issues a new certificate for the shared grid owner, but the platform keeps the earlier
// ones active and earlier tenants' routes pin them. The simulated counterparty must read mail enveloped to any key it
// was issued (as a real actor does during a certificate rollover); before, it only tried the newest key, so every
// earlier tenant's file was an "unreadable mail" failure (scenario A4: 109 of them).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unwrapSmimeForActor } from '../scripts/reality/simulators/smimeUnwrap'

const ACTOR = '16700'
let root: string
let previousTmp: string | undefined

function issue(dirName: string, mtime: number) {
  const dir = join(root, dirName)
  mkdirSync(dir)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, `actor-${ACTOR}.key`), '-out', join(dir, `actor-${ACTOR}.pem`),
    '-days', '2', '-subj', `/CN=actor-${ACTOR}-${dirName}`], { stdio: 'ignore' })
  utimesSync(join(dir, `actor-${ACTOR}.pem`), mtime, mtime)
  return dir
}

function envelopeTo(certDir: string, body: string) {
  const work = mkdtempSync(join(root, 'mail-'))
  writeFileSync(join(work, 'inner.eml'), `Content-Type: text/plain\r\n\r\n${body}`)
  execFileSync('openssl', ['cms', '-encrypt', '-in', join(work, 'inner.eml'), '-out', join(work, 'mail.eml'), '-aes256', join(certDir, `actor-${ACTOR}.pem`)], { stdio: 'ignore' })
  return readFileSync(join(work, 'mail.eml'))
}

beforeEach(() => {
  previousTmp = process.env.TMPDIR
  root = mkdtempSync(join(tmpdir(), 'a-b3-'))
  process.env.TMPDIR = root
})
afterEach(() => {
  if (previousTmp === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = previousTmp
  rmSync(root, { recursive: true, force: true })
})

describe('A-B3 the simulated grid owner reads mail enveloped to any certificate it was issued', () => {
  it('reads mail to the newest and to an earlier key', () => {
    const now = Date.now() / 1000
    const earlier = issue('reality-ldap-ca-earlier', now - 3600)
    const newest = issue('reality-ldap-ca-newest', now)
    expect(unwrapSmimeForActor(envelopeTo(newest, 'UNB+newest'), ACTOR)).toContain('UNB+newest')
    expect(unwrapSmimeForActor(envelopeTo(earlier, 'UNB+earlier'), ACTOR)).toContain('UNB+earlier')
  })

  it('still refuses mail to a key it never held', () => {
    issue('reality-ldap-ca-own', Date.now() / 1000)
    const foreign = mkdtempSync(join(root, 'foreign-'))
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(foreign, `actor-${ACTOR}.key`), '-out', join(foreign, `actor-${ACTOR}.pem`),
      '-days', '2', '-subj', '/CN=someone-else'], { stdio: 'ignore' })
    expect(() => unwrapSmimeForActor(envelopeTo(foreign, 'UNB+foreign'), ACTOR)).toThrow()
  })
})
